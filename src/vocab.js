// Continuous-signing vocabulary demo: shared by live interpretation, recording,
// dataset extraction and training so preprocessing never drifts between them.
import { references } from './content.js';

export const VOCAB_PREPROCESSING_VERSION = 'two-hand-face-anchored-v1';
export const VOCAB_FRAMES = 24;
export const HAND_SIZE = 66;
export const VOCAB_FRAME_SIZE = 1 + HAND_SIZE * 2;

// Dataset IDs and FSL-105 glosses. Chosen so short everyday sentences are possible.
export const VOCAB = [
  [0, 'GOOD MORNING'], [3, 'HELLO'], [4, 'HOW ARE YOU'], [5, "I'M FINE"], [6, 'NICE TO MEET YOU'],
  [7, 'THANK YOU'], [10, 'UNDERSTAND'], [11, "DON'T UNDERSTAND"], [12, 'KNOW'], [13, "DON'T KNOW"],
  [14, 'NO'], [15, 'YES'], [18, 'SLOW'], [19, 'FAST'], [49, 'TODAY'], [50, 'TOMORROW'], [51, 'YESTERDAY'],
  [52, 'FATHER'], [53, 'MOTHER'], [66, 'DEAF'], [91, 'RICE'], [95, 'HOT'], [96, 'COLD'], [99, 'COFFEE'], [104, 'NO SUGAR']
].map(([datasetId, gloss]) => ({ datasetId, gloss, reference: references.find(r => r.datasetId === datasetId)?.reference || null }));

// MediaPipe face mesh indices used as a body anchor: nose tip and outer eye corners.
const NOSE = 1, LEFT_EYE = 33, RIGHT_EYE = 263;
const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v));

function handFeatures(hand, nose, scale) {
  const wrist = hand[0];
  const palm = Math.hypot(hand[9].x - wrist.x, hand[9].y - wrist.y);
  if (!(palm > .005)) return null;
  const shape = hand.flatMap(p => [clamp((p.x - wrist.x) / palm, 5), clamp((p.y - wrist.y) / palm, 5), clamp((p.z - wrist.z) / palm, 5)]);
  return [1, clamp((wrist.x - nose.x) / scale, 8), clamp((wrist.y - nose.y) / scale, 8), ...shape].slice(0, HAND_SIZE);
}

// One frame: [faceFlag, handA(66), handB(66)]. Each hand keeps its shape
// (wrist-relative, palm-scaled) AND where it is relative to the nose, scaled by
// eye distance, because location distinguishes many FSL signs. Hands are slotted
// by image position (A = image-left of the nose side), not by MediaPipe's
// handedness label, so mirroring for augmentation is just a slot swap + x flip.
export function frameFeatures(hands, face) {
  const out = Array(VOCAB_FRAME_SIZE).fill(0);
  const valid = hands.filter(h => h?.length === 21);
  let nose = { x: .5, y: .35 }, scale = .12;
  if (face?.length > RIGHT_EYE) {
    const eyes = Math.hypot(face[LEFT_EYE].x - face[RIGHT_EYE].x, face[LEFT_EYE].y - face[RIGHT_EYE].y);
    if (eyes > .01) { nose = face[NOSE]; scale = eyes; out[0] = 1; }
  }
  const sorted = [...valid].sort((a, b) => a[0].x - b[0].x);
  const slots = sorted.length === 2 ? sorted : sorted.length === 1 ? (sorted[0][0].x < nose.x ? [sorted[0], null] : [null, sorted[0]]) : [null, null];
  slots.forEach((hand, i) => {
    const f = hand && handFeatures(hand, nose, scale);
    if (f) out.splice(1 + i * HAND_SIZE, HAND_SIZE, ...f);
  });
  return out;
}

export const handsVisible = row => row[1] === 1 || row[1 + HAND_SIZE] === 1;

// Hands resting low in view (e.g. on a desk) count as rest, not signing.
// FSL-105 rest frames have no hands in view. REST_Y (eye-widths below the nose)
// keeps low signing positions: at 7.5 only 5 of 834 dataset clips have fewer
// than 4 active rows (6.5 left 23).
export const REST_Y = 7.5;
export const activeRow = row => [0, 1].some(i => row[1 + i * HAND_SIZE] === 1 && row[3 + i * HAND_SIZE] < REST_Y);

// Crop to the main active run (gaps of up to 3 rows bridged) and resample to
// VOCAB_FRAMES rows. Same rule for dataset clips, recordings and live segments.
export function vocabSequence(rows) {
  const active = rows.flatMap((row, i) => activeRow(row) ? [i] : []);
  if (!active.length) return { sequence: null, activeRows: 0 };
  const runs = [[active[0]]];
  for (const i of active.slice(1)) {
    if (i - runs.at(-1).at(-1) - 1 > 3) runs.push([i]);
    else runs.at(-1).push(i);
  }
  const main = runs.reduce((best, run) => run.length > best.length ? run : best);
  const [start, end] = [main[0], main.at(-1)];
  const sequence = Array.from({ length: VOCAB_FRAMES }, (_, i) => rows[Math.round(start + i * (end - start) / (VOCAB_FRAMES - 1))]);
  return { sequence, activeRows: main.length };
}

// Mirror a sequence: other dominant hand. Swap slots and negate every x value.
export function mirrorSequence(sequence) {
  return sequence.map(row => {
    const flip = hand => hand[0] !== 1 ? hand : hand.map((v, j) => j === 1 || (j >= 3 && (j - 3) % 3 === 0) ? -v : v);
    const a = row.slice(1, 1 + HAND_SIZE), b = row.slice(1 + HAND_SIZE);
    return [row[0], ...flip(b), ...flip(a)];
  });
}

// Live segmentation: a sign is the stretch between rests. Feed one feature row
// per tracking result; returns 'segment' with the finished rows once hands have
// rested for REST_MS, plus a running preview of the current segment.
export const REST_MS = 350;
export const MAX_SEGMENT_MS = 5000;
export const MIN_ACTIVE_ROWS = 4;
export function createSegmenter() {
  let rows = [], times = [], lastActive = null;
  return {
    push(row, time) {
      const active = activeRow(row);
      if (active) lastActive = time;
      if (active || rows.length) { rows.push(row); times.push(time); }
      while (times.length && time - times[0] > MAX_SEGMENT_MS) { rows.shift(); times.shift(); }
      if (rows.length && lastActive !== null && time - lastActive >= REST_MS) {
        const finished = rows; rows = []; times = []; lastActive = null;
        return { type: 'segment', rows: finished };
      }
      return { type: rows.length ? 'signing' : 'rest', rows };
    },
    reset() { rows = []; times = []; lastActive = null; }
  };
}

// Practice tips. An attempt (a vocabSequence) is summarised the same way as the
// FSL-105 examples of each sign (public/models/vocab/profiles.json, written by
// training/vocab-profiles.mjs) and compared metric by metric. Heights and
// movement are in eye widths relative to the nose; fingers are tip-to-wrist
// distance in palm lengths. These are comparisons with a few dataset signers,
// not a teacher's corrections.
const FINGERS = [['thumb', 4], ['index finger', 8], ['middle finger', 12], ['ring finger', 16], ['little finger', 20]];
export function signSummary(sequence) {
  const present = [0, 1].map(i => sequence.filter(r => r[1 + i * HAND_SIZE] === 1).length);
  const o = 1 + (present[0] >= present[1] ? 0 : 1) * HAND_SIZE;
  const rows = sequence.filter(r => r[o] === 1);
  if (!rows.length) return null;
  const mean = f => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  let movement = 0;
  for (let i = 1; i < rows.length; i++) movement += Math.hypot(rows[i][o + 1] - rows[i - 1][o + 1], rows[i][o + 2] - rows[i - 1][o + 2]);
  return {
    twoHands: sequence.filter(r => r[1] === 1 && r[1 + HAND_SIZE] === 1).length / sequence.length,
    height: mean(r => r[o + 2]),
    side: mean(r => Math.abs(r[o + 1])),
    fingers: FINGERS.map(([, t]) => mean(r => Math.hypot(r[o + 3 + t * 3], r[o + 4 + t * 3]))),
    movement,
    face: sequence.filter(r => r[0] === 1).length / sequence.length,
    handInView: rows.length / sequence.length
  };
}

// Minimum spreads so a sign whose examples happen to agree closely does not
// turn tiny differences into tips. Set by hand before the test-split check in
// training/vocab-profiles.mjs.
export const TIP_LIMITS = { z: 1.8, height: .8, side: .8, finger: .3, movementRatio: 2.2 };
export function signTips(summary, profile) {
  if (!summary || !profile) return [];
  const { mean: m, std: s } = profile;
  const z = (value, center, spread, floor) => (value - center) / Math.max(spread, floor);
  const checks = [];
  const view = summary.face < .5 ? 'Keep your face in the camera so it can tell where your hands are.' : summary.handInView < .6 ? 'Keep your hand inside the camera frame for the whole sign.' : null;
  checks.push({ id: 'view', label: 'In view', tip: view });
  const hands = m.twoHands >= .5 && summary.twoHands < .25 ? 'Use both hands. This sign uses two.' : m.twoHands < .2 && summary.twoHands > .5 ? 'Use one hand. This sign uses one.' : null;
  checks.push({ id: 'hands', label: 'Hands', tip: hands });
  const height = z(summary.height, m.height, s.height, TIP_LIMITS.height);
  const side = z(summary.side, m.side, s.side, TIP_LIMITS.side);
  const position = height > TIP_LIMITS.z ? 'Raise your hand higher, to where the reference signs it.' : height < -TIP_LIMITS.z ? 'Lower your hand, to where the reference signs it.'
    : side > TIP_LIMITS.z ? 'Bring your hand closer to the middle of your body.' : side < -TIP_LIMITS.z ? 'Move your hand further out to the side.' : null;
  checks.push({ id: 'position', label: 'Position', tip: position });
  const ratio = (summary.movement + .3) / (m.movement + .3);
  // Movement direction is not checked: in FSL-105 the net travel is dominated
  // by the hand rising into place and dropping away, so it varies more than it
  // tells signs apart.
  const movement = ratio < 1 / TIP_LIMITS.movementRatio ? 'Make the movement bigger, like the reference.' : ratio > TIP_LIMITS.movementRatio ? (m.movement < 1 ? 'Hold your hand steadier. This sign barely moves.' : 'Make the movement smaller and more controlled.') : null;
  checks.push({ id: 'movement', label: 'Movement', tip: movement });
  const fz = summary.fingers.map((v, i) => z(v, m.fingers[i], s.fingers[i], TIP_LIMITS.finger));
  const bent = fz.filter(v => v < -TIP_LIMITS.z).length, straight = fz.filter(v => v > TIP_LIMITS.z).length;
  const worst = fz.reduce((best, v, i) => Math.abs(v) > Math.abs(fz[best]) ? i : best, 0);
  const shape = bent >= 3 ? 'Open your hand more: straighten your fingers.' : straight >= 3 ? 'Close your hand more: bend your fingers in.'
    : Math.abs(fz[worst]) > TIP_LIMITS.z ? `${fz[worst] < 0 ? 'Straighten' : 'Bend'} your ${FINGERS[worst][0]} more.` : null;
  checks.push({ id: 'shape', label: 'Handshape', tip: shape });
  return checks;
}

// Heuristic expression tags from MediaPipe face blendshapes. They describe the
// face, not grammar; FSL non-manual markers need expert review to interpret.
export const EMOTIONS = ['Happy', 'Sad', 'Neutral', 'Angry', 'Questioning', 'Skeptical'];
export function emotionScores(blendshapes) {
  const b = Object.fromEntries((blendshapes || []).map(c => [c.categoryName, c.score]));
  const avg = (...names) => names.reduce((s, n) => s + (b[n] || 0), 0) / names.length;
  const smile = avg('mouthSmileLeft', 'mouthSmileRight');
  const frown = avg('mouthFrownLeft', 'mouthFrownRight');
  const browUp = avg('browInnerUp', 'browOuterUpLeft', 'browOuterUpRight');
  const browDown = avg('browDownLeft', 'browDownRight');
  const asym = Math.abs((b.browOuterUpLeft || 0) - (b.browOuterUpRight || 0)) + Math.abs((b.eyeSquintLeft || 0) - (b.eyeSquintRight || 0)) / 2;
  const raw = {
    Happy: smile * 1.4, Sad: frown * 1.2 + (b.browInnerUp || 0) * .4 * (1 - smile),
    Angry: browDown * 1.3 + avg('noseSneerLeft', 'noseSneerRight') * .6, Questioning: browUp * 1.2 * (1 - browDown),
    Skeptical: asym * 1.5, Neutral: .25
  };
  const total = Object.values(raw).reduce((s, v) => s + v, 0);
  return Object.fromEntries(EMOTIONS.map(e => [e, raw[e] / total]));
}
export const topEmotion = scores => EMOTIONS.reduce((best, e) => scores[e] > scores[best] ? e : best, 'Neutral');

// Glosses whose key word is missing from an LLM sentence (small local models
// sometimes drop a sign). Key word = the gloss's content word or an alias.
const ALIASES = { MOTHER: ['mom', 'mum', 'mama'], FATHER: ['dad', 'papa'], 'THANK YOU': ['thank'], YES: ['yeah'] };
const KEY = { 'GOOD MORNING': 'morning', 'HOW ARE YOU': 'how', "I'M FINE": 'fine', 'NICE TO MEET YOU': 'meet', 'THANK YOU': 'thank', "DON'T UNDERSTAND": 'understand', "DON'T KNOW": 'know', 'NO SUGAR': 'sugar' };
export function missingGlosses(sentence, glosses) {
  const words = sentence.toLowerCase().split(/[^a-z']+/).filter(Boolean);
  return [...new Set(glosses)].filter(g => ![KEY[g] || g.toLowerCase(), ...(ALIASES[g] || [])].some(k => words.some(w => w.startsWith(k.replace(/[^a-z]/g, '')))));
}

// Words of the LLM sentence that do not come from a signed gloss get underlined.
const stem = w => w.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z']/g, '').replace(/'s$/, '').replace(/(ing|ed|er|es|s)$/, '');
export function markAddedWords(sentence, glosses) {
  const signed = new Set(glosses.flatMap(g => g.toLowerCase().replace(/[’']/g, "'").replace(/n't/g, ' not').split(/\s+/)).map(stem));
  return sentence.split(/(\s+)/).map(part => /^\s+$/.test(part) || !part ? { text: part, added: false } : { text: part, added: !signed.has(stem(part)) && !signed.has(stem(part.replace(/n't/i, ''))) });
}
