import * as tf from '@tensorflow/tfjs';
import { readFile, writeFile } from 'node:fs/promises';
import { meanShape, decidePrediction } from '../src/features.js';
import { validateExperimentalManifest } from '../src/model-contract.js';
import { trialOutcome, summarizeTrials } from '../src/webcam-test.js';
import { datasetSamples, webcamSamples } from './data.mjs';

// Usage: npm run evaluate:experimental [-- <model directory> <report path>]
// Defaults write the shipped report. Pointing at an archived model (for example
// .tools/models/v1) re-scores the same held-out rows for a before/after table.
const directory = process.argv[2] || 'public/models/numbers';
const output = process.argv[3] || `${directory}/evaluation.json`;
await tf.setBackend('cpu');
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
if (directory === 'public/models/numbers') validateExperimentalManifest(manifest);
const json = JSON.parse(await readFile(`${directory}/model.json`, 'utf8'));
const weights = await readFile(`${directory}/weights.bin`);
const model = await tf.loadLayersModel(tf.io.fromMemory({ modelTopology: json.modelTopology, weightSpecs: json.weightsManifest[0].weights, weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength) }));
const samples = [...await datasetSamples(), ...await webcamSamples()].filter(s => s.split === 'test');
const confusion = Array.from({ length: 5 }, () => Array(model.outputs[0].shape[1]).fill(0));
const rows = samples.map(s => {
  const started = performance.now();
  const scores = tf.tidy(() => Array.from(model.predict(tf.tensor3d([s.sequence])).dataSync()));
  const index = scores.indexOf(Math.max(...scores));
  if (s.supported && s.source === 'fsl105') confusion[s.datasetId - 20][index]++;
  // Webcam checks also need the live capture rules the browser worker applies.
  const live = s.source !== 'webcam' || (s.durationMs >= 3800 && s.frameCount >= 12);
  const result = live && s.coverage >= manifest.minCoverage && s.visibleFrames >= manifest.minVisibleFrames ? decidePrediction(scores, meanShape(s.sequence), manifest) : { status: 'insufficient-tracking', label: null };
  return { path: s.path, source: s.source, expected: s.datasetId, supported: s.supported, negativeGroup: s.negativeGroup, coverage: s.coverage, rawTop1: index < 5 ? 20 + index : 'other', result: { status: result.status, reason: result.reason, label: result.label, signId: result.signId, score: result.score, distance: result.distance }, classifierMs: performance.now() - started, record: s.record };
});
const dataset = rows.filter(r => r.source === 'fsl105');
const positives = dataset.filter(r => r.supported), negatives = dataset.filter(r => !r.supported);
const rejected = group => ({ clips: negatives.filter(r => r.negativeGroup === group).length, rejected: negatives.filter(r => r.negativeGroup === group && !r.result.signId).length });
const webcam = rows.filter(r => r.source === 'webcam');
const report = {
  evaluatedAt: new Date().toISOString(), modelVersion: manifest.modelVersion, modelHashes: manifest.hashes,
  environment: { node: process.version, platform: process.platform, arch: process.arch, backend: tf.getBackend() },
  split: 'Original FSL105 test CSV, never used by training or threshold selection. Clip-disjoint only; signer IDs unavailable. Unseen-class negatives come from signs never used in training or calibration.',
  positiveClips: positives.length, rawTop1Correct: positives.filter(r => r.rawTop1 === r.expected).length,
  acceptedCorrect: positives.filter(r => r.result.signId === `fsl105-${r.expected}`).length,
  acceptedWrong: positives.filter(r => r.result.signId && r.result.signId !== `fsl105-${r.expected}`).length,
  positiveAbstentions: positives.filter(r => !r.result.signId).length,
  unsupportedClips: negatives.length, unsupportedRejected: negatives.filter(r => !r.result.signId).length,
  unsupportedByGroup: { sixToTen: rejected('six-ten'), seenClasses: rejected('seen-class'), unseenClasses: rejected('unseen-class') },
  webcamHeldOut: webcam.length ? { sessions: [...new Set(webcam.map(r => r.path.split('/')[1]))], ...summarizeTrials(webcam.map(r => ({ target: r.record.target, result: r.result, outcome: trialOutcome(r.record.target, r.result) }))) } : null,
  confusionMatrix: confusion, labels: manifest.labels, rows: rows.map(({ record: _record, ...row }) => row),
  limitations: 'Research dataset test plus any held-out webcam session; not signer-independent accuracy, assessment of correctness, or end-to-end latency. No thresholds adjusted after this run.'
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, rows: undefined, webcamHeldOut: report.webcamHeldOut && { ...report.webcamHeldOut, bySign: undefined } }, null, 2));
model.dispose();
