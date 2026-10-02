// Unit tests for the staging load test's pure aggregation (loadStats.mjs).
const test = require('node:test');
const assert = require('node:assert/strict');

let m;
async function load() { m ??= await import('../../scripts/simulator/soak/loadStats.mjs'); return m; }

test('percentile: nearest-rank on unsorted input, null when empty', async () => {
  const { percentile } = await load();
  assert.equal(percentile([], 0.5), null);
  const v = [50, 10, 40, 20, 30, 100, 90, 80, 70, 60];
  assert.equal(percentile(v, 0.5), 50);
  assert.equal(percentile(v, 0.95), 100);
  assert.equal(percentile([7], 0.99), 7);
});

test('step aggregation: aborts are not errors; failures by code; games and lost commits', async () => {
  const { createStep, addSample, addGame, summarizeStep } = await load();
  const s = createStep(2, 20, 0);
  for (const ms of [100, 200, 300]) addSample(s, { kind: 'tx', ms, ok: true });
  addSample(s, { kind: 'tx', ms: 50, ok: false, code: 'aborted' });
  addSample(s, { kind: 'tx', ms: 900, ok: false, code: 'permission_denied' });
  addSample(s, { kind: 'write', ms: 20, ok: true });
  addSample(s, { kind: 'write', ms: 20, ok: false, code: 'disconnect' });
  addSample(s, { kind: 'visible', ms: 400 });
  s.gamesStarted = 4;
  addGame(s, { violationClasses: ['desync-hostScore'], earlyCommitLost: 1 });
  addGame(s, { setupFailed: true, violationClasses: ['game-setup-or-runtime-error'] });
  s.endedAt = 10_000;
  const sum = summarizeStep(s);
  assert.equal(sum.txCount, 3);
  assert.equal(sum.txAborted, 1);
  assert.equal(sum.errorRate, +(2 / 6).toFixed(4));
  assert.deepEqual(sum.errorsByCode, { permission_denied: 1, disconnect: 1 });
  assert.equal(sum.visibleP50, 400);
  assert.equal(sum.setupFailed, 1);
  assert.equal(sum.setupFailRate, 0.25);
  assert.equal(sum.earlyCommitLost, 1);
  assert.equal(sum.txPerSec, 0.3);
});

test('SLO breaches: latency, errors, setup failures, correctness', async () => {
  const { sloBreaches, DEFAULT_SLO } = await load();
  const ok = { txP95: 300, visibleP95: 900, errorRate: 0, gamesStarted: 5, setupFailRate: 0, violations: {} };
  assert.deepEqual(sloBreaches(ok), []);
  assert.equal(sloBreaches({ ...ok, txP95: DEFAULT_SLO.txP95Ms + 1 }).length, 1);
  assert.equal(sloBreaches({ ...ok, errorRate: 0.02 }).length, 1);
  assert.equal(sloBreaches({ ...ok, setupFailRate: 0.5 }).length, 1);
  assert.equal(sloBreaches({ ...ok, violations: { 'desync-boardHash': 1 } }).length, 1);
  assert.equal(sloBreaches({ ...ok, violations: { 'end-desync-lockedCells': 1 } }).length, 1, 'end-desync counts as correctness');
  assert.deepEqual(sloBreaches({ ...ok, gamesStarted: 2, setupFailRate: 1 }), [], 'too few games to judge setup');
});

test('ramp schedule and worker split', async () => {
  const { targetAt, splitTarget } = await load();
  const cfg = { startGames: 4, stepGames: 6, stepMs: 60_000, maxGames: 20 };
  assert.deepEqual(targetAt(0, cfg), { step: 0, target: 4 });
  assert.deepEqual(targetAt(125_000, cfg), { step: 2, target: 16 });
  assert.deepEqual(targetAt(10 * 60_000, cfg), { step: 10, target: 20 });
  assert.deepEqual(splitTarget(10, 3), [4, 3, 3]);
  assert.deepEqual(splitTarget(0, 2), [0, 0]);
});

test('countEarlyCommitLost: only sync-rejected commits sent well before the deadline', async () => {
  const { countEarlyCommitLost } = await load();
  assert.equal(countEarlyCommitLost([
    { actualOffset: -2000, outcome: 'sync-rejected' },
    { actualOffset: -100, outcome: 'sync-rejected' },
    { actualOffset: -3000, outcome: 'turn-changed:move' },
    { actualOffset: null, outcome: 'sync-rejected' },
  ]), 1);
});

test('SLO: an error rate needs at least 3 failures before it counts', async () => {
  const { sloBreaches } = await load();
  const base = { txP95: 100, visibleP95: 100, gamesStarted: 5, setupFailRate: 0, violations: {} };
  assert.deepEqual(sloBreaches({ ...base, errorRate: 0.02, errorCount: 2 }), []);
  assert.equal(sloBreaches({ ...base, errorRate: 0.02, errorCount: 3 }).length, 1);
});
