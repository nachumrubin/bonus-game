// loadStats.mjs — pure aggregation for the staging load test.
//
// Samples stream in from worker processes; the coordinator buckets them into
// ramp steps and evaluates the stop conditions (SLOs) per step.

export const DEFAULT_SLO = Object.freeze({
  txP95Ms: 1000,        // room commit (transaction) round trip
  visibleP95Ms: 2000,   // opponent sees a move this long after it was made
  errorRate: 0.005,     // failed writes+transactions / all (excl. version aborts)
  setupFailRate: 0.2,   // games that could not even start
});

export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx];
}

export function createStep(index, targetGames, startedAt) {
  return {
    index, targetGames, startedAt, endedAt: null,
    tx: [], txAborted: 0, txFailed: 0, writes: 0, writeFailed: 0, visible: [],
    errorsByCode: {}, gamesStarted: 0, gamesFinished: 0, setupFailed: 0,
    violations: {}, earlyCommitLost: 0, activeGamesSamples: [], connectionsSamples: [],
  };
}

/** Fold one sample (from net/metrics.mjs or the agent) into a step. */
export function addSample(step, s) {
  switch (s.kind) {
    case 'tx':
      if (s.ok) step.tx.push(s.ms);
      // A version-check abort is the protocol working (a race lost cleanly),
      // not a server failure — tracked separately.
      else if (s.code === 'aborted') step.txAborted++;
      else { step.txFailed++; step.errorsByCode[s.code] = (step.errorsByCode[s.code] ?? 0) + 1; }
      break;
    case 'write':
      step.writes++;
      if (!s.ok) { step.writeFailed++; step.errorsByCode[s.code] = (step.errorsByCode[s.code] ?? 0) + 1; }
      break;
    case 'visible':
      step.visible.push(s.ms);
      break;
    default:
  }
}

/** Fold a finished game's compact summary into a step. */
export function addGame(step, g) {
  step.gamesFinished++;
  if (g.setupFailed) step.setupFailed++;
  for (const c of g.violationClasses ?? []) step.violations[c] = (step.violations[c] ?? 0) + 1;
  step.earlyCommitLost += g.earlyCommitLost ?? 0;
}

export function summarizeStep(step) {
  const ops = step.tx.length + step.txFailed + step.writes;
  const failed = step.txFailed + step.writeFailed;
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  return {
    index: step.index,
    targetGames: step.targetGames,
    activeGamesAvg: avg(step.activeGamesSamples),
    connectionsAvg: avg(step.connectionsSamples),
    durationS: step.endedAt ? Math.round((step.endedAt - step.startedAt) / 1000) : null,
    txCount: step.tx.length,
    txPerSec: step.endedAt ? +(step.tx.length / Math.max(1, (step.endedAt - step.startedAt) / 1000)).toFixed(2) : null,
    txP50: percentile(step.tx, 0.5), txP95: percentile(step.tx, 0.95), txP99: percentile(step.tx, 0.99),
    txAborted: step.txAborted,
    visibleP50: percentile(step.visible, 0.5), visibleP95: percentile(step.visible, 0.95),
    writes: step.writes,
    errorRate: ops ? +(failed / ops).toFixed(4) : 0,
    errorCount: failed,
    errorsByCode: step.errorsByCode,
    gamesStarted: step.gamesStarted, gamesFinished: step.gamesFinished,
    setupFailed: step.setupFailed,
    setupFailRate: step.gamesStarted ? +(step.setupFailed / step.gamesStarted).toFixed(3) : 0,
    violations: step.violations,
    earlyCommitLost: step.earlyCommitLost,
  };
}

/** Which SLOs does this step break? Empty array = healthy. */
export function sloBreaches(summary, slo = DEFAULT_SLO) {
  const out = [];
  if (summary.txP95 != null && summary.txP95 > slo.txP95Ms) out.push(`commit p95 ${summary.txP95}ms > ${slo.txP95Ms}ms`);
  if (summary.visibleP95 != null && summary.visibleP95 > slo.visibleP95Ms) out.push(`opponent-visible p95 ${summary.visibleP95}ms > ${slo.visibleP95Ms}ms`);
  // Need a few failures before a rate means anything in a small step.
  if (summary.errorRate > slo.errorRate && (summary.errorCount ?? Infinity) >= 3) out.push(`error rate ${(summary.errorRate * 100).toFixed(2)}% > ${(slo.errorRate * 100).toFixed(1)}%`);
  if (summary.gamesStarted >= 3 && summary.setupFailRate > slo.setupFailRate) out.push(`setup failures ${(summary.setupFailRate * 100).toFixed(0)}% of games`);
  const desyncs = Object.entries(summary.violations).filter(([k]) => /desync|stuck|invariant|move-|bonus-credited/.test(k));
  if (desyncs.length) out.push(`correctness: ${desyncs.map(([k, v]) => `${k}×${v}`).join(', ')}`);
  return out;
}

/** Ramp schedule: target concurrent games for a given elapsed time. */
export function targetAt(elapsedMs, { startGames, stepGames, stepMs, maxGames }) {
  const step = Math.floor(elapsedMs / stepMs);
  return { step, target: Math.min(maxGames, startGames + step * stepGames) };
}

/** Split `n` games across `w` workers as evenly as possible. */
export function splitTarget(n, w) {
  const base = Math.floor(n / w);
  return Array.from({ length: w }, (_, i) => base + (i < n % w ? 1 : 0));
}

/** Count lost-race commits that were sent comfortably before the deadline. */
export function countEarlyCommitLost(deadlineRecords = [], marginMs = 500) {
  return deadlineRecords.filter(d => d.actualOffset != null && d.actualOffset < -marginMs && d.outcome === 'sync-rejected').length;
}
