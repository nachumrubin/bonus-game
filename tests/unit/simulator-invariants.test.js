// Unit tests for the simulator's per-tick invariant checks.
// CJS + dynamic import to match the existing tests/unit/* convention.

const test = require('node:test');
const assert = require('node:assert/strict');

let modulesPromise;
function loadModules() {
  modulesPromise ??= Promise.all([
    import('../../scripts/simulator/invariants.mjs'),
    import('../../src/game/core/letterDistribution.js'),
  ]).then(([inv, ld]) => ({ checkInvariants: inv.checkInvariants, HD: ld.HD }));
  return modulesPromise;
}

function totalTiles(HD) {
  return Object.values(HD).reduce((s, n) => s + n, 0);
}

function emptyBoard() { return new Array(100).fill(null); }

function baseRoom({ HD }, overrides = {}) {
  const total = totalTiles(HD);
  // Build a clean room: all tiles in the bag, both racks empty, board empty.
  const bag = new Array(total).fill('א');
  return {
    schemaVersion: 2,
    version: 1,
    status: 'playing',
    currentTurnSlot: 0,
    bag,
    racks: { 0: [], 1: [] },
    board: emptyBoard(),
    missedTurns: { 0: 0, 1: 0 },
    _passCount: 0,
    scores: { 0: 0, 1: 0 },
    liveBonus: null,
    ...overrides,
  };
}

test('checkInvariants: passes on a clean room', async () => {
  const { checkInvariants, HD } = await loadModules();
  const violations = checkInvariants(null, baseRoom({ HD }));
  assert.deepEqual(violations, []);
});

test('checkInvariants: schema-version-wrong fires when schemaVersion != 2', async () => {
  const { checkInvariants, HD } = await loadModules();
  const violations = checkInvariants(null, baseRoom({ HD }, { schemaVersion: 1 }));
  assert.ok(violations.some(v => v.class === 'schema-version-wrong'),
    `expected schema-version-wrong, got ${JSON.stringify(violations)}`);
});

test('checkInvariants: version-non-monotonic fires when version goes backward', async () => {
  const { checkInvariants, HD } = await loadModules();
  const prev = baseRoom({ HD }, { version: 5 });
  const next = baseRoom({ HD }, { version: 4 });
  const violations = checkInvariants(prev, next);
  assert.ok(violations.some(v => v.class === 'version-non-monotonic'));
});

test('checkInvariants: bag-parity fires when tile count diverges', async () => {
  const { checkInvariants, HD } = await loadModules();
  const room = baseRoom({ HD });
  room.bag.pop(); // remove one tile from the bag; doesn't appear anywhere else
  const violations = checkInvariants(null, room);
  assert.ok(violations.some(v => v.class === 'bag-parity'),
    `expected bag-parity, got ${JSON.stringify(violations)}`);
});

test('checkInvariants: turn-slot-out-of-range fires for invalid slot while playing', async () => {
  const { checkInvariants, HD } = await loadModules();
  const violations = checkInvariants(null, baseRoom({ HD }, { currentTurnSlot: 5 }));
  assert.ok(violations.some(v => v.class === 'turn-slot-out-of-range'));
});

test('checkInvariants: turn-slot-out-of-range does NOT fire when status is terminal', async () => {
  const { checkInvariants, HD } = await loadModules();
  const violations = checkInvariants(null, baseRoom({ HD }, { currentTurnSlot: 5, status: 'completed' }));
  assert.ok(!violations.some(v => v.class === 'turn-slot-out-of-range'));
});

test('checkInvariants: live-bonus-gate-violation fires when turn flips during active liveBonus', async () => {
  const { checkInvariants, HD } = await loadModules();
  const prev = baseRoom({ HD }, { currentTurnSlot: 0, liveBonus: { active: true } });
  const next = baseRoom({ HD }, { currentTurnSlot: 1, liveBonus: { active: true }, version: 2 });
  const violations = checkInvariants(prev, next);
  assert.ok(violations.some(v => v.class === 'live-bonus-gate-violation'));
});

test('checkInvariants: live-bonus-gate-violation does NOT fire when bonus cleared', async () => {
  const { checkInvariants, HD } = await loadModules();
  const prev = baseRoom({ HD }, { currentTurnSlot: 0, liveBonus: { active: true } });
  const next = baseRoom({ HD }, { currentTurnSlot: 1, liveBonus: null, version: 2 });
  const violations = checkInvariants(prev, next);
  assert.ok(!violations.some(v => v.class === 'live-bonus-gate-violation'));
});

test('checkInvariants: missed-turns-exceeded fires past forfeit threshold', async () => {
  const { checkInvariants, HD } = await loadModules();
  const violations = checkInvariants(null, baseRoom({ HD }, { missedTurns: { 0: 3, 1: 0 } }));
  assert.ok(violations.some(v => v.class === 'missed-turns-exceeded'));
});

test('checkInvariants: pass-count-exceeded fires well past threshold', async () => {
  const { checkInvariants, HD } = await loadModules();
  // threshold is 4; we allow +1 tolerance, so 6 should fire.
  const violations = checkInvariants(null, baseRoom({ HD }, { _passCount: 6 }));
  assert.ok(violations.some(v => v.class === 'pass-count-exceeded'));
});

test('checkInvariants: terminal-scores-missing fires when scores absent on completed', async () => {
  const { checkInvariants, HD } = await loadModules();
  const violations = checkInvariants(null, baseRoom({ HD }, {
    status: 'completed',
    scores: { 0: null, 1: null },
  }));
  assert.ok(violations.some(v => v.class === 'terminal-scores-missing'));
});
