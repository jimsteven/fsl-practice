import { useEffect, useRef, useState } from 'react';
import { useCameraTracking, useNumberRecognizer, useCountdown } from './live.js';
import { positionCue } from './tracking.js';
import { finishAttempt, duration } from './sessions.js';
import { candidates, references, referenceSource } from './content.js';
import { CAPTURE_MS } from './features.js';

export function ReferencePanel({ selected }) {
  const reference = useRef(null);
  const [failed, setFailed] = useState(false);
  return <section className="reference-panel" aria-labelledby="reference-title">
    <div className="panel-heading"><span className="eyebrow">01 / Reference</span><span className="small-label">{selected?.reference ? 'FSL-105 / local video' : 'Choose a reference'}</span></div>
    {selected?.reference ? <div className="reference-media">
      <h2 id="reference-title">{selected.label}</h2>
      <video ref={reference} src={selected.reference} aria-label={`FSL reference: ${selected.label}`} controls muted playsInline preload="metadata" onError={() => setFailed(true)} />
      {failed && <p className="camera-status error" role="alert">This reference video could not load. Run the content setup in README, then reload. No substitute video is shown.</p>}
      <label className="select-label">Playback speed<select defaultValue="1" onChange={e => { reference.current.playbackRate = Number(e.target.value); }}><option value="1">Normal</option><option value="0.75">0.75×</option><option value="0.5">0.5×</option></select></label>
      <p className="small-label">Original source orientation, not mirrored. Silent reference clip; the label identifies the isolated sign.</p>
    </div> : <div className="reference-empty">
      <span className={`reference-glyph ${selected ? '' : 'free-glyph'}`} aria-hidden="true">{selected?.glyph || 'Aa'}</span>
      <h2 id="reference-title">{selected ? selected.label : 'A space to learn.'}</h2>
      <p>{selected ? 'Reference awaiting expert review.' : 'Watch a source video. Then make room to try.'}</p>
      {selected ? <span className="small-label">Planning label · not a sign demonstration</span> : <a className="small-label" href="#learn">Browse 30 video references ↗</a>}
    </div>}
    <div className="reference-footnote">{selected?.reference ? <><a href={referenceSource.url} target="_blank" rel="noreferrer">FSL-105 v2</a> · {referenceSource.author} · <a href={referenceSource.license} target="_blank" rel="noreferrer">CC BY 4.0</a>. Re-encoded without audio; no endorsement implied.</> : 'Handshape corrections and a complete alphabet require additional expert review.'}</div>
  </section>;
}

export default function Practice({ selected, onSelect = () => {}, onSave, mirror, setMirror, overlay, setOverlay }) {
  const attempt = useRef(null);
  const pending = useRef(null);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const recognitionSupported = Boolean(selected?.recognitionSupported);
  const { modelState, classify, retry: loadRecognition } = useNumberRecognizer(recognitionSupported, 'Tracking only for this focus. Numbers 1–5 enable experimental recognition automatically.');
  const { video, canvas, state, signal, aspect, active, starting, startCamera } = useCameraTracking({
    overlay,
    onFrame: (validHands, result) => {
      if (!attempt.current) return;
      attempt.current.sampledFrames++;
      attempt.current.framesWithHands += validHands.length > 0 ? 1 : 0;
      attempt.current.latencySum += result.latencyMs;
      if (attempt.current.research && attempt.current.frames.length < 120) attempt.current.frames.push({ time: performance.now() - attempt.current.startedClock, landmarks: validHands });
    },
    onInactive: () => {
      countdown.cancel();
      if (pending.current) {
        setFinished({ ...pending.current.summary, recognition: { status: 'cancelled', modelVersion: pending.current.modelVersion } });
        pending.current = null;
        setClassifying(false);
      }
      if (attempt.current) {
        setFinished(finishAttempt(attempt.current, performance.now()));
        attempt.current = null;
        setRunning(false);
      }
    }
  });

  const countdown = useCountdown(() => begin());

  useEffect(() => {
    // A new focus must not inherit an attempt or a late result from the old sign.
    countdown.cancel();
    pending.current = null;
    attempt.current = null;
    setClassifying(false); setRunning(false); setFinished(null); setElapsed(0); setNotice('');
  }, [selected?.id]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (attempt.current) {
        const time = performance.now() - attempt.current.startedClock;
        setElapsed(time);
        if (attempt.current.research && time >= CAPTURE_MS) finish();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [running]);

  const begin = () => {
    const research = modelState.phase === 'ready' && selected?.recognitionSupported;
    attempt.current = { id: crypto.randomUUID(), draftContentId: selected?.id || null, startedAt: new Date().toISOString(), startedClock: performance.now(), sampledFrames: 0, framesWithHands: 0, latencySum: 0, research, modelVersion: research ? modelState.modelVersion : null, frames: [] };
    setFinished(null); setNotice(''); setElapsed(0); setRunning(true);
  };
  const finish = () => {
    if (!attempt.current) return;
    const current = attempt.current;
    const summary = finishAttempt(current, performance.now());
    if (current.research) {
      pending.current = { id: current.id, summary, modelVersion: current.modelVersion };
      setClassifying(true);
      classify(current.frames, summary.durationMs).then(result => {
        if (pending.current?.id !== current.id) return;
        setFinished({ ...summary, recognition: result.modelVersion ? result : { ...result, modelVersion: current.modelVersion } });
        pending.current = null; setClassifying(false);
      });
    } else setFinished(summary);
    attempt.current = null; setRunning(false);
  };

  const group = references.filter(r => r.group === selected?.group && (!recognitionSupported || r.recognitionSupported));
  const nextSign = selected?.reference ? group[(group.findIndex(r => r.id === selected.id) + 1) % group.length] : null;
  const cue = signal ? positionCue(signal.landmarks, { oneHand: recognitionSupported }) : null;

  return <>
    <div className="practice-focus"><label className="select-label">Practice focus<select value={selected?.id || ''} onChange={e => onSelect(candidates.find(c => c.id === e.target.value) || null)}><option value="">Free hand tracking</option>{candidates.filter(c => c.reference).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><a className="small-label" href="#learn">Open the library ↗</a></div>
    <div className="mode-line"><span className="status-dot" /><strong>{modelState.phase === 'ready' && selected?.recognitionSupported ? 'Experimental number recognition' : 'Tracking only'}</strong><span>No automatic correctness assessment.</span></div>
    <div className="practice-stage">
      <ReferencePanel key={selected?.id || 'free'} selected={selected} />
      <section className="camera-panel" aria-labelledby="camera-title">
        <div className="panel-heading"><h2 id="camera-title" className="eyebrow">02 / Your camera</h2><span className="small-label">{active ? 'On device' : 'Not recording'}</span></div>
        <div className="camera-viewport" style={{ aspectRatio: aspect }}>
          <div className={`media-plane ${mirror ? 'mirrored' : ''}`} hidden={!active}>
            <video ref={video} playsInline muted aria-label="Live camera preview, processed on this device" />
            <canvas ref={canvas} aria-hidden="true" />
          </div>
          {!active && <div className="camera-empty">
            <div className="camera-mark" aria-hidden="true"><span /></div>
            <h3>{starting ? 'Preparing your workspace…' : state.phase === 'error' ? 'Camera unavailable.' : 'Your camera is off.'}</h3>
            <p>{starting ? 'Chrome will reuse your saved camera permission, or ask you to allow access.' : state.phase === 'error' ? 'Check camera access, then retry below.' : 'Camera resumes automatically when you return to this tab.'}</p>
          </div>}
          {active && countdown.counting && <div className="countdown" aria-hidden="true">{countdown.remaining}</div>}
          {active && <div className={`live-caption ${cue?.ready ? 'ready' : ''}`}>{signal ? `${signal.hands} ${signal.hands === 1 ? 'hand' : 'hands'} detected · ${cue.text}` : 'Looking for hands…'}</div>}
        </div>
      </section>
    </div>
    <div className="camera-toolbar">
      <div className="toolbar-actions">
        {state.phase === 'error' && <button className="primary" onClick={() => { setNotice(''); startCamera(); }}>Retry camera <span aria-hidden="true">↗</span></button>}
        <label className="check-control"><input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} />Mirror preview</label>
        <label className="check-control"><input type="checkbox" checked={overlay} onChange={e => setOverlay(e.target.checked)} />Landmarks</label>
      </div>
      <span className="privacy-caption">Automatic in Practice. Leave this page to turn the camera off. No recording.</span>
    </div>
    <p className={`camera-status ${state.phase === 'error' ? 'error' : ''}`} role="status">{state.message}</p>
    <section className="recognition-panel" aria-labelledby="recognition-title">
      <span className="eyebrow">Local / research subset</span><h2 id="recognition-title">Try numbers 1–5.</h2>
      <p>A small CNN trained here on licensed FSL-105 clips. Predictions are experimental: no independent-signer validation, no translation, and no expert grading. Keep one visible hand in frame for the full four-second check. Unsupported signs may still fool the model.</p>
      {recognitionSupported && modelState.phase === 'error' && <button onClick={loadRecognition} disabled={running || classifying}>Retry recognition</button>}
      {!recognitionSupported && <p className="small-label">Choose One, Two, Three, Four or Five in Practice focus for automatic recognition. Other references remain watch-and-practice only.</p>}
      <p className="small-label recognition-status" role="status">{modelState.message}</p>
      {modelState.evaluation && <p className="small-label">Held-out dataset test: {modelState.evaluation.acceptedCorrect}/{modelState.evaluation.positiveClips} supported clips correctly accepted, {modelState.evaluation.positiveAbstentions} declined, {modelState.evaluation.acceptedWrong} accepted incorrectly. {modelState.evaluation.unsupportedClips - modelState.evaluation.unsupportedRejected}/{modelState.evaluation.unsupportedClips} unsupported clips falsely matched. This is not a test of a new signer or your webcam. <a href="/models/numbers/evaluation.json" target="_blank" rel="noreferrer">Full local test report ↗</a></p>}
      {classifying && <p className="recognition-result" role="status">Checking on this device…</p>}
      {finished?.mode === 'experimental-recognition' && !classifying && <div className="recognition-result" role="status">{finished.recognition.label ? `Model suggestion: ${finished.recognition.label}` : finished.recognition.status === 'insufficient-tracking' ? 'No suggestion — keep one hand visible for a full four seconds.' : finished.recognition.status === 'cancelled' ? 'Check cancelled. Start a new full attempt.' : finished.recognition.status === 'error' ? 'Model unavailable. Tracking summary only.' : 'No confident suggestion. Retry or compare with the reference.'}<p className="small-label">Compare with the source video, not a correctness percentage. Detailed signing correction is unavailable.</p></div>}
    </section>
    <div className="practice-notes">
      <section>
        <span className="eyebrow">A little room helps</span>
        <p>Keep your hands inside the frame, use even lighting, and leave space to move. Preview mirroring changes only the display.</p>
        <p className="small-label">{active && signal ? `MediaPipe source labels: ${signal.labels || 'no hands'}. Last tracking call: ${signal.latency.toFixed(0)} ms. ` : ''}Hand labels are not expert-reviewed signing guidance. Detailed correction unavailable.</p>
      </section>
      <section className="attempt-section" aria-labelledby="attempt-title">
        <div className="section-top"><h2 id="attempt-title">{modelState.phase === 'ready' && selected?.recognitionSupported ? 'Four-second check' : 'Practice timer'}</h2><span className="timer">{duration(running ? elapsed : finished?.durationMs || 0)}</span></div>
        <p>Save a summary in this browser, including after reload. No video, raw landmarks or correctness scores are saved.</p>
        <div className="button-row">
          {running ? <button onClick={finish}>Finish attempt</button> : <button disabled={!active || classifying || saving || countdown.counting || modelState.phase === 'loading'} onClick={() => { setFinished(null); setNotice(''); countdown.start(); }}>{finished ? 'Try again' : 'Begin attempt'}</button>}
          {nextSign && finished && !running && !classifying && <button onClick={() => onSelect(nextSign)}>Next sign: {nextSign.label} <span aria-hidden="true">→</span></button>}
          <button disabled={!finished || running || saving || classifying} onClick={async () => {
            setSaving(true); setNotice('');
            try { await onSave(finished); setFinished(null); setElapsed(0); setNotice('Summary saved in this browser. It will survive reload.'); }
            catch (error) { setNotice(error.message); }
            finally { setSaving(false); }
          }}>{saving ? 'Saving…' : 'Save summary'}</button>
          <button className="text-button" disabled={saving || (!finished && !running && !classifying && !countdown.counting)} onClick={() => { countdown.cancel(); attempt.current = null; pending.current = null; setClassifying(false); setRunning(false); setFinished(null); setElapsed(0); setNotice('Attempt reset. Nothing saved.'); }}>Reset</button>
        </div>
        <p className="small-label" role="status">{notice || (countdown.counting ? `Get ready… starting in ${countdown.remaining}.` : running ? 'Timer running. This is not a video recording.' : finished ? `Summary ready. Save it, try again${nextSign ? ', or move to the next sign (unsaved summaries are discarded)' : ''}.` : active ? 'Ready when you are. Begin an attempt to practise.' : 'Camera starts automatically. Allow access in Chrome if asked.')}</p>
      </section>
    </div>
  </>;
}
