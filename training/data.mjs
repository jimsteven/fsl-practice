import { readFile, readdir } from 'node:fs/promises';
import { activeSequence, sequenceFeatures } from '../src/features.js';

export const OTHER = 5;
export const classOf = sample => sample.supported ? sample.datasetId - 20 : OTHER;
export const usable = sample => sample.coverage >= .5 && sample.visibleFrames >= 4;

export async function datasetSamples() {
  let rows;
  try { rows = JSON.parse(await readFile('.tools/fsl105/features-extended.json', 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Run python3 training/add-negatives.py and npm run extract:dataset -- extended first.');
    throw error;
  }
  return rows.map(s => ({ ...s, source: 'fsl105', ...activeSequence(s.sequence) }));
}

// Webcam-test records from .tools/webcam/*.jsonl (or FSL_WEBCAM_DIR), one file per session, with
// "Redo last check" discards applied. Held-out sessions are evaluation only:
// FSL_WEBCAM_HOLDOUT lists session IDs, otherwise the newest session is held
// out. In the other sessions every fourth check calibrates and the rest train.
export async function webcamSamples(directory = process.env.FSL_WEBCAM_DIR || '.tools/webcam') {
  let files = [];
  try { files = (await readdir(directory)).filter(f => f.endsWith('.jsonl')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sessions = [];
  for (const file of files) {
    const lines = (await readFile(`${directory}/${file}`, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    const discarded = new Set(lines.filter(l => l.type === 'discard').map(l => l.trialId));
    const trials = lines.filter(l => l.type === 'trial' && !discarded.has(l.trialId));
    if (trials.length) sessions.push({ id: trials[0].sessionId, startedAt: trials[0].recordedAt, trials });
  }
  sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const holdout = process.env.FSL_WEBCAM_HOLDOUT ? new Set(process.env.FSL_WEBCAM_HOLDOUT.split(',')) : new Set(sessions.slice(-1).map(s => s.id));
  return sessions.flatMap(session => session.trials.map((trial, i) => ({
    path: `webcam/${session.id}/${trial.trialId}`, source: 'webcam', sessionId: session.id, record: trial,
    datasetId: trial.target.signId ? Number(trial.target.signId.split('-')[1]) : null,
    supported: trial.target.kind === 'supported', negativeGroup: trial.target.kind === 'supported' ? null : `webcam-${trial.target.kind}`,
    split: holdout.has(session.id) ? 'test' : i % 4 === 3 ? 'calibration' : 'train',
    durationMs: trial.capture.durationMs, frameCount: trial.capture.frames.length,
    ...activeSequence(sequenceFeatures(trial.capture.frames).sequence)
  })));
}
