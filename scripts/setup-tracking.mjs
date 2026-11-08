import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Explicit setup command, never run during app use. No camera data is involved.
// Each model is pinned by SHA-256 in tracking-assets.lock.json; a changed
// download fails instead of silently replacing a reviewed asset.
const assets = {
  hand: { url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', file: 'hand_landmarker.task', purpose: 'Generic hand landmarks, NOT FSL recognition' },
  face: { url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', file: 'face_landmarker.task', purpose: 'Face anchor and expression blendshapes for the experimental interpreter, NOT emotion or grammar recognition' }
};
await mkdir('public/tracking', { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/tracking/wasm', { recursive: true });
let previous = {};
try { previous = JSON.parse(await readFile('tracking-assets.lock.json', 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
// The original lock described only the hand model at the top level.
if (previous.sha256) previous = { hand: previous };
const lock = { package: '@mediapipe/tasks-vision@1.2.0' };
for (const [name, asset] of Object.entries(assets)) {
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`Google tracking asset download failed (${name}): ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (previous[name] && previous[name].sha256 !== sha256) throw new Error(`Tracking asset ${name} changed. Review provenance before updating the lock.`);
  await writeFile(`public/tracking/${asset.file}`, bytes);
  lock[name] = { url: asset.url, sha256, purpose: asset.purpose };
  console.log(`Self-hosted ${name} tracking asset ready. SHA-256: ${sha256}`);
}
await writeFile('tracking-assets.lock.json', JSON.stringify(lock, null, 2) + '\n');
