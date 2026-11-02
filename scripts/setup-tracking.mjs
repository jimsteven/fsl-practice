import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Explicit setup command, never run during app use. No camera data is involved.
const url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
await mkdir('public/tracking', { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/tracking/wasm', { recursive: true });
const response = await fetch(url);
if (!response.ok) throw new Error(`Google tracking asset download failed: ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
const sha256 = createHash('sha256').update(bytes).digest('hex');
let previous;
try { previous = JSON.parse(await readFile('tracking-assets.lock.json', 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (previous && previous.sha256 !== sha256) throw new Error('Tracking asset changed. Review provenance before updating the lock.');
await writeFile('public/tracking/hand_landmarker.task', bytes);
await writeFile('tracking-assets.lock.json', JSON.stringify({ url, package: '@mediapipe/tasks-vision@1.2.0', sha256, purpose: 'Generic hand landmarks, NOT FSL recognition' }, null, 2) + '\n');
console.log(`Self-hosted MediaPipe tracking assets ready. SHA-256: ${sha256}`);
