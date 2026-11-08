import { frameFeatures } from '../src/vocab.js';

// Same MediaPipe worker as the live interpreter (hands + face), on dataset pixels.
const worker = new Worker(new URL('../src/tracking.worker.js', import.meta.url), { type: 'module' });
let waiting;
let timestamp = 0;
const ready = new Promise((resolve, reject) => {
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') resolve();
    else if (data.type === 'error') { reject(new Error(data.message)); waiting?.reject(new Error(data.message)); }
    else if (data.type === 'result') { waiting.resolve(data); waiting = null; }
  };
  worker.onerror = reject;
});
worker.postMessage({ type: 'init', face: true });

// 24 grid points over the 4-second clip (~6 per second); rows are feature
// vectors, never raw pixels.
window.extractClip = async url => {
  await ready;
  const video = document.getElementById('source');
  video.src = url;
  await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error(`Cannot decode ${url}`)); });
  const rows = [];
  for (let i = 0; i < 24; i++) {
    const target = Math.min(video.duration - 0.04, (i * 4000 / 23) / 1000 + 0.001);
    if (Math.abs(video.currentTime - target) > 0.0001) await new Promise(resolve => { video.onseeked = resolve; video.currentTime = target; });
    const bitmap = await createImageBitmap(video);
    const result = await new Promise((resolve, reject) => {
      waiting = { resolve, reject };
      timestamp += 167;
      worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
    });
    rows.push(frameFeatures(result.landmarks, result.face).map(v => Math.round(v * 1e4) / 1e4));
  }
  return { rows };
};
