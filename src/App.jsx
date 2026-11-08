import { useEffect, useRef, useState } from 'react';
import Practice, { ReferencePanel } from './Practice.jsx';
import WebcamTest from './WebcamTest.jsx';
import Interpret from './Interpret.jsx';
import { candidates, referenceSource } from './content.js';
import { duration, summarize } from './sessions.js';
import { readSessions, saveSession, saveReviewNote, clearSessions, exportSessions, retentionDescription } from './storage.js';

const pages = [
  { id: 'practice', label: 'Practice', number: '01' },
  { id: 'interpret', label: 'Interpret', number: '02' },
  { id: 'test', label: 'Webcam test', number: '03' },
  { id: 'learn', label: 'Library', number: '04' },
  { id: 'progress', label: 'Sessions', number: '05' },
  { id: 'teacher', label: 'Review', number: '06' },
  { id: 'privacy', label: 'Settings', number: '07' }
];
const readRoute = () => {
  const hash = window.location.hash.slice(1).split('?')[0];
  return pages.some(p => p.id === hash) || hash === 'detail' ? hash : 'practice';
};
const headings = {
  practice: ['Your practice desk.', 'Filipino Sign Language. A personal study workspace.'],
  interpret: ['Sign it. Read it back.', 'Experimental demo for personal practice: signs become glosses, then a local LLM suggests an English sentence.'],
  test: ['Test the model on your webcam.', 'A guided check of the experimental number model: correct suggestions, wrong suggestions and refusals, counted separately.'],
  learn: ['Start with the source.', 'Attributed Filipino Sign Language video references, served with this app.'],
  progress: ['Time you made for practice.', 'A saved local practice log, not a measure of signing ability.'],
  teacher: ['A second look.', 'Real saved attempts. Your observations, in your own words.'],
  privacy: ['Yours, by default.', 'Clear boundaries for your camera and your data.'],
  detail: ['Watch, then try.', 'Follow the original reference. Keep room for your hands to move.']
};
const readSelection = () => candidates.find(item => item.id === new URLSearchParams(window.location.hash.split('?')[1]).get('sign')) || null;

function Library({ onSelect }) {
  const [category, setCategory] = useState('everyday');
  const [query, setQuery] = useState('');
  const visible = candidates.filter(c => c.category === category && c.label.toLowerCase().includes(query.toLowerCase()));
  return <>
    <div className="editorial-note"><span className="eyebrow">30 source videos / FSL-105</span><p>Greetings, everyday communication and numbers 1–10, from the published FSL-105 research collection. Videos are stored locally with attribution. The alphabet, zero, emergency vocabulary and full curriculum remain unavailable rather than guessed.</p></div>
    <div className="library-toolbar">
      <div className="category-switch" aria-label="Content category">
        {[['everyday', 'Everyday'], ['numbers', 'Numbers'], ['alphabet', 'Alphabet · pending']].map(([id, label]) => <button key={id} aria-pressed={category === id} onClick={() => setCategory(id)}>{label}</button>)}
      </div>
      <span className="small-label">Research references, not a graded curriculum</span>
    </div>
    <label className="search-label">Find a reference<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. Hello" /></label>
    <div className="letter-grid">{visible.map(item => <button className="letter-cell" key={item.id} onClick={() => onSelect(item)}><span className="letter-type" aria-hidden="true">{item.glyph}</span><span>{item.label}</span><span className="small-label">{item.reference ? 'Video reference' : 'Review pending'} <span aria-hidden="true">↗</span></span></button>)}</div>
    {visible.length === 0 && <p className="empty-message" role="status">No references match your search.</p>}
    <p className="fine-print"><a href={referenceSource.url} target="_blank" rel="noreferrer">FSL-105 v2</a> · {referenceSource.author} · <a href={referenceSource.license} target="_blank" rel="noreferrer">CC BY 4.0</a>. {referenceSource.review}</p>
  </>;
}

export function Progress({ sessions, onClear }) {
  const summary = summarize(sessions);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  return <>
    <div className="section-top ruled"><span className="eyebrow">Personal / saved in this browser</span><div className="button-row"><button disabled={!sessions.length} onClick={() => exportSessions(sessions)}>Export summaries</button><button className="text-button" disabled={!sessions.length} onClick={() => setConfirm(true)}>Clear summaries</button></div></div>
    {confirm && <div className="editorial-note"><p>Delete all saved attempts and their review notes from this browser? This cannot be undone.</p><div className="button-row"><button disabled={deleting} onClick={async () => {
      setDeleting(true); setError('');
      try { await onClear(); setConfirm(false); }
      catch (failure) { setError(failure.message); }
      finally { setDeleting(false); }
    }}>{deleting ? 'Deleting…' : 'Delete saved attempts'}</button><button disabled={deleting} onClick={() => setConfirm(false)}>Cancel</button></div>{error && <p role="alert">{error}</p>}</div>}
    {!sessions.length ? <div className="large-empty"><span className="empty-index" aria-hidden="true">—</span><h2>No sessions. No pressure.</h2><p>Start your camera, begin a timed attempt, then save its summary. This is a practice log, not a measure of FSL ability.</p><a className="button primary" href="#practice">Go to practice <span aria-hidden="true">↗</span></a></div> : <>
      <div className="session-overview"><p><strong>{summary.count}</strong> saved {summary.count === 1 ? 'exercise' : 'exercises'}</p><p><strong>{duration(summary.durationMs)}</strong> total practice time</p></div>
      <div className="session-list">{sessions.map((s, i) => <article className="session-row" key={s.id}>
        <div><span className="eyebrow">Exercise {String(i + 1).padStart(2, '0')}</span><h2>{candidates.find(c => c.id === s.draftContentId)?.label || 'Free hand tracking'}</h2><p>{new Date(s.startedAt).toLocaleString()} · {s.mode === 'tracking-only' ? 'Tracking only' : 'Experimental number check'}</p>{s.recognition?.label && <p>Model suggestion: {s.recognition.label} · not a correctness score</p>}{s.reviewNote && <p>Note: {s.reviewNote}</p>}</div>
        <div className="session-stats"><strong>{duration(s.durationMs)}</strong><p>{s.sampledFrames} frames processed · {s.framesWithHands} with hands</p><p>{s.trackingLatencyMeanMs === null ? 'No tracking latency samples' : `${s.trackingLatencyMeanMs} ms mean tracking call`}</p></div>
      </article>)}</div>
    </>}
    <p className="fine-print">{retentionDescription} Clearing browser data also removes this log. Frame counts and model suggestions are not signing correctness or mastery. Tracking call time is not end-to-end latency.</p>
  </>;
}

function ReviewNote({ session, index, onSave }) {
  const [note, setNote] = useState(session.reviewNote || '');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const label = `Exercise ${String(index + 1).padStart(2, '0')}`;
  return <article className="review-row"><span className="eyebrow">{label}</span><h2>{candidates.find(c => c.id === session.draftContentId)?.label || 'Free hand tracking'}</h2><p>{new Date(session.startedAt).toLocaleString()} · {duration(session.durationMs)} · {session.framesWithHands} frames with hands</p><form onSubmit={async e => {
    e.preventDefault(); setSaving(true); setMessage('');
    try { await onSave(session.id, note); setMessage('Note saved in this browser.'); }
    catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }}><label>Review note for {label}<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={3} /></label><button disabled={saving}>{saving ? 'Saving…' : 'Save note'}</button><p role="status" className="small-label">{message}</p></form></article>;
}

function Teacher({ sessions, onSaveNote }) {
  return <>
    <div className="editorial-note"><span className="eyebrow">Your actual practice log</span><p>Write your own observations or review alongside someone you trust, in this browser. Notes are not automated corrections or verified expert feedback. There are no fictional learners, remote teacher accounts, or shared classroom records.</p></div>
    {sessions.length ? sessions.map((session, i) => <ReviewNote key={session.id} session={session} index={i} onSave={onSaveNote} />) : <div className="large-empty"><h2>Something to return to.</h2><p>Save a practice summary first. Your real attempts and editable notes will appear here.</p><a href="#practice">Go to practice ↗</a></div>}
    <p className="fine-print">Anyone using this Mac’s browser profile can see its saved log. Do not put sensitive or other people’s personal information in notes. Separate authenticated teacher access is not enabled.</p>
  </>;
}

function Privacy({ mirror, setMirror, overlay, setOverlay }) {
  return <div className="settings-layout">
    <section><h2>Camera, without the cloud.</h2><p>The camera starts automatically in Practice. Chrome reuses its saved permission for this site, or asks you to allow access. Permission is managed by Chrome, not stored as an app preference; a one-time grant may expire. Video frames and transient MediaPipe landmarks stay on this device. No microphone, recording, uploads, analytics or remote inference.</p><p>Leaving Practice, hiding the tab, or closing the page releases the camera. Returning to Practice or the visible tab resumes it automatically, unless a camera error needs a retry. HTTPS or localhost and camera permission are required. Choose Library to browse without a camera.</p><h2>Recognition follows your focus.</h2><p>Numbers 1–5 load the experimental local matcher automatically. Other signs use tracking only. Begin attempt still starts each timed exercise; choosing a new focus discards the unsaved attempt. Model suggestions are not signing grades.</p><h2>Interpret and the local LLM.</h2><p>The Interpret page also tracks your face (on this device) to anchor hand positions and estimate an expression per sign. Only the recognized glosses and expression tags are sent to the local server, which asks Ollama on the owner’s Mac for an English sentence. Video, face and hand landmarks are never sent. On the shared web version there is no LLM. Recordings made with Record my signs are saved like Webcam test data below.</p><h2>Webcam test data.</h2><p>On the owner’s own Mac, the Webcam test page is the one place that saves hand landmark coordinates: each check’s landmarks and model answer go to <strong>.tools/webcam</strong> in the project folder for evaluation and retraining. On the shared web version nothing is saved or uploaded; results stay in your browser unless you download them. No video or images are saved anywhere.</p><h2>A local practice log.</h2><p>{retentionDescription} Aggregate timing, hand counts, model suggestions (when available), and your notes are stored in IndexedDB. No video, screenshots or raw landmark sequences are saved. No Firebase or cloud account is involved.</p><p>Use the same browser profile and address each time. Incognito, another browser, 127.0.0.1 or clearing site data uses a different or empty log. Export from Sessions before changing browsers.</p><a className="button" href="#progress">Export or delete saved attempts ↗</a></section>
    <section className="settings-side"><span className="eyebrow">Your workspace</span><label className="setting-row"><span><strong>Mirror preview</strong><small>Display only; not signing guidance.</small></span><input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} /></label><label className="setting-row"><span><strong>Landmark overlay</strong><small>Show the tracker’s 21 points per hand.</small></span><input type="checkbox" checked={overlay} onChange={e => setOverlay(e.target.checked)} /></label><p>Preferences last for this tab only. System text size, keyboard focus, and reduced-motion preferences are respected.</p><hr /><h2>Before this grows.</h2><p>This is one personal browser profile, not authenticated access control. Do not collect other people’s or children’s records here. Remote teaching, recording, dataset contributions and school use require separate safeguards.</p><a href="#learn">Browse without a camera <span aria-hidden="true">↗</span></a></section>
  </div>;
}

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [selected, setSelected] = useState(readSelection);
  const [sessions, setSessions] = useState([]);
  const [storageError, setStorageError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mirror, setMirror] = useState(true);
  const [overlay, setOverlay] = useState(true);
  const heading = useRef(null);
  const initial = useRef(true);
  useEffect(() => {
    const change = () => { setRoute(readRoute()); setSelected(readSelection()); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    let mounted = true;
    readSessions().then(rows => { if (mounted) setSessions(rows); }).catch(error => { if (mounted) setStorageError(error.message); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    document.title = `FSL / ${pages.find(p => p.id === route)?.label || 'Reference'} · Personal project`;
    if (!initial.current) heading.current?.focus();
    initial.current = false;
  }, [route]);
  const choose = item => { window.location.hash = `detail?sign=${item.id}`; };
  const persist = async action => {
    try { const rows = await action(); setSessions(rows); setStorageError(''); }
    catch (error) { setStorageError(error.message); throw error; }
  };
  const currentPage = route === 'detail' ? 'learn' : route;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); heading.current?.focus(); }}>Skip to content</a>
    <aside className="sidebar">
      <a className="wordmark" href="#practice" aria-label="FSL personal practice"><span>fsl<span className="wordmark-dot">.</span></span><small>PERSONAL PROJECT</small></a>
      <nav aria-label="Main navigation">{pages.map(page => <a key={page.id} href={`#${page.id}`} aria-current={currentPage === page.id ? 'page' : undefined}><span className="nav-number" aria-hidden="true">{page.number}</span>{page.label}<span className="nav-arrow" aria-hidden="true">↗</span></a>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot" /><span>Local workspace<br /><small>No cloud connection</small></span></div>
    </aside>
    <main id="main-content" className="main-content">
      <div className="topline"><span>FIELDNOTES / FILIPINO SIGN LANGUAGE</span><span className="topline-right">Personal practice, not a translator</span></div>
      <header className="page-header"><div><h1 ref={heading} tabIndex={-1}>{headings[route][0]}</h1><p>{headings[route][1]}</p></div><span className="edition">WORKSPACE<br /><b>NO. 001</b></span></header>
      {storageError && <p className="camera-status error" role="alert">Saved log unavailable: {storageError} Practice is still available. Reload to retry loading saved records.</p>}
      {loading && <p className="small-label" role="status">Opening your local log…</p>}
      {route === 'practice' && <Practice selected={selected} onSelect={item => { window.location.hash = item ? `practice?sign=${item.id}` : 'practice'; }} onSave={session => persist(() => saveSession(session))} {...{ mirror, setMirror, overlay, setOverlay }} />}
      {route === 'interpret' && <Interpret {...{ mirror, overlay }} />}
      {route === 'test' && <WebcamTest {...{ mirror, overlay }} />}
      {route === 'learn' && <Library onSelect={choose} />}
      {route === 'detail' && <><a className="back-link" href="#learn">← Back to library</a><div className="detail-layout"><ReferencePanel selected={selected} /><section><span className="eyebrow">{selected?.group || 'Planning label'}</span><h2>{selected?.reference ? selected.label : 'Not available for instruction.'}</h2><p>{selected?.reference ? 'Watch the complete original movement. Play, pause, replay or slow the video; nothing starts automatically. The source demonstration is not mirrored. Mirroring your own preview changes display only.' : 'No approved reference has been supplied for this planning label. We won’t substitute another sign language or generated signing hands.'}</p><p>{selected?.recognitionSupported ? 'An experimental local matcher can compare a four-second attempt among numbers 1–5. It cannot assess your complete signing or certify correctness.' : 'Video reference and tracking practice are available; automatic recognition of this sign is not supported.'}</p><a className="button primary" href={selected ? `#practice?sign=${selected.id}` : '#practice'}>Open practice <span aria-hidden="true">↗</span></a></section></div></>}
      {route === 'progress' && !loading && <Progress sessions={sessions} onClear={() => persist(clearSessions)} />}
      {route === 'teacher' && !loading && <Teacher sessions={sessions} onSaveNote={(id, note) => persist(() => saveReviewNote(id, note))} />}
      {route === 'privacy' && <Privacy {...{ mirror, setMirror, overlay, setOverlay }} />}
      <footer><span>FSL / A personal learning project</span><span>On-device practice. No cloud uploads. <a href="#privacy">Data & boundaries ↗</a></span></footer>
    </main>
  </div>;
}
