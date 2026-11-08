import { useEffect, useRef, useState } from 'react';
import { useCameraTracking, useCountdown } from './live.js';
import { VOCAB, MIN_ACTIVE_ROWS, EMOTIONS, VOCAB_PREPROCESSING_VERSION, frameFeatures, vocabSequence, createSegmenter, emotionScores, topEmotion, markAddedWords, signSummary, signTips } from './vocab.js';

const AUTO_INTERPRET_MS = 2000;
const PREVIEW_MS = 300;
const RECORD_ROUNDS = 2;
const EMOTION_COLORS = { Happy: 'var(--emotion-happy)', Sad: 'var(--emotion-sad)', Neutral: 'var(--emotion-neutral)', Angry: 'var(--emotion-angry)', Questioning: 'var(--emotion-question)', Skeptical: 'var(--emotion-skeptical)' };

// Promise wrapper around the vocabulary model worker; always resolves.
function useVocabModel() {
  const worker = useRef(null);
  const pending = useRef(new Map());
  const [state, setState] = useState({ phase: 'loading', message: 'Loading the experimental vocabulary model…' });
  useEffect(() => {
    const current = new Worker(new URL('./vocab.worker.js', import.meta.url), { type: 'module' });
    worker.current = current;
    const fail = message => { setState({ phase: 'error', message: `Vocabulary model unavailable: ${message}` }); for (const resolve of pending.current.values()) resolve(null); pending.current.clear(); };
    current.onerror = () => fail('it could not load.');
    current.onmessage = ({ data }) => {
      if (data.type === 'ready') setState({ phase: 'ready', modelVersion: data.modelVersion, message: `Experimental model ready: ${VOCAB.length} FSL-105 signs.` });
      else if (data.type === 'error' && !data.requestId) fail(data.message);
      else if (pending.current.has(data.requestId)) { pending.current.get(data.requestId)(data.type === 'result' ? data.result : null); pending.current.delete(data.requestId); }
    };
    current.postMessage({ type: 'init' });
    return () => { current.terminate(); worker.current = null; };
  }, []);
  const classify = sequence => new Promise(resolve => {
    if (!worker.current || state.phase !== 'ready') return resolve(null);
    const requestId = crypto.randomUUID();
    pending.current.set(requestId, resolve);
    worker.current.postMessage({ type: 'classify', requestId, sequence });
  });
  return { state, classify };
}

function Sentence({ interpretation, signs }) {
  if (!interpretation) return null;
  if (interpretation.loading) return <p className="interpret-sentence muted">Interpreting with the local LLM…</p>;
  if (interpretation.error) return <p className="interpret-sentence error">{interpretation.error}</p>;
  return <p className="interpret-sentence">{markAddedWords(interpretation.sentence, signs.map(s => s.gloss)).map((part, i) => part.added ? <u key={i} title="Added by the LLM">{part.text}</u> : <span key={i}>{part.text}</span>)}</p>;
}

export default function Interpret({ mirror, overlay }) {
  const [mode, setMode] = useState('interpret');
  const [signs, setSigns] = useState([]);
  const [hud, setHud] = useState({ status: 'rest' });
  const [emotion, setEmotion] = useState(Object.fromEntries(EMOTIONS.map(e => [e, e === 'Neutral' ? 1 : 0])));
  const [interpretation, setInterpretation] = useState(null);
  const [autoInterpret, setAutoInterpret] = useState(true);
  const [server, setServer] = useState({ saving: false, llm: null });
  const [record, setRecord] = useState({ phase: 'idle', index: 0, saved: [], message: '' });
  // Check my signs: one target sign at a time; a locked-in segment is judged
  // against it. "Good job" only means the dataset model recognised the target.
  const [drill, setDrill] = useState({ index: 0, result: null, good: 0, tries: 0, missesInARow: 0, best: 0 });
  const [profiles, setProfiles] = useState(null);
  const vocab = useVocabModel();
  const segmenter = useRef(createSegmenter());
  const segmentEmotion = useRef([]);
  const lastPreview = useRef(0);
  const lastSegmentAt = useRef(0);
  const interpretedCount = useRef(0);
  const emotionRef = useRef(emotion);
  const modeRef = useRef(mode);
  const recordRef = useRef(record);
  const drillRef = useRef(drill);
  const interpretRequest = useRef(0);
  drillRef.current = drill;
  const session = useRef(crypto.randomUUID());
  modeRef.current = mode;
  recordRef.current = record;

  useEffect(() => {
    fetch('/models/vocab/profiles.json').then(r => r.json()).then(p => p.preprocessingVersion === VOCAB_PREPROCESSING_VERSION && setProfiles(p.signs)).catch(() => {});
  }, []);
  useEffect(() => {
    fetch('/health.json').then(r => r.json()).then(h => setServer({ saving: h.webcamSaving === true, llm: h.interpret || null })).catch(() => setServer({ saving: false, llm: null }));
  }, []);

  async function interpretNow(list = signs) {
    if (!list.length) return;
    interpretedCount.current = list.length;
    if (!server.llm) { setInterpretation({ error: 'Sentence interpretation is disabled here. Run the local installer without --skip-llm to enable Ollama. The signs above are what the model recognized.' }); return; }
    // Only the newest request may update the sentence: a slower earlier reply
    // (fewer signs) must not replace a newer one or its loading state.
    const request = ++interpretRequest.current;
    const show = value => { if (request === interpretRequest.current) setInterpretation(value); };
    setInterpretation({ loading: true });
    try {
      const response = await fetch('/api/interpret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signs: list.map(s => ({ gloss: s.gloss, emotion: s.emotion })) }) });
      const body = await response.json();
      show(response.ok ? { sentence: body.sentence, ms: body.ms, model: body.model } : { error: body.error || 'Interpretation failed.' });
    } catch (_error) { show({ error: 'Interpretation failed. Check that the local server and Ollama are running.' }); }
  }

  async function finishSegment(rows) {
    const { sequence, activeRows } = vocabSequence(rows);
    const tones = segmentEmotion.current; segmentEmotion.current = [];
    if (!sequence || activeRows < MIN_ACTIVE_ROWS) { setHud({ status: 'rest' }); return; }
    lastSegmentAt.current = performance.now();
    if (modeRef.current === 'record') return saveRecording(rows);
    const result = await vocab.classify(sequence);
    if (!result) return;
    if (modeRef.current === 'drill') return judgeDrill(result, sequence);
    const avg = Object.fromEntries(EMOTIONS.map(e => [e, tones.reduce((s, t) => s + t[e], 0) / Math.max(1, tones.length)]));
    if (result.accepted) {
      const sign = { id: crypto.randomUUID(), gloss: result.gloss, score: result.score, emotion: tones.length ? topEmotion(avg) : 'Neutral' };
      setSigns(list => [...list, sign]);
      setHud({ status: 'locked', gloss: result.gloss, score: result.score });
    } else setHud({ status: 'unknown', gloss: result.top[0].gloss, score: result.top[0].score });
  }

  const camera = useCameraTracking({
    overlay, face: true,
    onFrame: (hands, result) => {
      const now = performance.now();
      const tones = emotionScores(result.blendshapes);
      const smoothed = Object.fromEntries(EMOTIONS.map(e => [e, emotionRef.current[e] * .8 + tones[e] * .2]));
      emotionRef.current = smoothed;
      const step = segmenter.current.push(frameFeatures(hands, result.face), now);
      if (step.type === 'segment') { finishSegment(step.rows); return; }
      if (step.type === 'signing') {
        segmentEmotion.current.push(tones);
        if (modeRef.current !== 'record' && now - lastPreview.current > PREVIEW_MS) {
          lastPreview.current = now;
          const { sequence, activeRows } = vocabSequence(step.rows);
          if (sequence && activeRows >= MIN_ACTIVE_ROWS) vocab.classify(sequence).then(r => r && setHud(h => h.status === 'locked' && now - lastSegmentAt.current < 600 ? h : { status: 'signing', gloss: r.top[0].gloss, score: r.top[0].score, accepted: r.accepted }));
          else setHud({ status: 'signing' });
        }
      }
    },
    onInactive: () => { segmenter.current.reset(); segmentEmotion.current = []; }
  });

  // Throttled emotion panel updates and hands-free interpretation after a rest.
  useEffect(() => {
    const timer = setInterval(() => {
      setEmotion(emotionRef.current);
      if (modeRef.current === 'interpret' && autoInterpret && signs.length && signs.length !== interpretedCount.current && lastSegmentAt.current && performance.now() - lastSegmentAt.current > AUTO_INTERPRET_MS) interpretNow();
    }, 250);
    return () => clearInterval(timer);
  });
  useEffect(() => {
    const key = event => {
      if (modeRef.current !== 'interpret' || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
      if (event.key === 'Enter') interpretNow();
      if (event.key === 'Backspace') setSigns(list => list.slice(0, -1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // Recording: each vocabulary sign RECORD_ROUNDS times, in order, after a countdown.
  const target = VOCAB[record.index % VOCAB.length];
  const countdown = useCountdown(() => { segmenter.current.reset(); setRecord(r => ({ ...r, phase: 'capturing', message: 'Sign now, then rest your hands.' })); });
  async function saveRecording(rows) {
    const r = recordRef.current;
    if (r.phase !== 'capturing') return;
    const sign = VOCAB[r.index % VOCAB.length];
    const sample = { type: 'sample', schemaVersion: 1, protocolVersion: 'vocab-record-v1', sessionId: session.current, trialId: crypto.randomUUID(), recordedAt: new Date().toISOString(), target: { datasetId: sign.datasetId, gloss: sign.gloss }, rows: rows.map(row => row.map(v => Math.round(v * 1e4) / 1e4)) };
    let message = `Saved ${sign.gloss}.`;
    try {
      const response = await fetch('/api/webcam-trials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sample) });
      if (!response.ok) throw new Error();
    } catch (_error) { message = `Could not save ${sign.gloss}; it was not recorded.`; setRecord(x => ({ ...x, phase: 'paused', message })); return; }
    const next = r.index + 1;
    const done = next >= VOCAB.length * RECORD_ROUNDS;
    setRecord(x => ({ ...x, index: next, saved: [...x.saved, sample.trialId], phase: done ? 'done' : 'between', message: done ? `Recorded ${next} samples. Ask Amp to retrain with them.` : message, last: sample.trialId, lastIndex: r.index }));
    if (!done) setTimeout(() => { if (recordRef.current.phase === 'between') { setRecord(x => ({ ...x, phase: 'countdown' })); countdown.start(); } }, 1200);
  }
  function startRecording() { setRecord(r => ({ ...r, phase: 'countdown', message: '' })); countdown.start(); }
  function redoRecording() {
    const r = recordRef.current;
    if (!r.last) return;
    fetch('/api/webcam-trials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'discard', schemaVersion: 1, protocolVersion: 'vocab-record-v1', sessionId: session.current, trialId: r.last }) });
    countdown.cancel();
    setRecord(x => ({ ...x, index: r.lastIndex, saved: x.saved.filter(id => id !== r.last), last: null, phase: 'idle', message: `Discarded the last ${VOCAB[r.lastIndex % VOCAB.length].gloss}. Start to record it again.` }));
  }

  const drillTarget = VOCAB[drill.index % VOCAB.length];
  // Closeness is shown as a step, never a number: the softmax score is not a
  // measure of signing correctness.
  const CLOSENESS = ['Far from it', 'Getting there', 'Close', 'Recognized'];
  function judgeDrill(result, sequence) {
    const target = VOCAB[drillRef.current.index % VOCAB.length];
    const targetScore = result.scores?.[target.gloss] ?? 0;
    const good = result.accepted && result.gloss === target.gloss;
    const almost = !good && (result.top[0].gloss === target.gloss || targetScore >= .25);
    const closeness = good ? 3 : targetScore >= .5 ? 2 : targetScore >= .15 || almost ? 1 : 0;
    const checks = signTips(signSummary(sequence), profiles?.[target.gloss]);
    const tips = checks.filter(c => c.tip);
    const lookedLike = !good && result.accepted ? `It looked more like ${result.gloss}.` : null;
    const detail = good ? `Recognized as ${target.gloss}.` : tips[0]?.tip
      || (checks.length ? 'Hands, position, shape and movement all look close to the examples. Try once more, a little slower and clearer.' : 'Watch the reference and try once more.');
    setHud({ status: 'rest' });
    setDrill(d => ({ ...d, result: { id: crypto.randomUUID(), good, almost, text: good ? 'Good job!' : almost ? 'Almost!' : 'Try again', detail, lookedLike, checks, closeness },
      good: d.good + (good ? 1 : 0), tries: d.tries + 1, missesInARow: good ? 0 : d.missesInARow + 1, best: Math.max(d.best, closeness) }));
  }
  function nextDrill(step = 1) { setDrill(d => ({ ...d, index: (d.index + step + VOCAB.length) % VOCAB.length, result: null, missesInARow: 0, best: 0 })); setHud({ status: 'rest' }); segmenter.current.reset(); }
  const drillStep = drill.result ? 2 : hud.status === 'signing' ? 1 : 0;

  const stage = !camera.active ? 0 : interpretation?.loading ? 2 : hud.status === 'signing' || hud.status === 'locked' ? 1 : interpretation?.sentence ? 2 : 0;
  const hudText = hud.status === 'signing' ? (hud.gloss ? `${Math.round(hud.score * 100)}% · ${hud.accepted ? 'rest your hands to lock in' : 'keep signing'}` : 'reading your signing…')
    : hud.status === 'locked' ? `${Math.round(hud.score * 100)}% · locked in` : hud.status === 'unknown' ? `not recognized · best guess ${hud.gloss === 'other' ? 'none' : hud.gloss} ${Math.round(hud.score * 100)}%` : 'Sign, then rest your hands between signs';

  return <>
    <div className="mode-line"><span className="status-dot" /><strong>Experimental demo · personal practice</strong><span>{VOCAB.length} FSL-105 signs. Not a translator; suggestions are often wrong.</span></div>
    <div className="category-switch interpret-modes" aria-label="Interpreter mode">
      <button aria-pressed={mode === 'interpret'} onClick={() => { setMode('interpret'); countdown.cancel(); setRecord(r => ({ ...r, phase: r.phase === 'done' ? 'done' : 'idle' })); }}>Interpret</button>
      <button aria-pressed={mode === 'drill'} onClick={() => { setMode('drill'); countdown.cancel(); setHud({ status: 'rest' }); }}>Check my signs</button>
      <button aria-pressed={mode === 'record'} disabled={!server.saving} onClick={() => setMode('record')}>Record my signs</button>
    </div>
    <section className="interpret-stage" aria-label="Interpreter camera">
      <div className="camera-viewport interpret-viewport" style={{ aspectRatio: camera.aspect }}>
        <div className={`media-plane ${mirror ? 'mirrored' : ''}`} hidden={!camera.active}>
          <video ref={camera.video} playsInline muted aria-label="Live camera preview, processed on this device" />
          <canvas ref={camera.canvas} aria-hidden="true" />
        </div>
        {!camera.active && <div className="camera-empty"><h3>{camera.starting ? 'Preparing hand and face tracking…' : 'Camera unavailable.'}</h3><p>{camera.state.message}</p>{camera.state.phase === 'error' && <button className="primary" onClick={camera.startCamera}>Retry camera</button>}</div>}
        {camera.active && mode === 'interpret' && <>
          <div className="gloss-chain" aria-label="Recognized signs">{signs.map(s => <span key={s.id} className="gloss-pill"><span className="emotion-dot" style={{ background: EMOTION_COLORS[s.emotion] }} title={s.emotion} />{s.gloss}</span>)}</div>
          <Sentence interpretation={interpretation} signs={signs} />
          <div className={`sign-hud ${hud.status}`}><strong>{hud.status === 'rest' ? '—' : hud.gloss === 'other' ? '…' : hud.gloss || '…'}</strong><span>{hudText}</span>{hud.score !== undefined && <span className="hud-bar"><span style={{ width: `${Math.round(hud.score * 100)}%` }} /></span>}</div>
          <ul className="emotion-panel" aria-label="Facial expression estimate">{EMOTIONS.map(e => <li key={e} className={topEmotion(emotion) === e ? 'current' : ''}><span className="emotion-dot" style={{ background: EMOTION_COLORS[e] }} />{e}<span className="emotion-bar"><span style={{ width: `${Math.round(emotion[e] * 100)}%` }} /></span></li>)}</ul>
        </>}
        {camera.active && mode === 'drill' && <>
          <div className="capture-badge drill-target">Sign: {drillTarget.gloss}</div>
          {drill.result ? <div key={drill.result.id} className={`drill-verdict ${drill.result.good ? 'good' : drill.result.almost ? 'almost' : 'retry'}`} role="status">
            <span className="drill-verdict-head"><span aria-hidden="true">{drill.result.good ? '✓' : drill.result.almost ? '◐' : '↺'}</span><strong>{drill.result.text}</strong></span>
            {!drill.result.good && <span className="drill-verdict-tip">{drill.result.detail}</span>}
          </div>
            : <div className={`sign-hud ${hud.status}`}><strong>{hud.status === 'signing' ? 'Reading…' : drillTarget.gloss}</strong><span>{hud.status === 'signing' ? 'lower your hands to check' : 'Sign it once, then lower your hands'}</span></div>}
        </>}
        {camera.active && mode === 'record' && <div className="record-overlay">
          {countdown.counting && <div className="countdown" aria-hidden="true">{countdown.remaining}</div>}
          {record.phase === 'capturing' && <div className="capture-badge">● Sign {target.gloss}</div>}
        </div>}
      </div>
      {mode === 'interpret' && <ol className="pipeline" aria-label="Pipeline">{['Hand tracking', 'Emotion detection', 'LLM interpretation'].map((label, i) => <li key={label} className={stage === i ? 'active' : ''}>{label}</li>)}</ol>}
    </section>
    {mode === 'interpret' && <>
      <div className="camera-toolbar">
        <div className="toolbar-actions">
          <button className="primary" disabled={!signs.length || interpretation?.loading} onClick={() => interpretNow()}>Interpret now <span aria-hidden="true">↵</span></button>
          <button disabled={!signs.length} onClick={() => { setSigns(list => list.slice(0, -1)); }}>Undo last sign</button>
          <button className="text-button" disabled={!signs.length && !interpretation} onClick={() => { setSigns([]); setInterpretation(null); interpretedCount.current = 0; interpretRequest.current++; setHud({ status: 'rest' }); }}>Clear</button>
          <label className="check-control"><input type="checkbox" checked={autoInterpret} onChange={e => setAutoInterpret(e.target.checked)} />Interpret after a 2-second rest</label>
        </div>
        <span className="privacy-caption">{server.llm ? `LLM: ${server.llm} via Ollama on this computer` : 'Sentence interpretation requires a local installation with Ollama'}</span>
      </div>
      <p className={`camera-status ${vocab.state.phase === 'error' ? 'error' : ''}`} role="status">{camera.active ? vocab.state.message : camera.state.message}</p>
      <section className="practice-notes">
        <section><span className="eyebrow">How to sign for it</span><p>Face the camera with your face and upper body in view. Sign one word, then lower your hands out of view (or onto the desk) so it can lock in. Underlined words were added by the LLM to make English; the dots show the expression it read from your face for each sign.</p></section>
        <section><span className="eyebrow">Signs it knows</span><p className="vocab-list">{VOCAB.map(v => v.gloss).join(' · ')}</p></section>
      </section>
    </>}
    {mode === 'drill' && <section className="record-panel" aria-labelledby="drill-title">
      <div>
        <ol className="drill-steps" aria-label="Steps">{['Watch the reference', 'Sign it once', 'Lower your hands to check'].map((label, i) => <li key={label} aria-current={drillStep === i ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}</ol>
        <span className="eyebrow">Sign {drill.index + 1} of {VOCAB.length} · {drill.good}/{drill.tries} recognized this session</span>
        <h2 id="drill-title" className="test-label">{drillTarget.gloss}</h2>
        {drill.result && <>
          <p className={`drill-detail ${drill.result.good ? 'good' : drill.result.almost ? 'almost' : 'retry'}`}>{drill.result.good ? `${drill.result.text} ${drill.result.detail}` : drill.result.detail}</p>
          {drill.result.lookedLike && <p className="small-label">{drill.result.lookedLike}</p>}
          <div className="closeness" aria-label={`How close: ${CLOSENESS[drill.result.closeness]}`}>
            <span className="closeness-bar" aria-hidden="true">{CLOSENESS.map((label, i) => <span key={label} className={i <= drill.result.closeness ? 'on' : ''} />)}</span>
            <span>{CLOSENESS[drill.result.closeness]}{drill.best > drill.result.closeness ? ` · best so far: ${CLOSENESS[drill.best]}` : ''}</span>
          </div>
          {!drill.result.good && drill.result.checks.length > 0 && <ul className="drill-checks" aria-label="Compared with the FSL-105 examples">
            {drill.result.checks.map(c => <li key={c.id} className={c.tip ? 'fix' : 'ok'}><span aria-hidden="true">{c.tip ? '→' : '✓'}</span><strong>{c.label}</strong>{c.tip ? <span>{c.tip}</span> : <span>Looks like the examples</span>}</li>)}
          </ul>}
        </>}
        {!drill.result && <p className="drill-detail">Watch the reference on the right, sign it once in front of the camera, then lower your hands. You’ll get a tip after each try.</p>}
        {drill.missesInARow >= 3 && <p className="drill-hint">Still stuck? Skip it for now, or record a few samples of {drillTarget.gloss} in <strong>Record my signs</strong> so the model learns how you sign it.</p>}
        <div className="button-row">
          <button className={drill.result?.good || drill.missesInARow >= 3 ? 'primary' : ''} onClick={() => nextDrill(1)}>{drill.result?.good ? 'Next sign' : 'Skip to next sign'} <span aria-hidden="true">→</span></button>
          <button className="text-button" onClick={() => nextDrill(-1)}>Previous</button>
        </div>
        {(!camera.active || vocab.state.phase !== 'ready') && <p className={`camera-status ${vocab.state.phase === 'error' ? 'error' : ''}`}>{camera.active ? vocab.state.message : camera.state.message}</p>}
        <p className="small-label">Tips compare your try with how a few FSL-105 signers made {drillTarget.gloss}. “Good job” means the experimental model recognized it. Neither is a teacher’s judgement, and it sometimes misses correct signs.</p>
      </div>
      {drillTarget.reference && <video key={drillTarget.datasetId} src={drillTarget.reference} aria-label={`FSL reference: ${drillTarget.gloss}`} muted loop autoPlay playsInline />}
    </section>}
    {mode === 'record' && <section className="record-panel" aria-labelledby="record-title">
      <div>
        <span className="eyebrow">Sample {Math.min(record.index + 1, VOCAB.length * RECORD_ROUNDS)} of {VOCAB.length * RECORD_ROUNDS} · round {Math.min(RECORD_ROUNDS, Math.floor(record.index / VOCAB.length) + 1)}</span>
        <h2 id="record-title" className="test-label">{record.phase === 'done' ? 'All recorded' : target.gloss}</h2>
        <p>Watch the reference, press Start, sign it once after the countdown, then rest your hands. Each sample saves the tracked hand and face positions (no video) to <code>.tools/webcam</code> on this Mac for retraining.</p>
        <div className="button-row">
          <button className="primary" disabled={!camera.active || !['idle', 'paused'].includes(record.phase)} onClick={startRecording}>{record.phase === 'paused' ? 'Resume' : record.index ? 'Continue' : 'Start recording'}</button>
          <button disabled={!record.last} onClick={redoRecording}>Redo last</button>
          <button className="text-button" disabled={['idle', 'done', 'paused'].includes(record.phase)} onClick={() => { countdown.cancel(); setRecord(r => ({ ...r, phase: 'paused', message: 'Paused.' })); }}>Pause</button>
        </div>
        <p className="small-label" role="status">{record.message || `${record.saved.length} saved this session.`}</p>
      </div>
      {record.phase !== 'done' && target.reference && <video key={target.datasetId} src={target.reference} aria-label={`FSL reference: ${target.gloss}`} muted loop autoPlay playsInline />}
    </section>}
  </>;
}
