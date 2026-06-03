import test from 'node:test';
import assert from 'node:assert/strict';

import { withTestEnv, makeUserApp, seedWithoutRules, assertSucceeds } from './setup.mjs';
import { createInitialState } from '../../src/game/core/gameEngine.js';
import { createRoom, markReadyAndMaybeStart } from '../../src/game/online/roomService.js';
import { createTimeoutWatchdog } from '../../src/game/online/timeoutWatchdog.js';

const HOST_UID = 'timer-host';
const GUEST_UID = 'timer-guest';

const PLAYERS = {
  0: { uid: HOST_UID, displayName: 'Host', avatar: null, joinedAt: 1_000 },
  1: { uid: GUEST_UID, displayName: 'Guest', avatar: null, joinedAt: 1_000 },
};

function engineState({ mode = 'friend-live', settings = { timelimit: true, botTime: 20 } } = {}) {
  return createInitialState({
    mode,
    tileBagSeed: 'timer-room',
    players: PLAYERS,
    startingSlot: 0,
    settings,
  });
}

function roomDoc(overrides = {}) {
  return {
    roomId: 'timer-room',
    schemaVersion: 2,
    mode: 'friend-live',
    status: 'playing',
    version: 1,
    currentTurnSlot: 1,
    turnNumber: 3,
    moveHistory: [],
    scores: { 0: 0, 1: 0 },
    racks: { 0: [], 1: [] },
    bag: [],
    board: {},
    activeBoosts: [],
    lockedCells: [],
    lockInventory: { 0: [], 1: [] },
    settings: { timelimit: true, botTime: 20 },
    turnDeadlineMs: Date.now() - 10_000,
    missedTurns: { 0: 0, 1: 0 },
    players: PLAYERS,
    livePreview: null,
    createdAt: 1_000,
    ...overrides,
  };
}

async function readAs(app, path) {
  const snap = await app.ref(path).get();
  return snap?.val ? snap.val() : null;
}

function missedArray(value) {
  return [Number(value?.[0] ?? 0), Number(value?.[1] ?? 0)];
}

test('timer: live timed room creation waits for ready handshake before first deadline', async () => {
  await withTestEnv(async (env) => {
    const host = makeUserApp(env, HOST_UID);
    const serverTimestamp = Date.now();
    await assertSucceeds(createRoom(host.db, {
      roomId: 'timer-live',
      mode: 'friend-live',
      players: PLAYERS,
      settings: { timelimit: true, botTime: 20 },
      engineState: engineState(),
      serverTimestamp,
    }));

    const room = await readAs(host, 'rooms/timer-live');
    assert.equal(room.status, 'waiting');
    assert.equal(room.turnDeadlineMs ?? null, null);
    assert.deepEqual(missedArray(room.missedTurns), [0, 0]);

    await assertSucceeds(markReadyAndMaybeStart(host.db, 'timer-live', 0, serverTimestamp + 1_000));
    let afterReady = await readAs(host, 'rooms/timer-live');
    assert.equal(afterReady.status, 'waiting');
    assert.equal(afterReady.turnDeadlineMs ?? null, null);

    const guest = makeUserApp(env, GUEST_UID);
    await assertSucceeds(markReadyAndMaybeStart(guest.db, 'timer-live', 1, serverTimestamp + 2_000));
    afterReady = await readAs(host, 'rooms/timer-live');
    assert.equal(afterReady.status, 'playing');
    assert.equal(afterReady.turnDeadlineMs, serverTimestamp + 22_000);
  });
});

test('timer: live room without timelimit leaves the shared deadline unset', async () => {
  await withTestEnv(async (env) => {
    const host = makeUserApp(env, HOST_UID);
    const settings = { timelimit: false, botTime: 20 };
    await assertSucceeds(createRoom(host.db, {
      roomId: 'timer-off',
      mode: 'friend-live',
      players: PLAYERS,
      settings,
      engineState: engineState({ settings }),
      serverTimestamp: 10_000,
    }));

    const room = await readAs(host, 'rooms/timer-off');
    assert.equal(room.turnDeadlineMs ?? null, null);
    assert.deepEqual(missedArray(room.missedTurns), [0, 0]);
  });
});

test('timer: async room does not start a live shared deadline', async () => {
  await withTestEnv(async (env) => {
    const host = makeUserApp(env, HOST_UID);
    const settings = { timelimit: true, botTime: 20 };
    await assertSucceeds(createRoom(host.db, {
      roomId: 'timer-async',
      mode: 'friend-async',
      players: PLAYERS,
      settings,
      engineState: engineState({ mode: 'friend-async', settings }),
      serverTimestamp: 10_000,
    }));

    const room = await readAs(host, 'rooms/timer-async');
    assert.equal(room.turnDeadlineMs ?? null, null);
    assert.deepEqual(missedArray(room.missedTurns), [0, 0]);
  });
});

test('timer: opponent watchdog can claim an expired turn under production rules', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/timer-room').set(roomDoc());
    });
    const host = makeUserApp(env, HOST_UID);
    const now = Date.now();
    const watchdog = createTimeoutWatchdog({
      db: host.db,
      roomId: 'timer-room',
      mySlot: 0,
      limitMs: 20_000,
      graceMs: 0,
      setIntervalFn: null,
      now: () => now,
    });

    const result = await assertSucceeds(watchdog.tick());
    assert.equal(result.committed, true);
    const room = await readAs(host, 'rooms/timer-room');
    assert.equal(room.currentTurnSlot, 0);
    assert.equal(room.version, 2);
    assert.equal(room.turnDeadlineMs, now + 20_000);
    assert.deepEqual(missedArray(room.missedTurns), [0, 1]);
    watchdog.dispose();
  });
});

test('timer: active player watchdog does not self-claim an expired own turn', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/timer-room').set(roomDoc());
    });
    const guest = makeUserApp(env, GUEST_UID);
    const watchdog = createTimeoutWatchdog({
      db: guest.db,
      roomId: 'timer-room',
      mySlot: 1,
      limitMs: 20_000,
      graceMs: 0,
      setIntervalFn: null,
      now: () => Date.now(),
    });

    const result = await assertSucceeds(watchdog.tick());
    assert.equal(result.committed, false);
    const room = await readAs(guest, 'rooms/timer-room');
    assert.equal(room.currentTurnSlot, 1);
    assert.equal(room.version, 1);
    assert.deepEqual(missedArray(room.missedTurns), [0, 0]);
    watchdog.dispose();
  });
});

test('timer: simultaneous active/opponent watchdog ticks produce exactly one timeout claim', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/timer-room').set(roomDoc());
    });
    const host = makeUserApp(env, HOST_UID);
    const guest = makeUserApp(env, GUEST_UID);
    const now = Date.now();
    const opponentWatchdog = createTimeoutWatchdog({
      db: host.db,
      roomId: 'timer-room',
      mySlot: 0,
      limitMs: 20_000,
      graceMs: 0,
      setIntervalFn: null,
      now: () => now,
    });
    const activeWatchdog = createTimeoutWatchdog({
      db: guest.db,
      roomId: 'timer-room',
      mySlot: 1,
      limitMs: 20_000,
      graceMs: 0,
      setIntervalFn: null,
      now: () => now,
    });

    const results = await Promise.all([
      assertSucceeds(opponentWatchdog.tick()),
      assertSucceeds(activeWatchdog.tick()),
    ]);

    assert.equal(results.filter(r => r.committed).length, 1);
    const room = await readAs(host, 'rooms/timer-room');
    assert.equal(room.currentTurnSlot, 0);
    assert.equal(room.version, 2);
    assert.equal(room.turnDeadlineMs, now + 20_000);
    assert.deepEqual(missedArray(room.missedTurns), [0, 1]);
    opponentWatchdog.dispose();
    activeWatchdog.dispose();
  });
});

test('timer: opponent watchdog cannot claim before the deadline expires', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/timer-room').set(roomDoc({
        turnDeadlineMs: Date.now() + 60_000,
      }));
    });
    const host = makeUserApp(env, HOST_UID);
    const watchdog = createTimeoutWatchdog({
      db: host.db,
      roomId: 'timer-room',
      mySlot: 0,
      limitMs: 20_000,
      graceMs: 0,
      setIntervalFn: null,
      now: () => Date.now(),
    });

    const result = await assertSucceeds(watchdog.tick());
    assert.equal(result.committed, false);
    const room = await readAs(host, 'rooms/timer-room');
    assert.equal(room.currentTurnSlot, 1);
    assert.equal(room.version, 1);
    watchdog.dispose();
  });
});

test('timer: current-turn player commit can rotate deadline and reset their missed count', async () => {
  await withTestEnv(async (env) => {
    const previousDeadline = Date.now() + 1_000;
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/timer-room').set(roomDoc({
        currentTurnSlot: 0,
        version: 1,
        turnDeadlineMs: previousDeadline,
        missedTurns: { 0: 2, 1: 0 },
      }));
    });
    const host = makeUserApp(env, HOST_UID);
    const current = await readAs(host, 'rooms/timer-room');
    const nextDeadline = Date.now() + 20_000;
    const next = {
      ...current,
      version: 2,
      currentTurnSlot: 1,
      turnNumber: current.turnNumber + 1,
      turnDeadlineMs: nextDeadline,
      missedTurns: { 0: 0, 1: 0 },
      lastMove: { slot: 0, type: 'pass', turnNumber: current.turnNumber, ts: Date.now() },
    };

    await assertSucceeds(host.ref('rooms/timer-room').set(next));
    const room = await readAs(host, 'rooms/timer-room');
    assert.equal(room.currentTurnSlot, 1);
    assert.equal(room.turnDeadlineMs, nextDeadline);
    assert.deepEqual(missedArray(room.missedTurns), [0, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Forfeit via watchdog: second consecutive missed turn must be allowed to
// transition the room to status='abandoned' even though the patch sets
// turnDeadlineMs=0 (the watchdog branch of the rule was previously
// requiring newData.turnDeadlineMs > now, which silently blocked the
// forfeit write in production — surfaced by the simulator's watchdog
// scenario).
// ─────────────────────────────────────────────────────────────────────────

test('timer: opponent watchdog CAN forfeit (deadline=0 + status=abandoned) under rules', async () => {
  await withTestEnv(async (env) => {
    // Seed: bob (slot 1) is currentTurn, missedTurns[1]=1 already from a
    // prior claim, deadline expired. Host (slot 0) ticks — second miss for
    // bob → forfeit.
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/timer-room').set(roomDoc({
        missedTurns: { 0: 0, 1: 1 },
      }));
    });
    const host = makeUserApp(env, HOST_UID);
    const now = Date.now();
    const watchdog = createTimeoutWatchdog({
      db: host.db,
      roomId: 'timer-room',
      mySlot: 0,
      limitMs: 20_000,
      graceMs: 0,
      setIntervalFn: null,
      now: () => now,
    });
    const result = await assertSucceeds(watchdog.tick());
    assert.equal(result.committed, true, 'forfeit transaction must commit (rule was rejecting it)');
    const room = await readAs(host, 'rooms/timer-room');
    assert.equal(room.status, 'abandoned', 'room must transition to abandoned');
    assert.equal(room.abandonedBy, 1, 'abandonedBy must be the slot that timed out twice');
    assert.equal(room.turnDeadlineMs, 0, 'deadline must be cleared on forfeit');
    assert.deepEqual(missedArray(room.missedTurns), [0, 2], 'missedTurns must reflect the second miss');
    assert.equal(room.version, 2, 'version bumped exactly once');
    watchdog.dispose();
  });
});

test('timer: opponent CANNOT write turnDeadlineMs=0 without flipping status to abandoned', async () => {
  // Defensive: the relaxed rule must ONLY allow deadline=0 in tandem with
  // status='abandoned'. An opponent who tries to zero out the deadline
  // mid-game (so the active player can never time out again) must still
  // be rejected.
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/timer-room').set(roomDoc());
    });
    const host = makeUserApp(env, HOST_UID);
    // Host is the OPPONENT (data.currentTurnSlot=1). Try the watchdog
    // branch but set deadline=0 while keeping status='playing'.
    const malicious = {
      ...roomDoc(),
      version: 2,
      currentTurnSlot: 0,
      turnDeadlineMs: 0,            // would bypass watchdog forever
      // status stays 'playing'
    };
    // Use assertFails for the negative case — `.set` returns the rejection.
    let rejected = false;
    try {
      await host.ref('rooms/timer-room').set(malicious);
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true,
      'rule must reject deadline=0 when status is still playing');
  });
});
