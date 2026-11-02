import { references } from './content.js';

// Guided webcam test shared by the browser page and training/webcam-report.mjs.
// Each record keeps the transient landmark frames so later models can be
// re-scored on the same attempts without asking Jim to sign again.
export const PROTOCOL_VERSION = 'webcam-test-v1';
export const ROUNDS = 3;
const SUPPORTED = references.filter(r => r.recognitionSupported);
// Unsupported controls: neighbouring numbers plus common everyday signs.
const UNSUPPORTED = ['fsl105-25', 'fsl105-26', 'fsl105-27', 'fsl105-3', 'fsl105-15', 'fsl105-7'].map(id => references.find(r => r.id === id));

export function buildTrials(random = Math.random) {
  const shuffle = items => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
    return copy;
  };
  const supported = sign => ({ kind: 'supported', signId: sign.id, label: sign.label, reference: sign.reference });
  const unsupported = sign => ({ kind: 'unsupported', signId: sign.id, label: sign.label, reference: sign.reference });
  const noHand = { kind: 'no-hand', signId: null, label: 'No hands', reference: null };
  // Each round has every supported number once, two unsupported signs, and
  // (in the first two rounds) one no-hand check, shuffled within the round.
  return Array.from({ length: ROUNDS }, (_, round) => shuffle([
    ...SUPPORTED.map(supported),
    ...UNSUPPORTED.slice(round * 2, round * 2 + 2).map(unsupported),
    ...(round < 2 ? [noHand] : [])
  ])).flat();
}

export function trialOutcome(trial, result) {
  if (trial.kind === 'supported') {
    if (result.signId === trial.signId) return 'correct';
    if (result.signId) return 'wrong';
    return result.status === 'insufficient-tracking' ? 'refused-tracking' : 'refused';
  }
  return result.signId ? 'false-match' : 'correct-rejection';
}

export const OUTCOME_TEXT = {
  correct: 'Correct suggestion', wrong: 'Wrong suggestion', refused: 'Refused (no confident suggestion)',
  'refused-tracking': 'Refused (hand not tracked long enough)', 'false-match': 'False match', 'correct-rejection': 'Correctly refused'
};

export function summarizeTrials(records) {
  const count = (kind, outcomes) => records.filter(r => r.target.kind === kind && outcomes.includes(r.outcome)).length;
  const bySign = {};
  for (const r of records) {
    const row = bySign[r.target.label] ||= { kind: r.target.kind, trials: 0, correct: 0, wrong: 0, refused: 0, falseMatch: 0, suggestions: {} };
    row.trials++;
    if (r.outcome === 'correct') row.correct++;
    else if (r.outcome === 'wrong') row.wrong++;
    else if (r.outcome === 'false-match') row.falseMatch++;
    else if (r.outcome !== 'correct-rejection') row.refused++;
    if (r.result.label) row.suggestions[r.result.label] = (row.suggestions[r.result.label] || 0) + 1;
  }
  return {
    trials: records.length,
    supported: { trials: count('supported', ['correct', 'wrong', 'refused', 'refused-tracking']), correct: count('supported', ['correct']), wrong: count('supported', ['wrong']), refused: count('supported', ['refused']), refusedTracking: count('supported', ['refused-tracking']) },
    unsupported: { trials: count('unsupported', ['false-match', 'correct-rejection']), rejected: count('unsupported', ['correct-rejection']), falseMatch: count('unsupported', ['false-match']) },
    noHand: { trials: count('no-hand', ['false-match', 'correct-rejection']), rejected: count('no-hand', ['correct-rejection']), falseMatch: count('no-hand', ['false-match']) },
    bySign
  };
}

// Rounds coordinates so a full session stays a few MB while keeping the
// landmark precision MediaPipe actually delivers.
export function compactFrames(frames) {
  const round = n => Math.round(n * 1e5) / 1e5;
  return frames.map(frame => ({ time: Math.round(frame.time), landmarks: frame.landmarks.map(hand => hand.map(p => ({ x: round(p.x), y: round(p.y), z: round(p.z) }))) }));
}
