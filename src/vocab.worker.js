import * as tf from '@tensorflow/tfjs';
import { VOCAB, VOCAB_FRAMES, VOCAB_FRAME_SIZE, VOCAB_PREPROCESSING_VERSION } from './vocab.js';

let model, manifest;
async function asset(path, expected) {
  const response = await fetch('/models/vocab/' + path, { redirect: 'error' });
  if (!response.ok) throw new Error('Local vocabulary model asset missing.');
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
      const valid = manifest.schemaVersion === 1 && manifest.preprocessingVersion === VOCAB_PREPROCESSING_VERSION
        && manifest.inputShape?.join(',') === [VOCAB_FRAMES, VOCAB_FRAME_SIZE].join(',') && manifest.glosses?.join('|') === VOCAB.map(v => v.gloss).join('|')
        && manifest.outputClasses === VOCAB.length + 1 && manifest.minScore?.length === VOCAB.length;
      if (!valid) throw new Error('Incompatible vocabulary model.');
      await tf.setBackend('cpu');
      const json = JSON.parse(new TextDecoder().decode(await asset('model.json', manifest.hashes.model)));
      const weights = await asset('weights.bin', manifest.hashes.weights);
      model = await tf.loadLayersModel(tf.io.fromMemory({ modelTopology: json.modelTopology, weightSpecs: json.weightsManifest[0].weights, weightData: weights }));
      self.postMessage({ type: 'ready', modelVersion: manifest.modelVersion });
    } else if (data.type === 'classify' && model) {
      const scores = tf.tidy(() => Array.from(model.predict(tf.tensor3d([data.sequence])).dataSync()));
      const ranked = scores.map((score, index) => ({ index, score })).sort((a, b) => b.score - a.score);
      const top = ranked[0];
      const accepted = top.index < VOCAB.length && top.score >= manifest.minScore[top.index];
      self.postMessage({ type: 'result', requestId: data.requestId, result: {
        accepted, gloss: top.index < VOCAB.length ? VOCAB[top.index].gloss : null, score: top.score, threshold: manifest.minScore[top.index] ?? null,
        scores: Object.fromEntries(VOCAB.map((v, i) => [v.gloss, scores[i]])),
        top: ranked.slice(0, 3).map(r => ({ gloss: r.index < VOCAB.length ? VOCAB[r.index].gloss : 'other', score: r.score }))
      } });
    }
  } catch (error) {
    self.postMessage({ type: 'error', requestId: data.requestId, message: error.message });
  }
};
