import { summarizeTrials } from '../src/webcam-test.js';
import { webcamSamples } from './data.mjs';

// What the browser showed during each webcam-test session, using the outcome
// recorded live. evaluate.mjs re-scores held-out sessions with the current model.
const rows = await webcamSamples();
if (!rows.length) { console.log('No webcam-test sessions in .tools/webcam yet.'); process.exit(0); }
for (const id of new Set(rows.map(r => r.sessionId))) {
  const session = rows.filter(r => r.sessionId === id);
  const s = summarizeTrials(session.map(r => r.record));
  console.log(`\nSession ${id} · ${session[0].record.recordedAt} · model ${session[0].record.result.modelVersion} · ${session[0].split === 'test' ? 'held out for evaluation' : 'used for training/calibration'}`);
  console.log(`Numbers 1–5: ${s.supported.correct}/${s.supported.trials} correct, ${s.supported.wrong} wrong, ${s.supported.refused} refused, ${s.supported.refusedTracking} refused for tracking`);
  console.log(`Unsupported signs: ${s.unsupported.rejected}/${s.unsupported.trials} refused, ${s.unsupported.falseMatch} false matches · No hands: ${s.noHand.rejected}/${s.noHand.trials} refused`);
  console.table(Object.fromEntries(Object.entries(s.bySign).map(([label, r]) => [label, { kind: r.kind, trials: r.trials, correct: r.correct, wrong: r.wrong, refused: r.kind === 'supported' ? r.refused : r.trials - r.falseMatch, falseMatch: r.falseMatch, suggested: Object.entries(r.suggestions).map(([k, v]) => `${k}×${v}`).join(' ') }])));
  const failures = session.filter(r => ['wrong', 'refused', 'refused-tracking', 'false-match'].includes(r.record.outcome));
  for (const r of failures) console.log(`  ${r.record.outcome.padEnd(16)} asked ${r.record.target.label.padEnd(10)} got ${String(r.record.result.label).padEnd(6)} reason=${r.record.result.reason || r.record.result.status} score=${r.record.result.score?.toFixed(3) ?? '-'} distance=${r.record.result.distance?.toFixed(3) ?? '-'} coverage=${r.coverage.toFixed(2)} handsFrames=${r.record.capture.framesWithHands}/${r.record.capture.sampledFrames}`);
}
