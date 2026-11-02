import { useEffect, useRef, useState } from 'react';
import { useCameraTracking, useNumberRecognizer, useCountdown } from './live.js';
import { positionCue } from './tracking.js';
import { CAPTURE_MS } from './features.js';
import { PROTOCOL_VERSION, buildTrials, trialOutcome, summarizeTrials, compactFrames, OUTCOME_TEXT } from './webcam-test.js';

const AUTO_ADVANCE_MS = 2500;

function post(body) {
  return fetch('/api/webcam-trials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); });
}

function download(sessionId, records) {
  const blob = new Blob([JSON.stringify({ protocolVersion: PROTOCOL_VERSION, sessionId, exportedAt: new Date().toISOString(), records }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `fsl-webcam-test-${sessionId.slice(0, 8)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Summary({ records }) {
  const s = summarizeTrials(records);
  return <div className="test-summary">
    <div className="session-overview">
      <p><strong>{s.supported.correct}/{s.supported.trials}</strong> numbers 1–5 correctly suggested</p>
      <p><strong>{s.supported.wrong}</strong> wrong suggestions</p>
      <p><strong>{s.supported.refused + s.supported.refusedTracking}</strong> refusals ({s.supported.refusedTracking} for tracking)</p>
      <p><strong>{s.unsupported.falseMatch + s.noHand.falseMatch}/{s.unsupported.trials + s.noHand.trials}</strong> unsupported or no-hand checks falsely matched</p>
    </div>
    <table className="result-table">
      <caption className="eyebrow">Per sign</caption>
      <thead><tr><th scope="col">Asked for</th><th scope="col">Trials</th><th scope="col">Correct</th><th scope="col">Wrong</th><th scope="col">Refused</th><th scope="col">False match</th><th scope="col">Model suggested</th></tr></thead>
      <tbody>{Object.entries(s.bySign).map(([label, row]) => <tr key={label}><th scope="row">{label}{row.kind !== 'supported' ? ' (should refuse)' : ''}</th><td>{row.trials}</td><td>{row.kind === 'supported' ? row.correct : '—'}</td><td>{row.kind === 'supported' ? row.wrong : '—'}</td><td>{row.kind === 'supported' ? row.refused : row.trials - row.falseMatch}</td><td>{row.kind === 'supported' ? '—' : row.falseMatch}</td><td>{Object.entries(row.suggestions).map(([k, v]) => `${k} ×${v}`).join(', ') || 'Nothing'}</td></tr>)}</tbody>
    </table>
  </div>;
}

export default function WebcamTest({ mirror, overlay }) {
  const [phase, setPhase] = useState('intro');
  const [trials, setTrials] = useState([]);
  const [index, setIndex] = useState(0);
  const [records, setRecords] = useState([]);
  const [last, setLast] = useState(null);
  const [save, setSave] = useState({ saved: 0, failed: 0, file: '' });
  const [message, setMessage] = useState('');
  // Only Jim's own local server saves records; the shared web version keeps
  // results in the visitor's browser.
  const [saving, setSaving] = useState(false);
  const session = useRef(null);
  const capture = useRef(null);
  const timer = useRef(null);
  const indexRef = useRef(0);
  const { modelState, classify } = useNumberRecognizer(true, 'Loading the experimental number model…');
  const camera = useCameraTracking({
    overlay,
    onFrame: (hands, result) => {
      const c = capture.current;
      if (!c) return;
      c.sampledFrames++;
      c.framesWithHands += hands.length ? 1 : 0;
      c.latencySum += result.latencyMs;
      if (c.frames.length < 120) c.frames.push({ time: performance.now() - c.startedClock, landmarks: hands });
    },
    onInactive: () => pause('Camera stopped, so the current check was discarded. It resumes from this trial.')
  });
  const countdown = useCountdown(() => startCapture());
  const trial = trials[index];
  const running = ['countdown', 'capturing', 'checking', 'result'].includes(phase);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    fetch('/health.json').then(r => r.json()).then(h => setSaving(h.webcamSaving === true)).catch(() => setSaving(false));
  }, []);

  function persist(body) {
    if (!saving) return Promise.resolve();
    return post(body).then(({ file }) => setSave(s => ({ ...s, saved: s.saved + (body.type === 'trial' ? 1 : 0), file })))
      .catch(() => setSave(s => ({ ...s, failed: s.failed + 1 })));
  }
  function runTrial(next) {
    indexRef.current = next;
    setIndex(next); setPhase('countdown'); setMessage('');
    countdown.start();
  }
  function start() {
    session.current = crypto.randomUUID();
    setTrials(buildTrials()); setRecords([]); setLast(null); setSave({ saved: 0, failed: 0, file: '' });
    runTrial(0);
  }
  function pause(text = 'Paused. Resume when you are ready.') {
    clearTimeout(timer.current);
    countdown.cancel();
    capture.current = null;
    setPhase(current => ['countdown', 'capturing', 'checking', 'result'].includes(current) ? 'paused' : current);
    setMessage(text);
  }
  function startCapture() {
    capture.current = { startedClock: performance.now(), startedAt: new Date().toISOString(), frames: [], sampledFrames: 0, framesWithHands: 0, latencySum: 0 };
    setPhase('capturing');
    timer.current = setTimeout(finishCapture, CAPTURE_MS);
  }
  async function finishCapture() {
    const c = capture.current;
    if (!c) return;
    capture.current = null;
    const durationMs = Math.round(performance.now() - c.startedClock);
    const current = trials[indexRef.current];
    setPhase('checking');
    const result = await classify(c.frames, durationMs);
    if (['error', 'cancelled'].includes(result.status)) { pause('The model could not check this attempt. Nothing was recorded; resume to retry this trial.'); return; }
    const record = {
      type: 'trial', schemaVersion: 1, protocolVersion: PROTOCOL_VERSION, sessionId: session.current, trialId: crypto.randomUUID(),
      trialIndex: indexRef.current, trialCount: trials.length, recordedAt: c.startedAt,
      target: { kind: current.kind, signId: current.signId, label: current.label },
      outcome: trialOutcome(current, result), result,
      capture: { durationMs, sampledFrames: c.sampledFrames, framesWithHands: c.framesWithHands, trackingLatencyMeanMs: c.sampledFrames ? Math.round(c.latencySum / c.sampledFrames) : null, frames: compactFrames(c.frames) },
      environment: { videoWidth: camera.video.current?.videoWidth || null, videoHeight: camera.video.current?.videoHeight || null, mirrorPreview: mirror }
    };
    setRecords(rows => [...rows, record]);
    setLast(record);
    persist(record);
    setPhase('result');
    timer.current = setTimeout(() => {
      if (indexRef.current + 1 >= trials.length) setPhase('done');
      else runTrial(indexRef.current + 1);
    }, AUTO_ADVANCE_MS);
  }
  function redoLast() {
    if (!last) return;
    pause();
    persist({ type: 'discard', schemaVersion: 1, protocolVersion: PROTOCOL_VERSION, sessionId: session.current, trialId: last.trialId });
    setRecords(rows => rows.filter(r => r.trialId !== last.trialId));
    runTrial(last.trialIndex);
    setLast(null);
  }

  const cue = camera.signal ? positionCue(camera.signal.landmarks, { oneHand: true }) : null;
  const ready = camera.active && modelState.phase === 'ready';
  const instruction = !trial ? '' : trial.kind === 'supported' ? `Sign ${trial.label} with one hand.` : trial.kind === 'unsupported' ? `Sign ${trial.label}. It is not a number, so the model should refuse.` : 'Keep both hands out of view.';
  const phaseText = phase === 'countdown' ? `Get ready… ${countdown.remaining}` : phase === 'capturing' ? 'Signing now — hold for four seconds.' : phase === 'checking' ? 'Checking on this device…' : phase === 'result' && last ? `${OUTCOME_TEXT[last.outcome]}. Model: ${last.result.label || 'no suggestion'}.` : '';

  return <>
    <div className="test-stage">
      {phase === 'intro' && <section className="test-target" aria-labelledby="test-target-title">
        <span className="eyebrow">About four minutes · 23 checks</span>
        <h2 id="test-target-title">How this works</h2>
        <p>Each check counts down from three, records four seconds of hand tracking, then shows what the experimental model suggested. You will sign numbers One to Five three times each, six signs that are not numbers, and two checks with no hands in view. The next check starts by itself; pause at any time.</p>
        {saving ? <p>To evaluate and retrain the model, each check saves the tracked hand landmark coordinates and the model’s answer to <code>.tools/webcam</code> in the project folder on this Mac. No video or images are saved, and nothing leaves this Mac. Delete that folder to remove them.</p> : <p>Everything runs in this browser. No video, images or results are uploaded; use Download results at the end to keep a copy of the counts and tracked hand landmarks.</p>}
        <p className="small-label">Sit about an arm’s length from the camera in even light, with your signing hand at chest height. This tests the model, not your signing.</p>
        <div className="button-row"><button className="primary" disabled={!ready} onClick={start}>Start webcam test <span aria-hidden="true">↗</span></button></div>
        <p className="small-label" role="status">{!camera.active ? camera.state.message : modelState.message}</p>
      </section>}
      {phase === 'done' && <section className="test-target" aria-labelledby="test-target-title">
        <span className="eyebrow">Test complete · {records.length} checks</span>
        <h2 id="test-target-title">Your webcam results</h2>
        <p role="status">{!saving ? 'Results stay in this browser. Download them to keep a copy.' : save.failed ? `${save.failed} records could not be saved to the project folder. Download the results instead.` : save.file ? `Saved to ${save.file} on this Mac for evaluation and retraining.` : 'Nothing saved.'}</p>
        <div className="button-row"><button className="primary" disabled={!ready} onClick={start}>Run the test again</button><button disabled={!records.length} onClick={() => download(session.current, records)}>Download results</button></div>
      </section>}
      {trial && !['intro', 'done'].includes(phase) && <section className="test-target" aria-labelledby="test-target-title">
        <span className="eyebrow">Trial {index + 1} of {trials.length}</span>
        <h2 id="test-target-title" className="test-label">{trial.label}</h2>
        <p>{instruction}</p>
        {trial.reference && <video key={trial.signId} src={trial.reference} aria-label={`FSL reference: ${trial.label}`} muted loop autoPlay playsInline />}
        <progress max={trials.length} value={records.length} aria-label="Checks completed">{records.length} of {trials.length}</progress>
      </section>}
      <section className="camera-panel" aria-label="Your camera">
        <div className="camera-viewport" style={{ aspectRatio: camera.aspect }}>
          <div className={`media-plane ${mirror ? 'mirrored' : ''}`} hidden={!camera.active}>
            <video ref={camera.video} playsInline muted aria-label="Live camera preview, processed on this device" />
            <canvas ref={camera.canvas} aria-hidden="true" />
          </div>
          {!camera.active && <div className="camera-empty"><h3>{camera.starting ? 'Preparing your camera…' : 'Camera unavailable.'}</h3><p>{camera.state.message}</p></div>}
          {camera.active && phase === 'countdown' && <div className="countdown" aria-hidden="true">{countdown.remaining}</div>}
          {camera.active && phase === 'capturing' && <div className="capture-badge" aria-hidden="true">● Signing</div>}
          {camera.active && <div className={`live-caption ${cue?.ready ? 'ready' : ''}`}>{trial?.kind === 'no-hand' && running ? (camera.signal?.hands ? 'Hands visible — lower them out of view.' : 'No hands in view.') : cue ? cue.text : 'Looking for hands…'}</div>}
        </div>
        {camera.state.phase === 'error' && <button className="primary" onClick={camera.startCamera}>Retry camera</button>}
      </section>
    </div>
    {(phase !== 'intro' && phase !== 'done') && <div className="camera-toolbar">
      <div className="toolbar-actions">
        {running ? <button onClick={() => pause()}>Pause</button> : <button className="primary" disabled={!ready} onClick={() => runTrial(index)}>Resume</button>}
        <button disabled={!last || phase === 'checking'} onClick={redoLast}>Redo last check</button>
        <button className="text-button" onClick={() => { pause(); setPhase('done'); }}>End test now</button>
      </div>
      <span className="privacy-caption">{records.length} recorded{saving ? ` · ${save.saved} saved to this Mac${save.failed ? ` · ${save.failed} not saved` : ''}` : ' · kept in this browser'}</span>
    </div>}
    {phase !== 'intro' && phase !== 'done' && <p className={`camera-status ${phase === 'result' && last && ['wrong', 'false-match'].includes(last.outcome) ? 'error' : ''}`} role="status">{message || phaseText}</p>}
    {phase === 'done' && <>
      {records.length ? <Summary records={records} /> : <p>No checks were recorded.</p>}
      <p className="fine-print">These counts describe the experimental model on your webcam today. They are not a grade of your signing.</p>
    </>}
  </>;
}
