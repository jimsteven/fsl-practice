import { PREPROCESSING_VERSION, FRAME_COUNT, FRAME_SIZE } from './features.js';

// Validated linguistic assessment remains gated. Experimental research matching
// has a distinct contract and explicit user opt-in; it never becomes correctness.
// A compatible manifest is necessary, not sufficient: provenance and evaluation
// must be reviewed outside the browser before a future adapter can be enabled.
export function recognitionAvailability(manifest, approvedSignIds = []) {
  if (!manifest) return { enabled: false, reason: 'FSL recognition is not configured.' };
  if (manifest.schemaVersion !== 1 || manifest.language !== 'FSL' || manifest.lexiconVersion !== 'planning-1') {
    return { enabled: false, reason: 'Incompatible FSL model manifest.' };
  }
  if (!Array.isArray(manifest.signIds) || !manifest.signIds.length || manifest.signIds.some(id => !approvedSignIds.includes(id))) {
    return { enabled: false, reason: 'Model labels are not in an approved lexicon.' };
  }
  return { enabled: false, reason: 'Recognition adapter awaits independent provenance, preprocessing, and validation review.' };
}

export const recognition = recognitionAvailability(null);

export function validateExperimentalManifest(manifest) {
  const valid = manifest?.schemaVersion === 1 && manifest.status === 'experimental' && manifest.language === 'FSL'
    && manifest.preprocessingVersion === PREPROCESSING_VERSION && manifest.captureMs === 4000
    && manifest.inputShape?.join(',') === [FRAME_COUNT, FRAME_SIZE].join(',')
    && manifest.signIds?.length === 5 && manifest.signIds.every((id, i) => id === `fsl105-${20 + i}`)
    && manifest.labels?.join(',') === 'One,Two,Three,Four,Five' && manifest.outputClasses === 6
    && manifest.provenance?.doi === '10.17632/48y2y99mb9.2' && manifest.provenance.license === 'CC BY 4.0'
    && /^[a-f0-9]{64}$/.test(manifest.hashes?.model || '') && /^[a-f0-9]{64}$/.test(manifest.hashes?.weights || '')
    && manifest.minCoverage === .5 && manifest.minVisibleFrames === 4 && typeof manifest.modelVersion === 'string'
    && Array.isArray(manifest.rejection) && manifest.rejection.length === 5
    && manifest.rejection.every(p => Number.isFinite(p.minScore) && p.minScore >= 0 && p.minScore <= 1.000001 && Number.isFinite(p.maxDistance) && p.maxDistance >= 0)
    && Array.isArray(manifest.prototypes) && manifest.prototypes.length === 5
    && manifest.prototypes.every(group => Array.isArray(group) && group.length > 0 && group.every(shape => Array.isArray(shape) && shape.length === FRAME_SIZE - 1 && shape.every(Number.isFinite)));
  if (!valid) throw new Error('Incompatible experimental FSL model. Tracking remains available.');
}
