import { useEffect, useRef, useState } from 'react';
import { CameraSession, drawLandmarks } from './tracking.js';

// Owns the automatic camera lifecycle for a page: starts when visible, releases
// on hide or pagehide, and resumes on return unless an error needs a retry.
// `onFrame(validHands, result)` sees every tracking result; `onInactive()` runs
// whenever tracking stops so callers can close an attempt in progress.
export function useCameraTracking({ overlay, onFrame, onInactive, face = false }) {
  const video = useRef(null);
  const canvas = useRef(null);
  const controller = useRef(null);
  const handlers = useRef(null);
  const lastRender = useRef(0);
  handlers.current = { overlay, onFrame, onInactive };
  const [state, setState] = useState({ phase: 'off', message: 'Camera is off.' });
  const [signal, setSignal] = useState(null);
  const [aspect, setAspect] = useState(4 / 3);

  function startCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
      setState({ phase: 'error', message: 'Camera tracking needs HTTPS or localhost, camera access, and a current browser with workers and ImageBitmap support.' });
      return;
    }
    controller.current.start();
  }

  useEffect(() => {
    let failed = false;
    const session = new CameraSession({
      video: video.current,
      face,
      onState: next => {
        if (next.phase === 'error') failed = true;
        if (next.phase === 'loading') failed = false;
        setState(next);
        if (next.phase !== 'active') {
          setSignal(null);
          if (canvas.current) drawLandmarks(canvas.current, [], '');
          handlers.current.onInactive?.();
        }
      },
      onResult: result => {
        const validHands = result.landmarks.filter(hand => hand.length === 21);
        const width = video.current?.videoWidth;
        const height = video.current?.videoHeight;
        if (canvas.current && width && height) {
          canvas.current.width = width;
          canvas.current.height = height;
          setAspect(width / height);
          const color = getComputedStyle(document.documentElement).getPropertyValue('--landmark').trim();
          drawLandmarks(canvas.current, handlers.current.overlay ? validHands : [], color, handlers.current.overlay ? result.face : null);
        }
        handlers.current.onFrame?.(validHands, result);
        if (performance.now() - lastRender.current > 300) {
          lastRender.current = performance.now();
          setSignal({ hands: validHands.length, landmarks: validHands, latency: result.latencyMs, labels: result.handedness.map(h => h[0]?.categoryName).filter(Boolean).join(', ') });
        }
      }
    });
    controller.current = session;
    const hide = () => {
      if (document.hidden) session.stop(!failed);
      else if (!failed) startCamera();
    };
    const leave = () => session.stop();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    if (!document.hidden) startCamera();
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      session.stop(false);
    };
  }, []);

  return { video, canvas, state, signal, aspect, active: state.phase === 'active', starting: state.phase === 'loading', startCamera };
}

// Loads the local experimental number model while `enabled`. classify() always
// resolves: a model result, { status: 'error' } after a failure or timeout, or
// { status: 'cancelled' } when the model is unloaded first.
export function useNumberRecognizer(enabled, offMessage) {
  const worker = useRef(null);
  const pending = useRef(new Map());
  const timer = useRef(null);
  const [modelState, setModelState] = useState({ phase: 'off', message: offMessage });

  function settle(status) {
    for (const [, { resolve, timeout }] of pending.current) { clearTimeout(timeout); resolve({ status, modelVersion: null }); }
    pending.current.clear();
  }
  function unload(status = 'cancelled') {
    clearTimeout(timer.current);
    worker.current?.terminate();
    worker.current = null;
    settle(status);
  }
  function load() {
    unload();
    const current = new Worker(new URL('./recognition.worker.js', import.meta.url), { type: 'module' });
    worker.current = current;
    setModelState({ phase: 'loading', message: 'Loading the local experimental number model…' });
    const fail = () => {
      if (worker.current !== current) return;
      unload('error');
      setModelState({ phase: 'error', message: 'Experimental recognition could not load or run. Check local model assets; tracking still works. You can retry.' });
    };
    current.fail = fail;
    timer.current = setTimeout(fail, 20000);
    current.onerror = fail;
    current.onmessage = ({ data }) => {
      if (worker.current !== current) return;
      if (data.type === 'ready') {
        clearTimeout(timer.current);
        setModelState({ phase: 'ready', modelVersion: data.modelVersion, evaluation: data.evaluation, message: 'Experimental model ready. Numbers 1–5 only; not a signing-correctness assessment.' });
      } else if (data.type === 'error') fail();
      else if (data.type === 'prediction' && pending.current.has(data.requestId)) {
        const { resolve, timeout } = pending.current.get(data.requestId);
        clearTimeout(timeout);
        pending.current.delete(data.requestId);
        resolve(data.result);
      }
    };
    current.postMessage({ type: 'init' });
  }

  useEffect(() => {
    if (enabled) load();
    else setModelState({ phase: 'off', message: offMessage });
    return () => unload();
  }, [enabled]);

  const classify = (frames, durationMs) => new Promise(resolve => {
    const current = worker.current;
    if (!current) return resolve({ status: 'error', modelVersion: null });
    const requestId = crypto.randomUUID();
    pending.current.set(requestId, { resolve, timeout: setTimeout(current.fail, 20000) });
    current.postMessage({ type: 'predict', requestId, frames, durationMs });
  });

  return { modelState, classify, retry: load };
}

export const COUNTDOWN_SECONDS = 3;

// A short visible countdown before a timed capture so the signer can get ready.
export function useCountdown(onDone) {
  const [remaining, setRemaining] = useState(null);
  const timer = useRef(null);
  const done = useRef(onDone);
  done.current = onDone;
  const cancel = () => { clearInterval(timer.current); setRemaining(null); };
  const start = () => {
    clearInterval(timer.current);
    let left = COUNTDOWN_SECONDS;
    setRemaining(left);
    timer.current = setInterval(() => {
      left--;
      if (left > 0) return setRemaining(left);
      clearInterval(timer.current);
      setRemaining(null);
      done.current();
    }, 1000);
  };
  useEffect(() => () => clearInterval(timer.current), []);
  return { remaining, counting: remaining !== null, start, cancel };
}
