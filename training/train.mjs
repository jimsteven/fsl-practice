import * as tf from '@tensorflow/tfjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FRAME_COUNT, FRAME_SIZE, PREPROCESSING_VERSION, meanShape, shapeDistance } from '../src/features.js';
import { OTHER, classOf, usable, datasetSamples, webcamSamples } from './data.mjs';

// Only training and calibration rows are read here; evaluate.mjs alone reads test rows.
await tf.setBackend('cpu');
const all = [...await datasetSamples(), ...await webcamSamples()];
if (new Set(all.map(s => s.path)).size !== all.length) throw new Error('Clip leakage across splits.');
const order = s => createHash('sha256').update(s.path).digest('hex');
const training = all.filter(s => s.split === 'train' && usable(s)).sort((a, b) => order(a).localeCompare(order(b)));
const calibration = all.filter(s => s.split === 'calibration' && usable(s));
for (let i = 0; i <= OTHER; i++) if (!training.some(s => classOf(s) === i)) throw new Error(`Class ${i} has no usable training rows.`);

// Deterministic augmentation for camera/signer variation the 58 positive clips
// cannot cover: in-plane rotation, mirrored (other dominant hand), depth scale,
// landmark jitter and a small timing shift. Applied to training rows only.
function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const rng = random(42);
const gaussian = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
function augment(sequence, mirror) {
  const angle = (rng() * 2 - 1) * .26, cos = Math.cos(angle), sin = Math.sin(angle), depth = .8 + .4 * rng();
  const shift = Math.round((rng() * 2 - 1) * 2);
  return sequence.map((_, i) => {
    const row = sequence[Math.max(0, Math.min(FRAME_COUNT - 1, i + shift))];
    if (row[0] !== 1) return Array(FRAME_SIZE).fill(0);
    const out = [1];
    for (let p = 0; p < 21; p++) {
      const x = (mirror ? -1 : 1) * row[1 + p * 3], y = row[2 + p * 3], z = row[3 + p * 3];
      out.push(x * cos - y * sin + gaussian() * .03, x * sin + y * cos + gaussian() * .03, z * depth + gaussian() * .03);
    }
    return out.map((v, j) => j ? Math.max(-5, Math.min(5, v)) : v);
  });
}
const copies = s => classOf(s) === OTHER ? 1 : 7;
const examples = training.flatMap(s => [{ sequence: s.sequence, label: classOf(s) }, ...Array.from({ length: copies(s) }, (_, k) => ({ sequence: augment(s.sequence, k % 2 === 0), label: classOf(s) }))]);
const x = tf.tensor3d(examples.map(e => e.sequence));
const y = tf.oneHot(tf.tensor1d(examples.map(e => e.label), 'int32'), OTHER + 1);
const vx = tf.tensor3d(calibration.map(s => s.sequence));
const vy = tf.oneHot(tf.tensor1d(calibration.map(classOf), 'int32'), OTHER + 1);
const counts = Array.from({ length: OTHER + 1 }, (_, i) => examples.filter(e => e.label === i).length);
const classWeight = Object.fromEntries(counts.map((n, i) => [i, examples.length / ((OTHER + 1) * n)]));

const model = tf.sequential();
model.add(tf.layers.conv1d({ inputShape: [FRAME_COUNT, FRAME_SIZE], filters: 24, kernelSize: 3, activation: 'relu', kernelInitializer: tf.initializers.glorotUniform({ seed: 42 }) }));
model.add(tf.layers.maxPooling1d({ poolSize: 2, strides: 2 }));
model.add(tf.layers.conv1d({ filters: 24, kernelSize: 3, activation: 'relu', kernelInitializer: tf.initializers.glorotUniform({ seed: 43 }) }));
model.add(tf.layers.globalAveragePooling1d({}));
model.add(tf.layers.dropout({ rate: .2, seed: 45 }));
model.add(tf.layers.dense({ units: OTHER + 1, activation: 'softmax', kernelInitializer: tf.initializers.glorotUniform({ seed: 44 }) }));
model.compile({ optimizer: tf.train.adam(.003), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
let bestLoss = Infinity, bestWeights, bestEpoch = 0;
const history = [];
await model.fit(x, y, { epochs: 150, batchSize: 32, shuffle: false, classWeight, validationData: [vx, vy], callbacks: {
  onEpochEnd: async (epoch, logs) => {
    history.push({ epoch: epoch + 1, ...logs });
    if (logs.val_loss < bestLoss) {
      bestLoss = logs.val_loss; bestEpoch = epoch + 1;
      bestWeights?.forEach(w => w.dispose());
      bestWeights = model.getWeights().map(w => w.clone());
    }
    if (epoch % 10 === 0) console.log(`epoch ${epoch + 1}: train=${logs.acc.toFixed(3)} calibration=${logs.val_acc.toFixed(3)} loss=${logs.val_loss.toFixed(4)}`);
    if (epoch + 1 - bestEpoch >= 25) model.stopTraining = true;
    await tf.nextFrame();
  }
} });
model.setWeights(bestWeights);
bestWeights.forEach(w => w.dispose());
const prototypes = Array.from({ length: 5 }, (_, i) => training.filter(s => classOf(s) === i).map(s => meanShape(s.sequence)));
const scored = calibration.map(sample => {
  const scores = tf.tidy(() => Array.from(model.predict(tf.tensor3d([sample.sequence])).dataSync()));
  const index = scores.indexOf(Math.max(...scores));
  return { ...sample, index, score: scores[index], distance: index === OTHER ? Infinity : Math.min(...prototypes[index].map(p => shapeDistance(meanShape(sample.sequence), p))) };
});
// Select score AND novelty-distance gates solely on calibration rows. Zero
// calibration false accepts are required; this is not an unseen-signer guarantee.
const rejection = Array.from({ length: 5 }, (_, index) => {
  const rows = scored.filter(s => s.index === index);
  let best = { trueAccepts: 0, minScore: 1.000001, maxDistance: 0 };
  for (const minScore of rows.map(s => s.score - 1e-7)) for (const maxDistance of rows.map(s => s.distance + 1e-7)) {
    const accepted = rows.filter(s => s.score >= minScore && s.distance <= maxDistance);
    const tp = accepted.filter(s => classOf(s) === index).length;
    const fp = accepted.length - tp;
    if (!fp && (tp > best.trueAccepts || (tp === best.trueAccepts && minScore > best.minScore))) best = { trueAccepts: tp, minScore, maxDistance };
  }
  return best;
});
const directory = 'public/models/numbers';
await mkdir(directory, { recursive: true });
let hashes;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await model.save(tf.io.withSaveHandler(async artifacts => {
  const json = JSON.stringify({ format: 'layers-model', generatedBy: 'TensorFlow.js 4.22.0', modelTopology: artifacts.modelTopology, weightsManifest: [{ paths: ['weights.bin'], weights: artifacts.weightSpecs }] });
  const weights = Buffer.from(artifacts.weightData);
  await writeFile(`${directory}/model.json`, json);
  await writeFile(`${directory}/weights.bin`, weights);
  hashes = { model: hash(json), weights: hash(weights) };
  return { modelArtifactsInfo: tf.io.getModelArtifactsInfoForJSON(artifacts) };
}));
const webcamTraining = training.filter(s => s.source === 'webcam');
const manifest = {
  schemaVersion: 1, status: 'experimental', language: 'FSL', modelVersion: `fsl105-numbers1-5-other-cnn-v2${webcamTraining.length ? `-webcam${new Set(webcamTraining.map(s => s.sessionId)).size}` : ''}`,
  labels: ['One', 'Two', 'Three', 'Four', 'Five'], signIds: [20, 21, 22, 23, 24].map(id => `fsl105-${id}`), outputClasses: OTHER + 1, otherClass: 'Unsupported sign (abstains)',
  preprocessingVersion: PREPROCESSING_VERSION, inputShape: [FRAME_COUNT, FRAME_SIZE], captureMs: 4000, minCoverage: .5, minVisibleFrames: 4,
  hashes, rejection, prototypes,
  provenance: { dataset: 'FSL-105 v2', doi: '10.17632/48y2y99mb9.2', license: 'CC BY 4.0', source: 'https://data.mendeley.com/datasets/48y2y99mb9/2', author: 'Isaiah Jassen Tupal (2023)', training: 'TensorFlow.js CPU temporal CNN with a sixth "other" class; fixed seeds; deterministic order and augmentation; selected on calibration loss only', bestEpoch, trainingClips: training.filter(s => s.source === 'fsl105').length, webcamTrainingChecks: webcamTraining.length, calibrationRows: calibration.length, augmentation: 'Training rows only: ±15° in-plane rotation, mirroring, depth scale 0.8–1.2, 0.03 landmark jitter, ±2-row timing shift. 7 copies per number clip, 1 per other clip.', splitter: 'Numbers: original training CSV, first 12 clips by filename train, remaining 4 calibrate. Other: Six–Ten remaining training clips plus 3 train / 2 calibrate from even-ID FSL-105 signs; odd-ID signs are test-only. Webcam: newest session (or FSL_WEBCAM_HOLDOUT) test-only; elsewhere every fourth check calibrates. Original test clips untouched by this script.', signerIndependent: false, consentRecords: 'FSL-105 reused under its published CC BY license. Webcam checks are Jim’s own landmarks recorded on this Mac.' },
  limitations: ['Experimental closed vocabulary, numbers 1–5 only.', 'Clip-disjoint, NOT signer-independent validation. No proven webcam generalization or signing-correctness feedback.', 'Single visible hand, source coordinate XYZ wrist centering and palm scaling; idle edges cropped and active window resampled. No pose/face or full FSL grammar.', 'No expert validation or endorsement of this classifier.']
};
await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
await writeFile('.tools/fsl105/training-history.json', JSON.stringify({ history, rejection, examplesPerClass: counts, trainingPaths: training.map(s => s.path), calibrationPaths: calibration.map(s => s.path) }, null, 2));
console.log(JSON.stringify({ bestEpoch, bestLoss, trainingRows: training.length, examplesPerClass: counts, calibrationRows: calibration.length, rejection }, null, 2));
tf.dispose([x, y, vx, vy]); model.dispose();
