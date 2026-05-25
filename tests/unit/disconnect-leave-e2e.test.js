// End-to-end tests for Phase 1A: mid-game disconnect / leave flows.
//
// These tests exercise the full chain across:
//   gameFlowController → onlineGameSession → roomService → mockFirebase
//   disconnectController → presenceService → disconnectScreen constants
//
// Each test starts by calling bus._reset() to avoid cross-test subscription
// leaks (the bus module is a global singleton).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../src/events/bus.js';
import { CMD } from '../../src/events/commands.js';
import { EV } from '../../src/events/eventTypes.js';
import { BACK_INTENT } from '../../src/ui/screens/backConfirmScreen.js';
import { PAUSE_INTENT } from '../../src/ui/screens/pauseScreen.js';
import { DISCONNECT_INTENT, DISCONNECT_OPEN, DISCONNECT_CLOSE } from '../../src/ui/screens/disconnectScreen.js';
import { createGameFlowController } from '../../src/ui/controllers/gameFlowController.js';
import { createDisconnectController } from '../../src/ui/controllers/disconnectController.js';
import { PRESENCE_GRACE_MS } from '../../src/game/online/presenceService.js';
import { makeMockDb } from '../../src/game/online/mockFirebase.js';
import {
  createRoom, readRoom as rsReadRoom, setStatus,
} from '../../src/game/online/roomService.js';
import { createInitialState } from '../../src/game/core/gameEngine.js';
import { createOnlineGameSession } from '../../src/game/sessions/onlineGameSession.js';

// Suppress engine info logs that clutter test output.
const _origInfo = console.info;
console.info = () => {};

// ─── shared fixtures ─────────────────────────────────────────────────────────

const PLAYERS = {
  0: { uid: 'alice', displayName: 'Alice', avatar: null, joinedAt: 1 },
  1: { uid: 'bob', displayName: 'Bob', avatar: null, joinedAt: 2 },
};

// Minimal DOM stub: gameFlowController wires buttons via querySelector but we
// don't care about that in these tests — pass null for every element.
const NULL_ROOT = {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => ({ classList: { add() {}, remove() {} } }),
};

async function setupPlayingRoom(db, mode = 'friend-live', settings = {}) {
  const engineState = createInitialState({
    mode,
    tileBagSeed: 'disconnect-e2e',
    players: PLAYERS,
    settings,
  });
  // Deterministic racks so engineStateFromRoom produces the same board on
  // both client reconstructions.
  engineState.racks = {
    0: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'],
    1: ['ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע'],
  };
  await createRoom(db, {
    roomId: 'room',
    mode,
    players: PLAYERS,
    settings,
    engineState,
    serverTimestamp: 1000,
  });
  // Skip the ready-handshake and flip the room directly to 'playing'.
  await db.ref('rooms/room').update({ status: 'playing' });
  return rsReadRoom(db, 'room');
}

async function readRoom(db) {
  return rsReadRoom(db, 'room');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PRESENCE_GRACE_MS constant (phase-1A bug-3: was 35 000, now 30 000)
// ─────────────────────────────────────────────────────────────────────────────

test('PRESENCE_GRACE_MS is 30 000 ms after phase-1A bug-3 fix', () => {
  assert.equal(PRESENCE_GRACE_MS, 30_000,
    'grace period must be 30 s, not 35 s');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. BACK_INTENT.LEAVE — live online game
// ─────────────────────────────────────────────────────────────────────────────

test('BACK_INTENT.LEAVE for live online dispatches RESIGN_GAME for the leaving slot', () => {
  bus._reset();

  const dispatched = [];
  const ag = {
    online: true,
    isAsync: false,
    session: {
      mySlot: 0,
      state: {
        mode: 'friend-live',
        currentTurnSlot: 0,
        players: PLAYERS,
        scores: { 0: 0, 1: 0 },
        settings: {},
      },
      dispatch(cmd) { dispatched.push(cmd); },
    },
    end() {},
  };

  createGameFlowController({ bus, root: NULL_ROOT, activeGameRef: () => ag });
  bus.emit(BACK_INTENT.LEAVE, {});

  assert.equal(dispatched.length, 1, 'exactly one command must be dispatched');
  assert.equal(dispatched[0].type, CMD.RESIGN_GAME, 'command must be RESIGN_GAME');
  assert.equal(dispatched[0].payload?.slot, 0, 'slot must be the leaving player (0)');
});

test('BACK_INTENT.LEAVE for live online does NOT call endActiveGame before resign completes', () => {
  // The session must stay alive long enough to write the abandoned status to
  // Firebase.  endActiveGame() must only be triggered later (via END_INTENT.GO_HOME).
  bus._reset();

  let endedCount = 0;
  const ag = {
    online: true,
    isAsync: false,
    session: {
      mySlot: 0,
      state: {
        mode: 'friend-live', currentTurnSlot: 0, players: PLAYERS,
        scores: { 0: 0, 1: 0 }, settings: {},
      },
      dispatch() {},
    },
    end() { endedCount++; },
  };

  createGameFlowController({ bus, root: NULL_ROOT, activeGameRef: () => ag });
  bus.emit(BACK_INTENT.LEAVE, {});

  assert.equal(endedCount, 0,
    'endActiveGame must NOT be called immediately on leave — session still needed for Firebase write');
});

test('BACK_INTENT.LEAVE for live online writes abandoned status to Firebase', async () => {
  bus._reset();

  const db = makeMockDb();
  const room = await setupPlayingRoom(db, 'friend-live');
  const sess = await createOnlineGameSession({ bus, db, room, mySlot: 0 });

  const ag = {
    online: true, isAsync: false, session: sess,
    end() { sess.dispose(); },
  };
  createGameFlowController({ bus, root: NULL_ROOT, activeGameRef: () => ag });

  bus.emit(BACK_INTENT.LEAVE, {});
  // Allow the async EV.GAME_COMPLETED → setStatus write to resolve.
  await new Promise(r => setTimeout(r, 20));

  const roomNow = await readRoom(db);
  assert.equal(roomNow.status, 'abandoned',
    'Firebase room status must be "abandoned" after live-online leave');
  assert.equal(roomNow.abandonedBy, 0,
    'abandonedBy must identify the leaving player (slot 0)');

  await sess.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. BACK_INTENT.LEAVE — async / offline games must NOT resign
// ─────────────────────────────────────────────────────────────────────────────

test('BACK_INTENT.LEAVE for async online does NOT dispatch RESIGN_GAME', () => {
  bus._reset();

  const dispatched = [];
  let endedCount = 0;
  const screens = [];
  const ag = {
    online: true,
    isAsync: true,
    session: {
      mySlot: 0,
      state: {
        mode: 'friend-async', currentTurnSlot: 0, players: PLAYERS,
        scores: { 0: 0, 1: 0 }, settings: {},
      },
      dispatch(cmd) { dispatched.push(cmd); },
    },
    end() { endedCount++; },
  };

  createGameFlowController({
    bus, root: NULL_ROOT,
    activeGameRef: () => ag,
    showScreen: id => screens.push(id),
  });
  bus.emit(BACK_INTENT.LEAVE, {});

  assert.equal(
    dispatched.filter(c => c.type === CMD.RESIGN_GAME).length, 0,
    'async leave must NOT dispatch RESIGN_GAME',
  );
  assert.equal(endedCount, 1, 'async leave must call endActiveGame');
  assert.deepEqual(screens, ['sh'], 'async leave must navigate to home screen');
});

test('BACK_INTENT.LEAVE for offline game does NOT dispatch RESIGN_GAME', () => {
  bus._reset();

  const dispatched = [];
  let endedCount = 0;
  const screens = [];
  const ag = {
    online: false,
    isAsync: false,
    session: {
      mySlot: 0,
      state: {
        mode: 'offline-2p', currentTurnSlot: 0, players: PLAYERS,
        scores: { 0: 0, 1: 0 }, settings: {},
      },
      dispatch(cmd) { dispatched.push(cmd); },
    },
    end() { endedCount++; },
  };

  createGameFlowController({
    bus, root: NULL_ROOT,
    activeGameRef: () => ag,
    showScreen: id => screens.push(id),
  });
  bus.emit(BACK_INTENT.LEAVE, {});

  assert.equal(dispatched.filter(c => c.type === CMD.RESIGN_GAME).length, 0);
  assert.equal(endedCount, 1);
  assert.deepEqual(screens, ['sh']);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. PAUSE_INTENT.SAVE_AND_EXIT — live online game
// ─────────────────────────────────────────────────────────────────────────────

test('PAUSE_INTENT.SAVE_AND_EXIT for live online dispatches RESIGN_GAME', () => {
  bus._reset();

  const dispatched = [];
  const ag = {
    online: true,
    isAsync: false,
    session: {
      mySlot: 1,
      state: {
        mode: 'random-live', currentTurnSlot: 1, players: PLAYERS,
        scores: { 0: 0, 1: 0 }, settings: {},
      },
      dispatch(cmd) { dispatched.push(cmd); },
    },
    end() {},
  };

  createGameFlowController({ bus, root: NULL_ROOT, activeGameRef: () => ag });
  bus.emit(PAUSE_INTENT.SAVE_AND_EXIT, {});

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, CMD.RESIGN_GAME);
  assert.equal(dispatched[0].payload?.slot, 1,
    'slot must be mySlot (1), the player who chose save-and-exit');
});

test('PAUSE_INTENT.SAVE_AND_EXIT for live online writes abandoned status to Firebase', async () => {
  bus._reset();

  const db = makeMockDb();
  const room = await setupPlayingRoom(db, 'friend-live');
  const sess = await createOnlineGameSession({ bus, db, room, mySlot: 1 });

  const ag = {
    online: true, isAsync: false, session: sess,
    end() { sess.dispose(); },
  };
  createGameFlowController({ bus, root: NULL_ROOT, activeGameRef: () => ag });

  bus.emit(PAUSE_INTENT.SAVE_AND_EXIT, {});
  await new Promise(r => setTimeout(r, 20));

  const roomNow = await readRoom(db);
  assert.equal(roomNow.status, 'abandoned');
  assert.equal(roomNow.abandonedBy, 1,
    'slot 1 chose save-and-exit so abandonedBy must be 1');

  await sess.dispose();
});

test('PAUSE_INTENT.SAVE_AND_EXIT for async online calls endActiveGame without resign', () => {
  bus._reset();

  const dispatched = [];
  let endedCount = 0;
  const screens = [];
  const ag = {
    online: true,
    isAsync: true,
    session: {
      mySlot: 0,
      state: {
        mode: 'friend-async', currentTurnSlot: 0, players: PLAYERS,
        scores: { 0: 0, 1: 0 }, settings: {},
      },
      dispatch(cmd) { dispatched.push(cmd); },
    },
    end() { endedCount++; },
  };

  createGameFlowController({
    bus, root: NULL_ROOT,
    activeGameRef: () => ag,
    showScreen: id => screens.push(id),
  });
  bus.emit(PAUSE_INTENT.SAVE_AND_EXIT, {});

  assert.equal(dispatched.filter(c => c.type === CMD.RESIGN_GAME).length, 0,
    'async save-and-exit must NOT dispatch RESIGN_GAME');
  assert.equal(endedCount, 1, 'must call endActiveGame');
  assert.deepEqual(screens, ['sh'], 'must navigate home');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Opponent observes GAME_COMPLETED when the other player resigns
// ─────────────────────────────────────────────────────────────────────────────

test('opponent session receives GAME_COMPLETED after local resign (BACK_INTENT.LEAVE flow)', async () => {
  bus._reset();

  const db = makeMockDb();
  const room = await setupPlayingRoom(db, 'friend-live');

  // Two sessions on the same mock db (same bus simulates in-process comms).
  const sessA = await createOnlineGameSession({ bus, db, room, mySlot: 0 });
  const sessB = await createOnlineGameSession({ bus, db, room, mySlot: 1 });

  const completed = [];
  bus.on(EV.GAME_COMPLETED, p => completed.push(p));

  // Player A leaves — dispatches resign exactly as BACK_INTENT.LEAVE handler does.
  sessA.dispatch({ type: CMD.RESIGN_GAME, payload: { slot: 0 } });
  await new Promise(r => setTimeout(r, 20));

  assert.ok(completed.length >= 1, 'GAME_COMPLETED must fire');
  const ev = completed[0];
  assert.equal(ev.status, 'abandoned');
  assert.equal(ev.abandonedBy, 0, 'player 0 (A) abandoned');

  const roomNow = await readRoom(db);
  assert.equal(roomNow.status, 'abandoned');
  assert.equal(roomNow.abandonedBy, 0);

  await sessA.dispose();
  await sessB.dispose();
});

test('remote room status "abandoned" triggers GAME_COMPLETED on observer session', async () => {
  // Simulates the opponent writing the abandon (their session does setStatus).
  // The local session learns about it purely via watchRoom.
  bus._reset();

  const db = makeMockDb();
  const room = await setupPlayingRoom(db, 'random-live');
  const sessB = await createOnlineGameSession({ bus, db, room, mySlot: 1 });

  const completed = [];
  bus.on(EV.GAME_COMPLETED, p => completed.push(p));

  // Simulate player A's session writing the terminal status (no version bump).
  await db.ref('rooms/room').update({ status: 'abandoned', abandonedBy: 0 });
  await new Promise(r => setTimeout(r, 5));

  assert.equal(completed.length, 1,
    'GAME_COMPLETED must fire exactly once on the observer');
  assert.equal(completed[0].abandonedBy, 0);

  await sessB.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. DISCONNECT_INTENT.AUTO_WIN — full chain through disconnectController
// ─────────────────────────────────────────────────────────────────────────────

test('AUTO_WIN resigns the opponent slot and writes abandoned+disconnect to Firebase', async () => {
  bus._reset();

  const db = makeMockDb();
  const room = await setupPlayingRoom(db, 'friend-live');
  const sess = await createOnlineGameSession({ bus, db, room, mySlot: 0 });

  const ctl = createDisconnectController({
    bus,
    dbRef: () => db,
    sessionRef: () => sess,
    watchPresence: () => () => {},
    graceMs: 100,
    now: () => Date.now(),
  });

  bus.emit(DISCONNECT_INTENT.AUTO_WIN, {});
  await new Promise(r => setTimeout(r, 20));

  const roomNow = await readRoom(db);
  assert.equal(roomNow.status, 'abandoned',
    'room must be abandoned after AUTO_WIN');
  assert.equal(roomNow.abandonedBy, 1,
    'opponent (slot 1) is the abandoner');
  assert.equal(roomNow.abandonReason, 'disconnect',
    'abandon reason must be "disconnect"');

  ctl.dispose();
  await sess.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. disconnectController: presence watch opens / closes overlay
// ─────────────────────────────────────────────────────────────────────────────

test('disconnect controller opens DISCONNECT_OPEN when opponent goes offline', () => {
  bus._reset();

  let presenceCb = null;
  const opened = [];
  const closed = [];

  const session = {
    mySlot: 0,
    state: { mode: 'random-live', players: PLAYERS },
  };

  const ctl = createDisconnectController({
    bus,
    dbRef: () => ({}),
    sessionRef: () => session,
    watchPresence: (_db, uid, cb) => {
      assert.equal(uid, 'bob', 'must watch the opponent uid (bob)');
      presenceCb = cb;
      return () => {};
    },
    graceMs: 1_000,
    now: () => 10_000,
  });

  bus.on(DISCONNECT_OPEN, p => opened.push(p));
  bus.on(DISCONNECT_CLOSE, p => closed.push(p));

  // Opponent appears offline.
  presenceCb({ connected: false, lastSeen: 0 });
  assert.equal(opened.length, 1, 'DISCONNECT_OPEN must fire when opponent is offline');
  assert.equal(opened[0].opponentName, 'Bob', 'must pass opponent display name');

  // Opponent reconnects.
  presenceCb({ connected: true, lastSeen: 10_000 });
  assert.equal(closed.length, 1, 'DISCONNECT_CLOSE must fire when opponent comes back online');

  ctl.dispose();
});

test('disconnect controller does not open overlay for backgrounded opponent', () => {
  bus._reset();

  let presenceCb = null;
  let opened = 0;

  const session = {
    mySlot: 0,
    state: { mode: 'friend-live', players: PLAYERS },
  };

  const ctl = createDisconnectController({
    bus,
    dbRef: () => ({}),
    sessionRef: () => session,
    watchPresence: (_db, _uid, cb) => { presenceCb = cb; return () => {}; },
    graceMs: 1_000,
    now: () => 99_999_999,
  });

  bus.on(DISCONNECT_OPEN, () => opened++);

  // Opponent's tab is backgrounded (mobile throttles heartbeat; counts as alive).
  presenceCb({ backgrounded: true, connected: false, lastSeen: 0 });
  assert.equal(opened, 0,
    'backgrounded opponent must NOT trigger the disconnect overlay');

  ctl.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. disconnectController: polling catches stale lastSeen
//    (phase-1A bug-2 fix: purely event-driven detection was unreliable)
// ─────────────────────────────────────────────────────────────────────────────

test('disconnect controller: polling detects stale lastSeen without a new Firebase push', async () => {
  // Scenario: Firebase's onDisconnect hook has not fired yet (can take 30-60 s
  // in RTDB).  The local clock has advanced past the grace period. Without the
  // polling fix (bug 2), the overlay would never open. With it, the poll tick
  // calls isPresenceOnline(lastPresence, now()) and detects the stale entry.
  bus._reset();

  let nowMs = 1_000_000;
  let presenceCb = null;
  let opened = 0;

  const session = {
    mySlot: 0,
    state: { mode: 'friend-live', players: PLAYERS },
  };

  const ctl = createDisconnectController({
    bus,
    dbRef: () => ({}),
    sessionRef: () => session,
    watchPresence: (_db, _uid, cb) => { presenceCb = cb; return () => {}; },
    graceMs: 5_000,  // 5 s grace
    now: () => nowMs,
    pollMs: 10,      // Very short interval so the poll fires within the test timeout.
  });

  bus.on(DISCONNECT_OPEN, () => opened++);

  // Opponent last seen at t=1 000 000. connected field intentionally absent so
  // the lastSeen fallback path in isPresenceOnline() is exercised (the scenario
  // where Firebase's onDisconnect hasn't written connected:false yet but the
  // heartbeat has gone silent).
  presenceCb({ lastSeen: 1_000_000 });
  assert.equal(opened, 0, 'not stale yet');

  // Advance the clock 6 s past the grace period without Firebase firing again.
  nowMs = 1_006_000;

  // Let the polling interval fire.
  await new Promise(r => setTimeout(r, 80));

  assert.equal(opened, 1,
    'polling must detect the stale lastSeen and open the disconnect overlay');

  ctl.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. disconnectController: polling must stop after GAME_COMPLETED
// ─────────────────────────────────────────────────────────────────────────────

test('disconnect controller: DISCONNECT_OPEN does not fire after GAME_COMPLETED even with stale presence', async () => {
  bus._reset();

  let nowMs = 1_000_000;
  let presenceCb = null;
  let opened = 0;

  const session = {
    mySlot: 0,
    state: { mode: 'friend-live', players: PLAYERS },
  };

  const ctl = createDisconnectController({
    bus,
    dbRef: () => ({}),
    sessionRef: () => session,
    watchPresence: (_db, _uid, cb) => { presenceCb = cb; return () => {}; },
    graceMs: 5_000,
    now: () => nowMs,
    pollMs: 10,
  });

  bus.on(DISCONNECT_OPEN, () => opened++);

  // Presence is fresh.
  presenceCb({ lastSeen: 1_000_000 });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(opened, 0, 'no disconnect yet — presence is fresh');

  // Game ends.
  bus.emit(EV.GAME_COMPLETED, {});

  // Advance the clock well past the grace period.
  nowMs = 1_010_000;

  // Wait long enough for any stray poll ticks to fire.
  await new Promise(r => setTimeout(r, 80));

  assert.equal(opened, 0,
    'polling must have stopped at GAME_COMPLETED; no new DISCONNECT_OPEN must fire');

  ctl.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. disconnectController: no-op for non-presenceCritical modes
// ─────────────────────────────────────────────────────────────────────────────

test('disconnect controller does not subscribe to presence for async mode', () => {
  bus._reset();

  let presenceWatches = 0;
  const session = {
    mySlot: 0,
    state: { mode: 'friend-async', players: PLAYERS },
  };

  const ctl = createDisconnectController({
    bus,
    dbRef: () => ({}),
    sessionRef: () => session,
    watchPresence: () => { presenceWatches++; return () => {}; },
    graceMs: 1_000,
    now: () => Date.now(),
  });

  // Also verify that a fresh GAME_STARTED doesn't enable watching.
  bus.emit(EV.GAME_STARTED, {});

  assert.equal(presenceWatches, 0,
    'async mode is not presenceCritical — presence must never be subscribed');

  ctl.dispose();
});

test('disconnect controller does not subscribe to presence for offline mode', () => {
  bus._reset();

  let presenceWatches = 0;
  const session = {
    mySlot: 0,
    state: { mode: 'offline-2p', players: PLAYERS },
  };

  const ctl = createDisconnectController({
    bus,
    dbRef: () => ({}),
    sessionRef: () => session,
    watchPresence: () => { presenceWatches++; return () => {}; },
    graceMs: 1_000,
    now: () => Date.now(),
  });

  assert.equal(presenceWatches, 0);
  ctl.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. onlineGameSession.dispose() — cleanup invariants
// ─────────────────────────────────────────────────────────────────────────────

test('session dispose: stops watchRoom so no events fire after teardown', async () => {
  bus._reset();

  const db = makeMockDb();
  const room = await setupPlayingRoom(db, 'friend-live');
  const sess = await createOnlineGameSession({ bus, db, room, mySlot: 0 });

  const firedEvents = [];
  bus.on(EV.TURN_CHANGED, p => firedEvents.push(p));
  bus.on(EV.OPPONENT_MOVED, p => firedEvents.push(p));
  bus.on(EV.GAME_COMPLETED, p => firedEvents.push(p));

  await sess.dispose();

  // Push a room mutation after dispose.
  await db.ref('rooms/room').update({
    version: 2,
    currentTurnSlot: 1,
    turnNumber: 2,
    status: 'abandoned',
    abandonedBy: 1,
    lastMove: { type: 'pass', slot: 0, turnNumber: 1, ts: Date.now() },
  });
  await new Promise(r => setTimeout(r, 10));

  assert.equal(firedEvents.length, 0,
    'no session events must fire after dispose — all Firebase watchers must be unsubscribed');
});

test('session dispose: calls leaveRoom and clears users/{uid}/activeRoom', async () => {
  bus._reset();

  const db = makeMockDb();
  const room = await setupPlayingRoom(db, 'friend-live');
  const sess = await createOnlineGameSession({ bus, db, room, mySlot: 0 });

  assert.equal(db._data.users?.alice?.activeRoom, 'room',
    'activeRoom must be set before dispose');

  await sess.dispose();

  assert.equal(db._data.users?.alice?.activeRoom ?? null, null,
    'users/{uid}/activeRoom must be cleared after dispose');
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. setStatus — live vs. async room index cleanup
// ─────────────────────────────────────────────────────────────────────────────

test('setStatus abandoned on live room does NOT touch asyncRooms index', async () => {
  const db = makeMockDb();
  await setupPlayingRoom(db, 'friend-live');

  await setStatus(db, 'room', 'abandoned', { abandonedBy: 0 });

  assert.equal(db._data.users?.alice?.asyncRooms?.['room'] ?? null, null,
    'live-room abandonment must leave asyncRooms untouched for alice');
  assert.equal(db._data.users?.bob?.asyncRooms?.['room'] ?? null, null,
    'live-room abandonment must leave asyncRooms untouched for bob');
});

test('setStatus abandoned on async room clears asyncRooms index for both players', async () => {
  const db = makeMockDb();
  // createRoom writes asyncRooms for async modes.
  await setupPlayingRoom(db, 'friend-async');

  // Verify the async index was written by createRoom.
  assert.ok(db._data.users?.alice?.asyncRooms?.['room'] != null,
    'async index must exist before abandon');
  assert.ok(db._data.users?.bob?.asyncRooms?.['room'] != null,
    'async index must exist before abandon');

  await setStatus(db, 'room', 'abandoned', { abandonedBy: 0 });

  assert.equal(db._data.users?.alice?.asyncRooms?.['room'] ?? null, null,
    'async-room abandonment must clear alice\'s asyncRooms entry');
  assert.equal(db._data.users?.bob?.asyncRooms?.['room'] ?? null, null,
    'async-room abandonment must clear bob\'s asyncRooms entry');
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Full end-game flow: resign → EV.GAME_COMPLETED → END_INTENT.GO_HOME
// ─────────────────────────────────────────────────────────────────────────────

test('END_INTENT.GO_HOME after online resign calls endActiveGame and navigates home', async () => {
  bus._reset();

  const db = makeMockDb();
  const room = await setupPlayingRoom(db, 'friend-live');
  const sess = await createOnlineGameSession({ bus, db, room, mySlot: 0 });

  let endedCount = 0;
  const screens = [];

  // Simulate activeGameRef: returns ag until end() is called, then null.
  const ag = {
    online: true, isAsync: false, session: sess,
    end() {
      endedCount++;
      sess.dispose();
    },
  };
  createGameFlowController({
    bus, root: NULL_ROOT,
    activeGameRef: () => (endedCount ? null : ag),
    showScreen: id => screens.push(id),
  });

  // Resign the game first.
  sess.dispatch({ type: CMD.RESIGN_GAME, payload: { slot: 0 } });
  await new Promise(r => setTimeout(r, 10));

  // Simulate the player clicking "go home" on the end-game overlay.
  bus.emit('end/goHome', {});

  assert.equal(endedCount, 1, 'endActiveGame must be called when go-home is pressed');
  assert.deepEqual(screens, ['sh'], 'must navigate to home screen after go-home');
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. GAME_COMPLETED fires exactly once when local player resigns
// ─────────────────────────────────────────────────────────────────────────────

test('GAME_COMPLETED fires exactly once when local player dispatches RESIGN_GAME', async () => {
  bus._reset();

  const db = makeMockDb();
  const room = await setupPlayingRoom(db, 'friend-live');
  const sess = await createOnlineGameSession({ bus, db, room, mySlot: 0 });

  const completedEvents = [];
  bus.on(EV.GAME_COMPLETED, p => completedEvents.push(p));

  sess.dispatch({ type: CMD.RESIGN_GAME, payload: { slot: 0 } });
  // Allow watchRoom round-trip (setStatus fires a Firebase update).
  await new Promise(r => setTimeout(r, 30));

  assert.equal(completedEvents.length, 1,
    'GAME_COMPLETED must fire exactly once — not again when Firebase echoes the status write');

  await sess.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Resigning player's slot is always the leaving player, not currentTurnSlot
// ─────────────────────────────────────────────────────────────────────────────

test('BACK_INTENT.LEAVE resigns mySlot even when it is not the current turn', () => {
  // If it's the opponent's turn and player 0 closes the app, slot 0 (not slot 1)
  // must be abandoned.
  bus._reset();

  const dispatched = [];
  const ag = {
    online: true,
    isAsync: false,
    session: {
      mySlot: 0,
      state: {
        mode: 'friend-live',
        currentTurnSlot: 1,  // Opponent's turn when player 0 leaves.
        players: PLAYERS,
        scores: { 0: 0, 1: 0 },
        settings: {},
      },
      dispatch(cmd) { dispatched.push(cmd); },
    },
    end() {},
  };

  createGameFlowController({ bus, root: NULL_ROOT, activeGameRef: () => ag });
  bus.emit(BACK_INTENT.LEAVE, {});

  assert.equal(dispatched[0]?.payload?.slot, 0,
    'must resign mySlot (0), not currentTurnSlot (1)');
});

console.info = _origInfo;
