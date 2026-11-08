import * as tf from '@tensorflow/tfjs';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { VOCAB, VOCAB_FRAMES, VOCAB_FRAME_SIZE, VOCAB_PREPROCESSING_VERSION, HAND_SIZE, MIN_ACTIVE_ROWS, vocabSequence, mirrorSequence } from '../src/vocab.js';

// Experimental continuous-signing vocabulary: 25 FSL-105 signs + "other".
// Thresholds come from calibration rows only; test rows are scored once at the end.
await tf.setBackend('cpu');
const OTHER = VOCAB.length;
const classIndex = new Map(VOCAB.map((v, i) => [v.datasetId, i]));
const dataset = JSON.parse(await readFile('.tools/fsl105/vocab-features.json', 'utf8')).map(s => ({ ...s, source: 'fsl105', label: s.vocab ? classIndex.get(s.datasetId) : OTHER }));

// Jim's own recordings (Interpret → Record) from .tools/webcam/*.jsonl. The
// newest recording session is held out for evaluation unless
// FSL_WEBCAM_HOLDOUT lists sessions (or "none"); elsewhere every fourth
// sample calibrates.
const personal = [];
try {
  const sessions = [];
  for (const file of (await readdir('.tools/webcam')).filter(f => f.endsWith('.jsonl'))) {
    const lines = (await readFile(`.tools/webcam/${file}`, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
    const discarded = new Set(lines.filter(l => l.type === 'discard').map(l => l.trialId));
    const samples = lines.filter(l => l.type === 'sample' && l.protocolVersion === 'vocab-record-v1' && !discarded.has(l.trialId));
    if (samples.length) sessions.push({ id: samples[0].sessionId, startedAt: samples[0].recordedAt, samples });
  }
  sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const holdout = process.env.FSL_WEBCAM_HOLDOUT ? new Set(process.env.FSL_WEBCAM_HOLDOUT.split(',')) : new Set(sessions.slice(-1).map(s => s.id));
  for (const session of sessions) session.samples.forEach((s, i) => personal.push({
    path: `webcam/${session.id}/${s.trialId}`, source: 'webcam', sessionId: session.id, rows: s.rows, datasetId: s.target.datasetId,
    label: s.target.datasetId === null ? OTHER : classIndex.get(s.target.datasetId) ?? OTHER, group: s.target.datasetId === null ? 'webcam-other' : 'webcam-vocab',
    split: holdout.has(session.id) ? 'test' : i % 4 === 3 ? 'calibration' : 'train'
  }));
} catch (error) { if (error.code !== 'ENOENT') throw error; }

const all = [...dataset, ...personal].map(s => ({ ...s, ...vocabSequence(s.rows) })).filter(s => s.sequence && s.activeRows >= MIN_ACTIVE_ROWS);
const order = s => createHash('sha256').update(s.path).digest('hex');
const training = all.filter(s => s.split === 'train').sort((a, b) => order(a).localeCompare(order(b)));
const calibration = all.filter(s => s.split === 'calibration');
const testing = all.filter(s => s.split === 'test');
for (let i = 0; i <= OTHER; i++) if (!training.some(s => s.label === i)) throw new Error(`Class ${i} has no usable training rows.`);

function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const rng = random(7);
// Training-only augmentation: trim up to 15% of the active run at either end
// (live segments start and stop imprecisely), mirror (other dominant hand),
// shift/scale hand positions relative to the face, and jitter coordinates.
function augment(sample, mirror) {
  const active = sample.rows.flatMap((row, i) => (row[1] === 1 || row[1 + HAND_SIZE] === 1) ? [i] : []);
  const span = active.at(-1) - active[0] + 1;
  const from = active[0] + Math.floor(rng() * span * .15), to = active.at(-1) - Math.floor(rng() * span * .15);
  const rows = sample.rows.map((row, i) => i < from || i > to ? Array(VOCAB_FRAME_SIZE).fill(0).map((v, j) => j === 0 ? row[0] : v) : row);
  let sequence = vocabSequence(rows).sequence || sample.sequence;
  if (mirror) sequence = mirrorSequence(sequence);
  const dx = (rng() - .5) * .6, dy = (rng() - .5) * .6, scale = .9 + rng() * .2;
  return sequence.map(row => row.map((v, j) => {
    if (j === 0) return v;
    const slot = Math.floor((j - 1) / HAND_SIZE), k = (j - 1) % HAND_SIZE;
    if (row[1 + slot * HAND_SIZE] !== 1 || k === 0) return v;
    if (k === 1) return v * scale + dx;
    if (k === 2) return v * scale + dy;
    return v + (rng() - .5) * .06;
  }));
}
const copies = s => s.label === OTHER ? 1 : 2;
const examples = training.flatMap(s => [{ sequence: s.sequence, label: s.label }, ...Array.from({ length: copies(s) }, (_, k) => ({ sequence: augment(s, k % 2 === 0), label: s.label }))]);
// Deterministic shuffle so batches mix classes (fit runs with shuffle: false).
for (let i = examples.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [examples[i], examples[j]] = [examples[j], examples[i]]; }
const counts = Array.from({ length: OTHER + 1 }, (_, i) => examples.filter(e => e.label === i).length);
const classWeight = Object.fromEntries(counts.map((n, i) => [i, examples.length / ((OTHER + 1) * n)]));
const x = tf.tensor3d(examples.map(e => e.sequence));
const y = tf.oneHot(tf.tensor1d(examples.map(e => e.label), 'int32'), OTHER + 1);
const vx = tf.tensor3d(calibration.map(s => s.sequence));
const vy = tf.oneHot(tf.tensor1d(calibration.map(s => s.label), 'int32'), OTHER + 1);

const model = tf.sequential();
// Per-frame projection first: conv1d over all 133 inputs is ~3x slower on the
// tfjs CPU backend (about 90 s per epoch here).
model.add(tf.layers.timeDistributed({ inputShape: [VOCAB_FRAMES, VOCAB_FRAME_SIZE], layer: tf.layers.dense({ units: 32, activation: 'relu', kernelInitializer: tf.initializers.glorotUniform({ seed: 10 }) }) }));
model.add(tf.layers.conv1d({ filters: 32, kernelSize: 3, activation: 'relu', kernelInitializer: tf.initializers.glorotUniform({ seed: 11 }) }));
model.add(tf.layers.maxPooling1d({ poolSize: 2, strides: 2 }));
model.add(tf.layers.conv1d({ filters: 48, kernelSize: 3, activation: 'relu', kernelInitializer: tf.initializers.glorotUniform({ seed: 12 }) }));
model.add(tf.layers.globalAveragePooling1d({}));
model.add(tf.layers.dropout({ rate: .3, seed: 13 }));
model.add(tf.layers.dense({ units: OTHER + 1, activation: 'softmax', kernelInitializer: tf.initializers.glorotUniform({ seed: 14 }) }));
model.compile({ optimizer: tf.train.adam(.003), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
const started = Date.now();
let bestLoss = Infinity, bestWeights, bestEpoch = 0;
await model.fit(x, y, { epochs: 40, batchSize: 32, shuffle: false, classWeight, validationData: [vx, vy], callbacks: {
  onEpochEnd: async (epoch, logs) => {
    if (logs.val_loss < bestLoss) { bestLoss = logs.val_loss; bestEpoch = epoch + 1; bestWeights?.forEach(w => w.dispose()); bestWeights = model.getWeights().map(w => w.clone()); }
    console.log(`epoch ${epoch + 1} (${Math.round((Date.now() - started) / 1000)}s): train=${logs.acc.toFixed(3)} calibration=${logs.val_acc.toFixed(3)} loss=${logs.val_loss.toFixed(4)}`);
    if (epoch + 1 - bestEpoch >= 8) model.stopTraining = true;
    await tf.nextFrame();
  }
} });
model.setWeights(bestWeights);
bestWeights.forEach(w => w.dispose());

const predict = sequence => tf.tidy(() => Array.from(model.predict(tf.tensor3d([sequence])).dataSync()));
// Per-sign minimum score: the lowest that accepts no calibration row of any
// other class (or "other"); signs never predicted on calibration keep 0.9.
const scored = calibration.map(s => { const p = predict(s.sequence); const i = p.indexOf(Math.max(...p)); return { ...s, index: i, score: p[i] }; });
const minScore = Array.from({ length: OTHER }, (_, i) => {
  const wrong = scored.filter(s => s.index === i && s.label !== i).map(s => s.score);
  const right = scored.filter(s => s.index === i && s.label === i).map(s => s.score);
  const floor = wrong.length ? Math.max(...wrong) + 1e-6 : Math.min(.9, ...right.map(v => v - 1e-6));
  return Math.min(.999, Math.max(.5, floor));
});
const decide = p => {
  const i = p.indexOf(Math.max(...p));
  return i === OTHER || p[i] < minScore[i] ? { status: 'unknown', index: i, score: p[i] } : { status: 'suggestion', index: i, score: p[i] };
};

const directory = 'public/models/vocab';
await mkdir(directory, { recursive: true });
let hashes;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await model.save(tf.io.withSaveHandler(async artifacts => {
  const json = JSON.stringify({ format: 'layers-model', generatedBy: 'TensorFlow.js 4.22.0', modelTopology: artifacts.modelTopology, weightsManifest: [{ paths: ['weights.bin'], weights: artifacts.weightSpecs }] });
  const weights = Buffer.from(artifacts.weightData);
  await writeFile(`${directory}/model.json`, json); await writeFile(`${directory}/weights.bin`, weights);
  hashes = { model: hash(json), weights: hash(weights) };
  return { modelArtifactsInfo: tf.io.getModelArtifactsInfoForJSON(artifacts) };
}));

const rows = testing.map(s => { const p = predict(s.sequence); const d = decide(p); return { path: s.path, source: s.source, group: s.group, expected: s.label, raw: p.indexOf(Math.max(...p)), ...d }; });
const summarize = list => {
  const vocab = list.filter(r => r.expected !== OTHER), other = list.filter(r => r.expected === OTHER);
  return { vocab: vocab.length, correct: vocab.filter(r => r.status === 'suggestion' && r.index === r.expected).length, wrong: vocab.filter(r => r.status === 'suggestion' && r.index !== r.expected).length, abstained: vocab.filter(r => r.status !== 'suggestion').length, rawTop1: vocab.filter(r => r.raw === r.expected).length, other: other.length, falseAccepts: other.filter(r => r.status === 'suggestion').length };
};
const evaluation = {
  evaluatedAt: new Date().toISOString(), modelHashes: hashes,
  fsl105: summarize(rows.filter(r => r.source === 'fsl105')),
  fsl105UnseenOther: summarize(rows.filter(r => r.group === 'unseen-class')),
  webcamHeldOut: personal.length ? summarize(rows.filter(r => r.source === 'webcam')) : null,
  perSign: VOCAB.map((v, i) => ({ gloss: v.gloss, ...summarize(rows.filter(r => r.expected === i && r.source === 'fsl105')) })),
  limitations: 'Clip-disjoint FSL-105 test (no signer IDs) plus any held-out webcam session. Isolated signs, not continuous sentences. Not signing-correctness or translation accuracy.'
};
const manifest = {
  schemaVersion: 1, status: 'experimental', language: 'FSL', modelVersion: `fsl105-vocab25-cnn-v1${personal.some(s => s.split === 'train') ? `-webcam${new Set(personal.filter(s => s.split === 'train').map(s => s.sessionId)).size}` : ''}`,
  preprocessingVersion: VOCAB_PREPROCESSING_VERSION, inputShape: [VOCAB_FRAMES, VOCAB_FRAME_SIZE], glosses: VOCAB.map(v => v.gloss), datasetIds: VOCAB.map(v => v.datasetId), outputClasses: OTHER + 1,
  minScore, minActiveRows: MIN_ACTIVE_ROWS, hashes, bestEpoch, trainingRows: training.length, calibrationRows: calibration.length,
  provenance: { dataset: 'FSL-105 v2', doi: '10.17632/48y2y99mb9.2', license: 'CC BY 4.0', personalTrainingSamples: personal.filter(s => s.split === 'train').length }
};
await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(`${directory}/evaluation.json`, JSON.stringify({ ...evaluation, rows }, null, 2) + '\n');
console.log(JSON.stringify({ bestEpoch, bestLoss, examplesPerClass: counts, ...evaluation, perSign: evaluation.perSign.map(p => `${p.gloss} ${p.correct}/${p.vocab} wrong ${p.wrong} raw ${p.rawTop1}`) }, null, 2));
tf.dispose([x, y, vx, vy]); model.dispose();
