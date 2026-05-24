// Live-online timeout watchdog parity vs. legacy ensureOnlineTimeoutWatchdog().
//
// Legacy authority (HEAD:index.html:10330): the opponent runs a 350ms
// polling watchdog that calls shouldClaimExpiredOnlineTurn → if true, runs
// a `rooms/{code}/state` transaction patching with computeExpiredOnlineTurnState.
//
// Spine: createTimeoutWatchdog (src/game/online/timeoutWatchdog.js) does
// the same against the v2 room doc, translating helper field names to the
// room schema (turn → currentTurnSlot, stateSeq → version, etc.).
//
// What we assert (two-client simulation against a shared mock db):
//   • Only the opponent claims; the active player's watchdog refuses.
//   • Claim flips turn, advances deadline, increments _passCount /
//     missedTurns, bumps version.
//   • Race: when both clients' watchdogs fire simultaneously, only the
//     first transaction commits; the second sees the new state and no-ops.
//   • Watchdog respects: timelimit off, status != playing, no deadline,
//     still-within-grace.
//   • dispose() halts the watchdog (no future ticks claim).

const test = require('node:test');
const assert = require('node:assert/strict');

let modulesPromise;
function loadModules() {
  modulesPromise ??= Promise.all([
    import('../../src/game/online/mockFirebase.js'),
    import('../../src/game/online/timeoutWatchdog.js'),
    import('../../src/game/online/schema.js'),
  ]).then(([mock, watchdog, schema]) => ({ mock, watchdog, schema }));
  return modulesPromise;
}

const ROOM_ID = 'live-watchdog';
const LIMIT_MS = 30_000;
const GRACE_MS = 1_000;

function seedRoom(db, overrides = {}) {
  db._data.rooms = db._data.rooms ?? {};
  db._data.rooms[ROOM_ID] = {
    roomId: ROOM_ID,
    mode: 'random-live',
    status: 'playing',
    schemaVersion: 2,
    version: 1,
    players: {
      0: { uid: 'alice', displayName: 'Alice' },
      1: { uid: 'bob', displayName: 'Bob' },
    },
    settings: { timelimit: true, botTime: 30 },
    currentTurnSlot: 1, // Bob's turn
    turnNumber: 4,
    turnDeadlineMs: 10_000,
    scores: { 0: 0, 1: 0 },
    racks: { 0: [], 1: [] },
    bag: [],
    moveHistory: [],
    activeBoosts: [],
    _passCount: 2,
    missedTurns: { 0: 0, 1: 0 },
    ...overrides,
  };
  return db._data.rooms[ROOM_ID];
}

// ───────────────────────────────────────────────────────────────────────
// 1. Active player's watchdog must NOT claim (would self-pass).
test('parity: active player\'s watchdog does not claim on its own turn', async () => {
  const { mock, watchdog } = await loadModules();
  const db = mock.makeMockDb();
  seedRoom(db);

  // Bob is the active player (currentTurnSlot=1). Bob's watchdog runs with mySlot=1.
  const wd = watchdog.createTimeoutWatchdog({
    db, roomId: ROOM_ID, mySlot: 1, limitMs: LIMIT_MS,
    setIntervalFn: null, // disable auto-tick — drive manually
    now: () => 50_000, // long past the deadline
  });
  const result = await wd.tick();

  assert.equal(result.committed, false, 'transaction aborted because there is nothing to claim');
  // Room unchanged.
  assert.equal(db._data.rooms[ROOM_ID].currentTurnSlot, 1, 'active player did not flip turn on themselves');
  assert.equal(db._data.rooms[ROOM_ID].version, 1);
  assert.equal(db._data.rooms[ROOM_ID]._passCount, 2);
  wd.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 2. Opponent's watchdog claims the timeout once past deadline + grace.
test('parity: opponent\'s watchdog flips turn, bumps version, advances deadline, increments missedTurns', async () => {
  const { mock, watchdog } = await loadModules();
  const db = mock.makeMockDb();
  seedRoom(db);

  // Alice is the opponent (mySlot=0). Now=50_000, deadline=10_000, grace=1_000
  // ⇒ now > deadline + grace ⇒ claim.
  const now = 50_000;
  const wd = watchdog.createTimeoutWatchdog({
    db, roomId: ROOM_ID, mySlot: 0, limitMs: LIMIT_MS, graceMs: GRACE_MS,
    setIntervalFn: null,
    now: () => now,
  });
  const result = await wd.tick();

  assert.equal(result.committed, true);
  const room = db._data.rooms[ROOM_ID];
  assert.equal(room.currentTurnSlot, 0, 'turn flipped to opponent');
  assert.equal(room.turnNumber, 5, 'turnNumber bumped');
  assert.equal(room.turnDeadlineMs, now + LIMIT_MS, 'deadline advanced by limitMs');
  assert.equal(room.version, 2, 'version (stateSeq) incremented');
  assert.equal(room._passCount, 3, 'passCount incremented (legacy parity)');
  assert.deepEqual(room.missedTurns, { 0: 0, 1: 1 },
    'missedTurns[absent player] += 1; missedTurns[claimant] reset');
  assert.equal(room.updatedAt, now, 'updatedAt stamped at claim time');
  wd.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 3. Race: both clients' watchdogs fire at the "same" time. Only one
// observably changes the state; the other sees the post-claim room and
// refuses (its shouldClaimExpiredOnlineTurn now returns false because the
// turn has already flipped to itself).
test('parity: concurrent claims — only the first observably mutates the room', async () => {
  const { mock, watchdog } = await loadModules();
  const db = mock.makeMockDb();
  seedRoom(db);

  const now = 50_000;
  const aliceWd = watchdog.createTimeoutWatchdog({
    db, roomId: ROOM_ID, mySlot: 0, limitMs: LIMIT_MS,
    setIntervalFn: null, now: () => now,
  });
  // Bob also runs a watchdog (degenerate — he's the active player who would
  // self-pass). His tick should never claim regardless of ordering.
  const bobWd = watchdog.createTimeoutWatchdog({
    db, roomId: ROOM_ID, mySlot: 1, limitMs: LIMIT_MS,
    setIntervalFn: null, now: () => now,
  });

  // Fire concurrently. The mock transaction is synchronous-per-call, so
  // running both via Promise.all simulates the race.
  await Promise.all([aliceWd.tick(), bobWd.tick()]);

  const room = db._data.rooms[ROOM_ID];
  assert.equal(room.currentTurnSlot, 0, 'Alice claimed (one and only state change)');
  assert.equal(room.version, 2, 'version bumped exactly once');
  assert.equal(room._passCount, 3, 'passCount bumped exactly once');

  // A third tick from Alice now — turn is hers, so her watchdog must NOT
  // claim again (would self-pass).
  await aliceWd.tick();
  assert.equal(db._data.rooms[ROOM_ID].currentTurnSlot, 0, 'no further claim after Alice owns the turn');
  assert.equal(db._data.rooms[ROOM_ID].version, 2);

  aliceWd.dispose();
  bobWd.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 4. Watchdog respects timelimit:off / status:completed / no deadline / grace window.
test('parity: watchdog no-ops when settings disable timelimit', async () => {
  const { mock, watchdog } = await loadModules();
  const db = mock.makeMockDb();
  seedRoom(db, { settings: { timelimit: false, botTime: 30 } });

  const wd = watchdog.createTimeoutWatchdog({
    db, roomId: ROOM_ID, mySlot: 0, limitMs: LIMIT_MS,
    setIntervalFn: null, now: () => 100_000,
  });
  await wd.tick();
  assert.equal((await wd.tick()).committed, false);
  assert.equal(db._data.rooms[ROOM_ID].currentTurnSlot, 1, 'no claim — timer disabled');
  wd.dispose();
});

test('parity: watchdog no-ops when room status is not playing', async () => {
  const { mock, watchdog } = await loadModules();
  const db = mock.makeMockDb();
  seedRoom(db, { status: 'completed' });

  const wd = watchdog.createTimeoutWatchdog({
    db, roomId: ROOM_ID, mySlot: 0, limitMs: LIMIT_MS,
    setIntervalFn: null, now: () => 100_000,
  });
  await wd.tick();
  assert.equal((await wd.tick()).committed, false);
  assert.equal(db._data.rooms[ROOM_ID].currentTurnSlot, 1, 'no claim — game over');
  wd.dispose();
});

test('parity: watchdog no-ops when deadline has not yet elapsed including grace', async () => {
  const { mock, watchdog } = await loadModules();
  const db = mock.makeMockDb();
  seedRoom(db, { turnDeadlineMs: 100_000 });

  // now = 100_500, deadline = 100_000, grace = 1_000 ⇒ now < deadline + grace.
  const wd = watchdog.createTimeoutWatchdog({
    db, roomId: ROOM_ID, mySlot: 0, limitMs: LIMIT_MS, graceMs: GRACE_MS,
    setIntervalFn: null, now: () => 100_500,
  });
  await wd.tick();
  assert.equal((await wd.tick()).committed, false);
  assert.equal(db._data.rooms[ROOM_ID].currentTurnSlot, 1, 'no claim — still within grace');
  wd.dispose();
});

test('parity: watchdog no-ops when turnDeadlineMs is unset', async () => {
  const { mock, watchdog } = await loadModules();
  const db = mock.makeMockDb();
  seedRoom(db, { turnDeadlineMs: 0 });

  const wd = watchdog.createTimeoutWatchdog({
    db, roomId: ROOM_ID, mySlot: 0, limitMs: LIMIT_MS,
    setIntervalFn: null, now: () => 100_000,
  });
  await wd.tick();
  assert.equal((await wd.tick()).committed, false);
  assert.equal(db._data.rooms[ROOM_ID].currentTurnSlot, 1, 'no claim — no deadline set');
  wd.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 5. dispose() halts future ticks: a tick called after dispose must not claim.
test('parity: dispose() prevents future ticks from claiming', async () => {
  const { mock, watchdog } = await loadModules();
  const db = mock.makeMockDb();
  seedRoom(db);

  const wd = watchdog.createTimeoutWatchdog({
    db, roomId: ROOM_ID, mySlot: 0, limitMs: LIMIT_MS,
    setIntervalFn: null, now: () => 50_000,
  });
  wd.dispose();
  const result = await wd.tick();
  assert.equal(result.committed, false);
  assert.equal(result.reason, 'disposed');
  assert.equal(db._data.rooms[ROOM_ID].currentTurnSlot, 1, 'state untouched after dispose');
});

// ───────────────────────────────────────────────────────────────────────
// 6. Interval-driven tick: the watchdog actually polls when given a real
// setIntervalFn. Use a fake interval to count invocations without sleeping.
test('parity: watchdog ticks on the setInterval cadence', async () => {
  const { mock, watchdog } = await loadModules();
  const db = mock.makeMockDb();
  seedRoom(db);

  // Capture the interval callback; we'll fire it manually.
  let intervalCb = null;
  const setIntervalFn = (cb /*, ms */) => { intervalCb = cb; return 1; };
  let cleared = 0;
  const clearIntervalFn = () => { cleared++; };

  const wd = watchdog.createTimeoutWatchdog({
    db, roomId: ROOM_ID, mySlot: 0, limitMs: LIMIT_MS,
    setIntervalFn, clearIntervalFn,
    now: () => 50_000,
  });
  assert.ok(intervalCb, 'setInterval was registered');

  // Fire the interval — it kicks off a tick; wait for it.
  intervalCb();
  await wd._lastTick();
  assert.equal(db._data.rooms[ROOM_ID].currentTurnSlot, 0, 'interval-driven tick claimed the timeout');

  wd.dispose();
  assert.equal(cleared, 1, 'dispose cleared the interval');
});
