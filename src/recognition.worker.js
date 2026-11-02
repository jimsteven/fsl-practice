import * as tf from '@tensorflow/tfjs';
import { sequenceFeatures, activeSequence, meanShape, decidePrediction } from './features.js';
import { validateExperimentalManifest } from './model-contract.js';

let model, manifest;
async function asset(path, expected) {
  const response = await fetch('/models/numbers/' + path, { redirect: 'error' });
  if (!response.ok) throw new Error('Local model asset missing.');
  const bytes = await response.arrayBuffer();
  if (expected) {
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (actual !== expected) throw new Error('Model checksum mismatch.');
  }
  return bytes;
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      manifest = JSON.parse(new TextDecoder().decode(await asset('manifest.json')));
      validateExperimentalManifest(manifest);
      await tf.setBackend('cpu');
      const json = JSON.parse(new TextDecoder().decode(await asset('model.json', manifest.hashes.model)));
      const weights = await asset('weights.bin', manifest.hashes.weights);
      model = await tf.loadLayersModel(tf.io.fromMemory({ modelTopology: json.modelTopology, weightSpecs: json.weightsManifest[0].weights, weightData: weights }));
      if (model.inputs[0].shape.slice(1).join(',') !== manifest.inputShape.join(',') || model.outputs[0].shape[1] !== manifest.outputClasses) throw new Error('Model shape mismatch.');
      const report = JSON.parse(new TextDecoder().decode(await asset('evaluation.json')));
      if (report.modelHashes?.model !== manifest.hashes.model || report.modelHashes?.weights !== manifest.hashes.weights) throw new Error('Evaluation belongs to different model assets.');
      const { positiveClips, acceptedCorrect, acceptedWrong, positiveAbstentions, unsupportedClips, unsupportedRejected } = report;
      self.postMessage({ type: 'ready', modelVersion: manifest.modelVersion, evaluation: { positiveClips, acceptedCorrect, acceptedWrong, positiveAbstentions, unsupportedClips, unsupportedRejected } });
    } else if (data.type === 'predict' && model) {
      const started = performance.now();
      const { sequence, coverage, visibleFrames } = activeSequence(sequenceFeatures(data.frames).sequence);
      const valid = data.durationMs >= 3800 && data.frames.length >= 12 && coverage >= manifest.minCoverage && visibleFrames >= manifest.minVisibleFrames;
      const result = valid ? tf.tidy(() => decidePrediction(Array.from(model.predict(tf.tensor3d([sequence])).dataSync()), meanShape(sequence), manifest)) : { status: 'insufficient-tracking', label: null, modelVersion: manifest.modelVersion };
      self.postMessage({ type: 'prediction', requestId: data.requestId, result: { ...result, coverage, visibleFrames, classifierMs: Math.round((performance.now() - started) * 10) / 10 } });
    }
  } catch (_error) {
    self.postMessage({ type: 'error', requestId: data.requestId, message: 'Experimental recognition could not load or run. Check local model assets; tracking still works.' });
  }
};
