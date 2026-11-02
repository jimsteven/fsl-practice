import { sequenceFeatures } from '../src/features.js';

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
worker.postMessage({ type: 'init' });

window.extractClip = async url => {
  await ready;
  const video = document.getElementById('source');
  video.src = url;
  await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error(`Cannot decode ${url}`)); });
  const frames = [];
  for (let i = 0; i < 24; i++) {
    const time = i * 4000 / 23;
    const target = Math.min(video.duration - 0.04, time / 1000 + 0.001);
    if (Math.abs(video.currentTime - target) > 0.0001) {
      await new Promise(resolve => { video.onseeked = resolve; video.currentTime = target; });
    }
    const bitmap = await createImageBitmap(video);
    const result = await new Promise((resolve, reject) => {
      waiting = { resolve, reject };
      timestamp += 167;
      worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
    });
    frames.push({ time, landmarks: result.landmarks });
  }
  return { ...sequenceFeatures(frames), duration: video.duration, handCounts: frames.map(frame => frame.landmarks.length) };
};
