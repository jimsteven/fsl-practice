export function finishAttempt(attempt, now) {
  return {
    schemaVersion: 1,
    id: attempt.id,
    mode: attempt.research ? 'experimental-recognition' : 'tracking-only',
    kind: 'personal-tracking-exercise',
    draftContentId: attempt.draftContentId,
    startedAt: attempt.startedAt,
    durationMs: Math.max(0, Math.round(now - attempt.startedClock)),
    sampledFrames: attempt.sampledFrames,
    framesWithHands: attempt.framesWithHands,
    trackingLatencyMeanMs: attempt.sampledFrames ? Math.round(attempt.latencySum / attempt.sampledFrames * 10) / 10 : null,
    recognition: attempt.research ? { status: 'cancelled', modelVersion: attempt.modelVersion } : { status: 'not-configured', modelVersion: null },
    detailedCorrection: 'unavailable'
  };
}

export function summarize(sessions) {
  const real = sessions.filter(s => s.schemaVersion === 1 && s.kind === 'personal-tracking-exercise' && ['tracking-only', 'experimental-recognition'].includes(s.mode));
  return { count: real.length, durationMs: real.reduce((n, s) => n + s.durationMs, 0) };
}

export function duration(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
