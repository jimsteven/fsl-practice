import { readFile, writeFile } from 'node:fs/promises';
import { VOCAB, VOCAB_PREPROCESSING_VERSION, HAND_SIZE, vocabSequence, signSummary, signTips } from '../src/vocab.js';

// Per-sign profiles for Check my signs tips, from FSL-105 train + calibration
// clips only. The test split checks the tips once: correct clips of a sign
// should rarely get a tip, other signs' clips usually should, and an attempt
// moved or reshaped on purpose should get the matching tip.
const dataset = JSON.parse(await readFile('.tools/fsl105/vocab-features.json', 'utf8'));
const summarize = s => { const { sequence } = vocabSequence(s.rows); return sequence && signSummary(sequence); };
const stats = values => { const mean = values.reduce((a, b) => a + b, 0) / values.length; return { mean, std: Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length) }; };
const keys = ['twoHands', 'height', 'side', 'movement'];
const signs = {};
for (const v of VOCAB) {
  const rows = dataset.filter(s => s.vocab && s.datasetId === v.datasetId && s.split !== 'test').map(summarize).filter(Boolean);
  const mean = {}, std = {};
  for (const k of keys) ({ mean: mean[k], std: std[k] } = stats(rows.map(r => r[k])));
  mean.fingers = []; std.fingers = [];
  for (let i = 0; i < 5; i++) { const f = stats(rows.map(r => r.fingers[i])); mean.fingers.push(f.mean); std.fingers.push(f.std); }
  signs[v.gloss] = { examples: rows.length, mean, std };
}

const tipsFor = (summary, gloss) => signTips(summary, signs[gloss]).filter(c => c.tip);
const test = dataset.filter(s => s.vocab && s.split === 'test').map(s => ({ ...s, gloss: VOCAB.find(v => v.datasetId === s.datasetId).gloss, summary: summarize(s) })).filter(s => s.summary);
const correct = test.filter(s => tipsFor(s.summary, s.gloss).length === 0).length;
let wrongPairs = 0, wrongWithTip = 0;
for (const s of test) for (const v of VOCAB) if (v.gloss !== s.gloss) { wrongPairs++; if (tipsFor(s.summary, v.gloss).length) wrongWithTip++; }

// Deliberate changes to correct test clips; each should produce its own tip.
const shift = (rows, f) => rows.map(r => r.map((v, j) => { const slot = Math.floor((j - 1) / HAND_SIZE), k = (j - 1) % HAND_SIZE; return j > 0 && r[1 + slot * HAND_SIZE] === 1 ? f(v, k) : v; }));
const probes = [
  ['hand 4 eye widths lower', rows => shift(rows, (v, k) => k === 2 ? v + 4 : v), /Raise/],
  ['hand 4 eye widths higher', rows => shift(rows, (v, k) => k === 2 ? v - 4 : v), /Lower/],
  ['fingers folded to the wrist', rows => shift(rows, (v, k) => k >= 3 + 3 && k < 66 ? v * .25 : v), /Open your hand|Straighten/],
  ['hand frozen in place', rows => { const first = rows.find(r => r[1] === 1 || r[1 + HAND_SIZE] === 1); return rows.map(r => (r[1] === 1 || r[1 + HAND_SIZE] === 1) ? first : r); }, /bigger|steadier/]
];
const probeResults = probes.map(([name, change, expected]) => {
  let applicable = 0, hit = 0;
  for (const s of test) {
    const { sequence } = vocabSequence(change(s.rows));
    const changed = sequence && signSummary(sequence);
    if (!changed) continue;
    if (name.startsWith('hand frozen') && signs[s.gloss].mean.movement < 1.5) continue; // nothing to freeze
    applicable++;
    if (tipsFor(changed, s.gloss).some(c => expected.test(c.tip))) hit++;
  }
  return `${name}: matching tip ${hit}/${applicable}`;
});

const evaluation = {
  correctSignNoTip: `${correct}/${test.length}`,
  otherSignGetsTip: `${wrongWithTip}/${wrongPairs}`,
  probes: probeResults
};
await writeFile('public/models/vocab/profiles.json', JSON.stringify({ schemaVersion: 1, preprocessingVersion: VOCAB_PREPROCESSING_VERSION, source: 'FSL-105 train + calibration clips', signs, evaluation }, null, 2) + '\n');
console.log(JSON.stringify(evaluation, null, 2));
