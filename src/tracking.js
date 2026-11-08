export const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

export function projectPoint(point, width, height) {
  // Canvas uses source dimensions. A shared CSS transform mirrors video AND
  // overlay; it never changes source handedness or model coordinates.
  return { x: point.x * width, y: point.y * height };
}

export function drawLandmarks(canvas, hands, color, face = null) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (face) {
    ctx.fillStyle = color;
    ctx.globalAlpha = .55;
    for (let i = 0; i < face.length; i += 2) {
      const p = projectPoint(face[i], canvas.width, canvas.height);
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, canvas.width / 320);
  for (const hand of hands) {
    if (hand.length !== 21) continue;
    for (const [a, b] of connections) {
      const from = projectPoint(hand[a], canvas.width, canvas.height);
      const to = projectPoint(hand[b], canvas.width, canvas.height);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    }
    for (const point of hand) {
      const p = projectPoint(point, canvas.width, canvas.height);
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, canvas.width / 200), 0, Math.PI * 2); ctx.fill();
    }
  }
}

// Framing cues from normalized source coordinates. They describe where the
// tracked hand sits in the frame, never whether the sign itself is correct.
export function positionCue(hands, { oneHand = true } = {}) {
  if (!hands.length) return { ready: false, text: 'Show your hand inside the frame.' };
  if (oneHand && hands.length > 1) return { ready: false, text: 'Use one hand for numbers. Lower the other hand.' };
  const points = hands.flat();
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (left < .03 || right > .97 || top < .03 || bottom > .97) return { ready: false, text: 'Part of your hand is outside the frame. Move toward the middle.' };
  const size = Math.max(right - left, bottom - top);
  if (size < .16) return { ready: false, text: 'Your hand looks small. Move a little closer.' };
  if (size > .75) return { ready: false, text: 'Your hand fills the frame. Move back a little.' };
  return { ready: true, text: 'Good position. Hold your hand here.' };
}

export function cameraError(error) {
  if (['NotAllowedError', 'SecurityError'].includes(error.name)) return 'Camera permission was denied. Allow camera access in browser settings, then retry. References remain browsable.';
  if (error.name === 'NotFoundError') return 'No camera was found. Connect a camera, then retry.';
  if (error.name === 'NotReadableError') return 'The camera is unavailable or in use by another app. Close that app, then retry.';
  return 'The camera could not start. Check the device and browser permissions, then retry.';
}

// One owner for camera, worker, and frame scheduling. stop() also invalidates
// pending permission / video / worker work, including a late-resolving stream.
export class CameraSession {
  constructor({ video, onState, onResult, face = false, getUserMedia = constraints => navigator.mediaDevices.getUserMedia(constraints), makeWorker = () => new Worker(new URL('./tracking.worker.js', import.meta.url), { type: 'module' }) }) {
    Object.assign(this, { video, onState, onResult, face, getUserMedia, makeWorker });
    this.generation = 0;
  }

  stop(announce = true) {
    this.generation++;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.loadTimer);
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    if (announce) this.onState({ phase: 'off', message: 'Camera is off.' });
  }

  async start() {
    this.stop(false);
    const generation = this.generation;
    const current = () => this.generation === generation;
    this.onState({ phase: 'loading', message: 'Waiting for camera permission. No microphone is requested.' });
    try {
      const stream = await this.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } } });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
        if (current()) this.fail('The camera disconnected. Reconnect it and retry.');
      }));
      this.video.srcObject = stream;
      this.loadTimer = setTimeout(() => { if (current()) this.fail('Camera or tracking setup timed out. Check the tracking assets and connection, then retry.'); }, 30000);
      await this.video.play();
      if (!current()) return;
      this.onState({ phase: 'loading', message: 'Loading on-device hand tracking…' });
      const worker = this.makeWorker();
      this.worker = worker;
      let busy = false;
      let lastTime = -1;
      let lastFrame = -Infinity;
      let ready = false;
      worker.onerror = () => { if (current()) this.fail('Hand tracking could not load. Check tracking assets and browser support, then retry.'); };
      worker.onmessage = ({ data }) => {
        if (!current()) return;
        if (data.type === 'ready') {
          ready = true;
          clearTimeout(this.loadTimer);
          this.onState({ phase: 'active', message: 'Hand tracking is available. Camera frames stay on this device.' });
        } else if (data.type === 'result') {
          busy = false;
          this.onResult(data);
        } else if (data.type === 'error') this.fail(data.message);
      };
      worker.postMessage({ type: 'init', face: this.face });
      const tick = async now => {
        if (!current()) return;
        this.raf = requestAnimationFrame(tick);
        if (!ready || busy || document.hidden || this.video.readyState < 2 || this.video.currentTime === lastTime || now - lastFrame < 1000 / 12) return;
        busy = true;
        lastTime = this.video.currentTime;
        lastFrame = now;
        try {
          const bitmap = await createImageBitmap(this.video);
          if (!current()) { bitmap.close(); return; }
          worker.postMessage({ type: 'frame', bitmap, timestamp: now }, [bitmap]);
        } catch (_error) { if (current()) this.fail('This browser could not prepare a camera frame for hand tracking. Try an updated Chrome, Edge, or Safari.'); }
      };
      this.raf = requestAnimationFrame(tick);
    } catch (error) { if (current()) this.fail(cameraError(error)); }
  }

  fail(message) {
    this.stop(false);
    this.onState({ phase: 'error', message });
  }
}
