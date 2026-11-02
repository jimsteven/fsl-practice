import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import moduleLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';

let tracker;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      // Module workers need MediaPipe's ES-module WASM loader; the classic
      // loader imports without exporting its factory in this environment.
      const files = await FilesetResolver.forVisionTasks('/tracking/wasm', true);
      // Vite owns the JS module URL in both dev and production. WASM binaries
      // remain self-hosted; importing public/ JS directly breaks dev mode.
      tracker = await HandLandmarker.createFromOptions({ ...files, wasmLoaderPath: moduleLoaderUrl }, {
        baseOptions: { modelAssetPath: '/tracking/hand_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2
      });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      const started = performance.now();
      const result = tracker.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({ type: 'result', landmarks: result.landmarks, handedness: result.handedness, latencyMs: performance.now() - started });
    }
  } catch (error) {
    // Library/setup message only: never frames, landmarks, or learner data.
    console.error('MediaPipe tracking error:', error.message);
    self.postMessage({ type: 'error', message: 'Hand tracking failed. Stop and retry; check that tracking assets are installed and this browser supports WebAssembly workers.' });
  } finally {
    data.bitmap?.close();
  }
};
