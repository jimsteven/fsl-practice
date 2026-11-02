// One personal browser profile, not cloud storage or a teacher authorization system.
// Store deliberate aggregate saves only; never camera frames or landmark sequences.
const DATABASE = 'fsl-personal-practice';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const retentionDescription = 'Local log: up to 200 attempts from the last 30 days. Older entries are removed when this log opens or changes. Export or delete at any time.';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('Browser storage is unavailable. Your attempt has not been saved.'));
    request.onblocked = () => reject(new Error('Close other FSL tabs, then retry saving.'));
  });
}

async function transaction(operation) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      let result;
      operation(tx.objectStore('sessions'), value => { result = value; });
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(new Error('Browser storage could not finish. Nothing is confirmed saved; free some space and retry.'));
    });
  } finally { db.close(); }
}

function retained(store, done) {
  const request = store.getAll();
  request.onsuccess = () => {
    const ordered = request.result.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    const keep = [];
    for (const row of ordered) {
      if (Date.now() - new Date(row.startedAt).getTime() >= RETENTION_MS || keep.length >= 200) store.delete(row.id);
      else keep.push(row);
    }
    done(keep);
  };
}

export function readSessions() {
  return transaction(retained);
}

export function saveSession(session) {
  // Explicit allowlist keeps future transient tracking fields out of the database.
  const row = {
    schemaVersion: 1, id: session.id, kind: session.kind, mode: session.mode,
    draftContentId: session.draftContentId, startedAt: session.startedAt,
    durationMs: session.durationMs, sampledFrames: session.sampledFrames,
    framesWithHands: session.framesWithHands, trackingLatencyMeanMs: session.trackingLatencyMeanMs,
    recognition: session.recognition, detailedCorrection: 'unavailable', reviewNote: ''
  };
  return transaction((store, done) => {
    store.add(row);
    retained(store, done);
  });
}

export function saveReviewNote(id, note) {
  if (typeof note !== 'string' || note.length > 2000) throw new Error('Keep the review note within 2,000 characters.');
  return transaction((store, done) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, reviewNote: note.trim() });
      retained(store, done);
    };
  });
}

export function clearSessions() {
  return transaction((store, done) => { store.clear(); done([]); });
}

export function exportSessions(sessions) {
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), sessions }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'fsl-personal-sessions.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
