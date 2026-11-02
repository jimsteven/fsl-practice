// Shared, versioned preprocessing for dataset extraction AND live inference.
// One visible hand only; the limited number matcher does not interpret two-hand signs.
export const PREPROCESSING_VERSION = 'one-hand-main-segment-xyz-v3';
export const FRAME_COUNT = 24;
export const FRAME_SIZE = 64;
export const CAPTURE_MS = 4000;

export function handFeatures(hands) {
  if (hands.length !== 1 || hands[0].length !== 21) return Array(FRAME_SIZE).fill(0);
  const hand = hands[0];
  const wrist = hand[0];
  const scale = Math.hypot(hand[9].x - wrist.x, hand[9].y - wrist.y);
  if (!Number.isFinite(scale) || scale < 0.01) return Array(FRAME_SIZE).fill(0);
  const values = hand.flatMap(point => ['x', 'y', 'z'].map(axis => Math.max(-5, Math.min(5, (point[axis] - wrist[axis]) / scale))));
  if (!values.every(Number.isFinite)) return Array(FRAME_SIZE).fill(0);
  return [1, ...values];
}

export function sequenceFeatures(frames) {
  const sequence = Array.from({ length: FRAME_COUNT }, (_, i) => {
    const time = i * CAPTURE_MS / (FRAME_COUNT - 1);
    let nearest = null;
    for (const frame of frames) {
      if (!nearest || Math.abs(frame.time - time) < Math.abs(nearest.time - time)) nearest = frame;
    }
    return nearest && Math.abs(nearest.time - time) <= 400 ? handFeatures(nearest.landmarks) : Array(FRAME_SIZE).fill(0);
  });
  return { sequence, coverage: sequence.filter(row => row[0] === 1).length / FRAME_COUNT };
}

// Crop to the main signing segment: the run of visible rows with the most hands
// once gaps longer than MAX_GAP_ROWS split runs. Short gaps inside the gesture
// stay as gaps; a stray hand at the start or end (e.g. lowering a hand after
// the countdown) no longer stretches the window. Both offline clips and live
// checks first use the same four-second sampling grid.
const MAX_GAP_ROWS = 3;
export function activeSequence(frames) {
  const visible = frames.flatMap((frame, i) => frame[0] === 1 ? [i] : []);
  if (!visible.length) return { sequence: frames, coverage: 0, visibleFrames: 0 };
  const segments = [[visible[0]]];
  for (const i of visible.slice(1)) {
    if (i - segments.at(-1).at(-1) - 1 > MAX_GAP_ROWS) segments.push([i]);
    else segments.at(-1).push(i);
  }
  const main = segments.reduce((best, segment) => segment.length > best.length ? segment : best);
  const start = main[0], end = main.at(-1);
  const sequence = Array.from({ length: FRAME_COUNT }, (_, i) => frames[Math.round(start + i * (end - start) / (FRAME_COUNT - 1))]);
  return { sequence, coverage: sequence.filter(row => row[0] === 1).length / FRAME_COUNT, visibleFrames: main.length };
}

export function meanShape(sequence) {
  const visible = sequence.filter(frame => frame[0] === 1);
  if (!visible.length) return Array(FRAME_SIZE - 1).fill(0);
  return Array.from({ length: FRAME_SIZE - 1 }, (_, i) => visible.reduce((sum, frame) => sum + frame[i + 1], 0) / visible.length);
}

export function shapeDistance(a, b) {
  return Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length);
}

// Scores may include a trailing "other" class (unsupported signs); choosing it
// always abstains. score/distance are kept for webcam-test failure analysis.
export function decidePrediction(scores, shape, manifest) {
  const index = scores.indexOf(Math.max(...scores));
  const diagnostics = { topIndex: index, score: scores[index], scores };
  if (index >= manifest.labels.length) return { status: 'unknown', reason: 'other', label: null, modelVersion: manifest.modelVersion, ...diagnostics };
  const policy = manifest.rejection[index];
  const distance = Math.min(...manifest.prototypes[index].map(reference => shapeDistance(shape, reference)));
  if (!policy || scores[index] < policy.minScore || distance > policy.maxDistance) return { status: 'unknown', reason: scores[index] < (policy?.minScore ?? Infinity) ? 'low-score' : 'novel-shape', label: null, modelVersion: manifest.modelVersion, ...diagnostics, distance };
  return { status: 'suggestion', label: manifest.labels[index], signId: manifest.signIds[index], modelVersion: manifest.modelVersion, ...diagnostics, distance };
}
