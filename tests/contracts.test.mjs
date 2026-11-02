import test from 'node:test';
import assert from 'node:assert/strict';
import { finishAttempt, summarize, duration } from '../src/sessions.js';
import { recognitionAvailability } from '../src/model-contract.js';
import { projectPoint, cameraError, positionCue } from '../src/tracking.js';
import { candidates, lexicon, references } from '../src/content.js';
import { handFeatures, sequenceFeatures, activeSequence, decidePrediction } from '../src/features.js';
import { buildTrials, trialOutcome, summarizeTrials } from '../src/webcam-test.js';

test('summaries expose tracking observations, never recognition or raw landmarks; demo rows stay separate', () => {
  const summary = finishAttempt({ id: 'test', draftContentId: null, startedAt: '2026-01-01T00:00:00Z', startedClock: 175, sampledFrames: 3, framesWithHands: 1, latencySum: 40 }, 2111);
  assert.equal(summary.durationMs, 1936);
  assert.equal(summary.trackingLatencyMeanMs, 13.3);
  assert.equal(summary.recognition.status, 'not-configured');
  assert.equal(summary.framesWithHands, 1);
  assert.equal('landmarks' in summary, false);
  assert.equal('accuracy' in summary, false);
  assert.deepEqual(summarize([{ kind: 'demo', durationMs: 99999 }, summary]), { count: 1, durationMs: 1936 });
  assert.equal(duration(61999), '1:01');
  assert.equal(finishAttempt({ sampledFrames: 0, latencySum: 0, startedClock: 10 }, 12).trackingLatencyMeanMs, null);
});

test('missing, foreign, incompatible and unreviewed model manifests cannot turn on recognition', () => {
  for (const manifest of [null, {}, { schemaVersion: 1, language: 'ASL', signIds: ['a'] }, { schemaVersion: 1, language: 'FSL', lexiconVersion: 'planning-1', signIds: ['a'] }, { schemaVersion: 1, language: 'FSL', lexiconVersion: 'planning-1', signIds: 'a' }]) {
    assert.equal(recognitionAvailability(manifest, ['a']).enabled, false);
  }
  assert.equal(lexicon.authoritativeInventoryConfirmed, false);
  assert.deepEqual(lexicon.approvedSignIds, []);
  assert.ok(candidates.filter(c => !c.reference).every(c => c.status === 'review-pending'));
  assert.equal(references.length, 30);
  assert.deepEqual(references.filter(c => c.recognitionSupported).map(c => c.datasetId), [20,21,22,23,24]);
});

test('source projection preserves non-square aspect ratio and source handedness', () => {
  assert.deepEqual(projectPoint({ x: .2, y: .75, z: -.1 }, 1280, 720), { x: 256, y: 540 });
  assert.deepEqual(projectPoint({ x: .8, y: .25 }, 720, 1280), { x: 576, y: 320 });
  assert.match(cameraError({ name: 'NotAllowedError' }), /permission was denied/);
  assert.match(cameraError({ name: 'NotFoundError' }), /No camera/);
});

test('live/research features preserve pose while removing translation/scale, and gaps and multiple hands abstain', () => {
  const hand = Array.from({ length: 21 }, (_, i) => ({ x: .12 + i * .004, y: .23 + i * .009, z: -.003 * i }));
  const transformed = hand.map(p => ({ x: p.x * 1.7 + .1, y: p.y * 1.7 + .2, z: p.z * 1.7 }));
  const expected = handFeatures([hand]);
  assert.equal(expected.length, 64); assert.equal(expected[0], 1);
  handFeatures([transformed]).forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-6));
  assert.notDeepEqual(handFeatures([hand.map(p => ({ ...p, x: 1 - p.x }))]), expected);
  assert.ok(handFeatures([]).every(n => n === 0));
  assert.ok(handFeatures([hand, transformed]).every(n => n === 0));
  assert.equal(sequenceFeatures([{ time: 400, landmarks: [hand] }]).sequence[0][0], 1);
  assert.equal(sequenceFeatures([{ time: 401, landmarks: [hand] }]).sequence[0][0], 0);
  assert.equal(sequenceFeatures([{ time: 0, landmarks: [hand] }, { time: 4000, landmarks: [hand] }]).coverage, .25);
  const gesture = Array.from({ length: 6 }, (_, i) => [1, ...expected.slice(1).map(n => n + i / 10)]);
  const blank = Array(64).fill(0);
  const early = [...gesture, ...Array(18).fill(blank)];
  const late = [...Array(11).fill(blank), ...gesture, ...Array(7).fill(blank)];
  assert.deepEqual(activeSequence(early), activeSequence(late));
  assert.equal(activeSequence(late).visibleFrames, 6);
  assert.equal(activeSequence(late).coverage, 1);
  assert.ok(activeSequence([gesture[0], ...Array(22).fill(blank), gesture[5]]).visibleFrames < 4);
  // A stray hand before a long gap (lowering a hand after the countdown) does not stretch the window.
  const stray = [gesture[5], gesture[5], ...Array(9).fill(blank), ...gesture, ...Array(7).fill(blank)];
  assert.deepEqual(activeSequence(stray), activeSequence(late));
  // Short gaps inside the gesture are kept as gaps rather than splitting it.
  const gappy = activeSequence([...gesture.slice(0, 3), blank, blank, ...gesture.slice(3), ...Array(16).fill(blank)]);
  assert.equal(gappy.visibleFrames, 6);
  assert.ok(gappy.coverage < 1);
  assert.equal(activeSequence(Array(24).fill(blank)).coverage, 0);
});

test('framing cues flag missing, extra, clipped, small and large hands before calling a position good', () => {
  const hand = (cx, cy, size) => Array.from({ length: 21 }, (_, i) => ({ x: cx - size / 2 + (i % 5) * size / 4, y: cy - size / 2 + Math.floor(i / 5) * size / 4, z: 0 }));
  assert.equal(positionCue([]).ready, false);
  assert.match(positionCue([hand(.5, .5, .3), hand(.3, .5, .3)]).text, /one hand/);
  assert.equal(positionCue([hand(.5, .5, .3), hand(.3, .5, .3)], { oneHand: false }).ready, true);
  assert.match(positionCue([hand(.9, .5, .3)]).text, /outside the frame/);
  assert.match(positionCue([hand(.5, .5, .1)]).text, /closer/);
  assert.match(positionCue([hand(.5, .5, .8)]).text, /outside|back/);
  assert.equal(positionCue([hand(.5, .5, .3)]).ready, true);
});

test('webcam protocol covers each number three times plus refusals, and outcomes separate wrong from refused', () => {
  const trials = buildTrials(() => .5);
  assert.equal(trials.length, 23);
  for (const id of ['fsl105-20', 'fsl105-21', 'fsl105-22', 'fsl105-23', 'fsl105-24']) assert.equal(trials.filter(t => t.signId === id).length, 3);
  assert.equal(trials.filter(t => t.kind === 'unsupported').length, 6);
  assert.equal(trials.filter(t => t.kind === 'no-hand').length, 2);
  const three = trials.find(t => t.signId === 'fsl105-22');
  const hello = trials.find(t => t.kind === 'unsupported');
  assert.equal(trialOutcome(three, { status: 'suggestion', signId: 'fsl105-22', label: 'Three' }), 'correct');
  assert.equal(trialOutcome(three, { status: 'suggestion', signId: 'fsl105-21', label: 'Two' }), 'wrong');
  assert.equal(trialOutcome(three, { status: 'unknown' }), 'refused');
  assert.equal(trialOutcome(three, { status: 'insufficient-tracking' }), 'refused-tracking');
  assert.equal(trialOutcome(hello, { status: 'suggestion', signId: 'fsl105-20', label: 'One' }), 'false-match');
  assert.equal(trialOutcome(hello, { status: 'unknown' }), 'correct-rejection');
  const records = [['correct', three, 'Three'], ['wrong', three, 'Two'], ['refused-tracking', three, null], ['false-match', hello, 'One']].map(([outcome, t, label]) => ({ outcome, target: t, result: { label } }));
  const summary = summarizeTrials(records);
  assert.deepEqual(summary.supported, { trials: 3, correct: 1, wrong: 1, refused: 0, refusedTracking: 1 });
  assert.deepEqual(summary.unsupported, { trials: 1, rejected: 0, falseMatch: 1 });
  assert.deepEqual(summary.bySign.Three.suggestions, { Three: 1, Two: 1 });
});

test('the trailing "other" class always abstains, even with a confident score', () => {
  const manifest = { modelVersion: 't', labels: ['One', 'Two', 'Three', 'Four', 'Five'], signIds: [20, 21, 22, 23, 24].map(id => `fsl105-${id}`), rejection: Array(5).fill({ minScore: .5, maxDistance: 1 }), prototypes: Array(5).fill([Array(63).fill(0)]) };
  assert.equal(decidePrediction([.01, .01, .01, .01, .01, .95], Array(63).fill(0), manifest).label, null);
  assert.equal(decidePrediction([.01, .01, .9, .01, .01, .06], Array(63).fill(0), manifest).label, 'Three');
  assert.equal(decidePrediction([.01, .01, .9, .01, .01, .06], Array(63).fill(2), manifest).reason, 'novel-shape');
});
