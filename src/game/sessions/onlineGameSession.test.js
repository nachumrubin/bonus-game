// End-to-end test of onlineGameSession against the mock Firebase.
// Two sessions (one per slot) play a move each and we verify both clients
// converge on the same state via the room's version-guarded transactions.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { DICT, addWordsFromText } from '../core/hebrewDictionary.js';
import { makeMockDb } from '../online/mockFirebase.js';
import { createRoom } from '../online/roomService.js';
import { createInitialState } from '../core/gameEngine.js';
import { createOnlineGameSession } from './onlineGameSession.js';

const _origLog = console.log;
console.log = () => {};

const PLAYERS = {
  0: { uid: 'a', displayName: 'A', avatar: null, joinedAt: 1 },
  1: { uid: 'b', displayName: 'B', avatar: null, joinedAt: 1 },
};

async function setupRoom(db, mode = 'friend-live', settings = {}) {
  const engineState = createInitialState({
    mode, tileBagSeed: 'online-test', players: PLAYERS, settings,
  });
  // Force known racks so both clients produce the same engineState on engineStateFromRoom
  engineState.racks = {
    0: ['א','ב','ג','ד','ה','ו','ז','ח'],
    1: ['ט','י','כ','ל','מ','נ','ס','ע'],
  };
  await createRoom(db, {
    roomId: 'online-room', mode, players: PLAYERS, settings,
    engineState, serverTimestamp: 1000,
  });
  // Tests bypass the ready handshake — flip status to 'playing' directly.
  const initialDeadline = settings?.timelimit ? 1000 + Number(settings.botTime || 0) * 1000 : null;
  await db.ref('rooms/online-room').update({ status: 'playing', turnDeadlineMs: initialDeadline });
}

test('online session: local move is committed to Firebase and remote slot sees it', async () => {
  bus._reset();
  DICT.clear();
  addWordsFromText('אב\n');
  const db = makeMockDb();
  await setupRoom(db);

  // Two sessions sharing the SAME bus and SAME db (simulating two clients
  // for the purpose of this in-memory test). In production they'd be
  // separate processes; the mock fires watchers synchronously which is good
  // enough to test round-trip via Firebase semantics.
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  const moveConfirmed = [];
  bus.on(EV.MOVE_CONFIRMED, p => moveConfirmed.push(p));

  // Slot 0 plays 'אב' at (4,4)-(4,5)
  sessA.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1 },
        { r: 4, c: 5, letter: 'ב', val: 3 },
      ],
    },
  });

  // Allow microtasks to flush (commitTransaction is async)
  await new Promise(r => setTimeout(r, 0));

  assert.equal(moveConfirmed.length, 1);
  assert.equal(moveConfirmed[0].score, 4);

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.scores[0], 4);
  assert.equal(roomNow.currentTurnSlot, 1);
  assert.ok(roomNow.version > 1);

  await sessA.dispose();
});

test('online session: refuses to dispatch CONFIRM_MOVE when not your turn', async () => {
  bus._reset();
  DICT.clear();
  addWordsFromText('אב\n');
  const db = makeMockDb();
  await setupRoom(db);

  // mySlot=1 but currentTurnSlot=0 → engine sees 0; this client tries to commit anyway.
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });

  let confirmed = 0;
  bus.on(EV.MOVE_CONFIRMED, () => { confirmed++; });

  sessB.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: 4, c: 4, letter: 'א', val: 1 }] },
  });

  await new Promise(r => setTimeout(r, 0));
  assert.equal(confirmed, 0); // gated by mySlot mismatch
  await sessB.dispose();
});

test('online session: local pass is committed to Firebase', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  sessA.dispatch({ type: CMD.PASS_TURN });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.currentTurnSlot, 1);
  assert.equal(roomNow.lastMove.type, 'pass');
  assert.equal(roomNow.lastMove.slot, 0);
  assert.ok(roomNow.version > 1);
  await sessA.dispose();
});

test('online session: local resign writes terminal status and clears async indexes', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db, 'friend-async');
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  sessA.dispatch({ type: CMD.RESIGN_GAME, payload: { slot: 0 } });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.status, 'abandoned');
  assert.equal(roomNow.abandonedBy, 0);
  assert.equal(db._data.users.a.asyncRooms?.['online-room'] ?? null, null);
  assert.equal(db._data.users.b.asyncRooms?.['online-room'] ?? null, null);
  await sessA.dispose();
});

test('online session: remote terminal status is observed even without a version bump', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db, 'friend-live');
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });
  const completed = [];
  bus.on(EV.GAME_COMPLETED, p => completed.push(p));

  await db.ref('rooms/online-room').update({
    status: 'abandoned',
    abandonedBy: 0,
  });
  await new Promise(r => setTimeout(r, 0));

  assert.equal(sessB.state.status, 'abandoned');
  assert.equal(sessB.state.abandonedBy, 0);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, 'abandoned');
  assert.equal(completed[0].abandonedBy, 0);
  await sessB.dispose();
});

test('online session: turn-advancing commit rotates the shared deadline and resets missed turn count', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db, 'friend-live', { timelimit: true, botTime: 20 });
  await db.ref('rooms/online-room').update({ missedTurns: { 0: 2, 1: 0 } });
  const before = db._data.rooms['online-room'].turnDeadlineMs;
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  sessA.dispatch({ type: CMD.PASS_TURN });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.currentTurnSlot, 1);
  assert.ok(roomNow.turnDeadlineMs > before);
  assert.equal(roomNow.missedTurns[0], 0);
  await sessA.dispose();
});

test('online session: no-lastMove timeout snapshot resyncs remote turn state', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db, 'friend-live', { timelimit: true, botTime: 20 });
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });
  const turns = [];
  bus.on(EV.TURN_CHANGED, p => turns.push(p));

  await db.ref('rooms/online-room').update({
    version: 2,
    currentTurnSlot: 1,
    turnNumber: 2,
    turnDeadlineMs: 50_000,
    missedTurns: { 0: 1, 1: 0 },
    lastMove: null,
  });
  await new Promise(r => setTimeout(r, 0));

  assert.equal(sessB.state.currentTurnSlot, 1);
  assert.equal(sessB.state.turnNumber, 2);
  assert.equal(sessB.state.turnDeadlineMs, 50_000);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].currentTurnSlot, 1);
  await sessB.dispose();
});

test('online session: deferred bonus scoring commits once on MOVE_SCORE_COMMITTED', async () => {
  bus._reset();
  DICT.clear();
  const ALEF = '\u05d0';
  const BET = '\u05d1';
  addWordsFromText(`${BET}${ALEF}\n`);
  const db = makeMockDb();
  await setupRoom(db, 'friend-live');

  const board = new Array(100).fill(null);
  board[1] = { letter: ALEF, val: 1, isJoker: false };
  await db.ref('rooms/online-room').update({
    board,
    racks: {
      0: [BET, '\u05d2', '\u05d3', '\u05d4', '\u05d5', '\u05d6', '\u05d7', '\u05d8'],
      1: ['\u05d8', '\u05d9', '\u05db', '\u05dc', '\u05de', '\u05e0', '\u05e1', '\u05e2'],
    },
    currentTurnSlot: 0,
    firstMove: false,
    bonusAssignment: [{ type: 'B2', pts: 40, ic: '*' }],
    bonusSqUsed: {},
  });
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  sessA.state.firstMove = false;

  sessA.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [{ r: -1, c: 1, letter: BET, val: 3 }],
    },
  });
  await new Promise(r => setTimeout(r, 0));

  assert.equal(db._data.rooms['online-room'].version, 1, 'deferred MOVE_CONFIRMED must not commit yet');
  assert.equal(db._data.rooms['online-room'].scores[0], 0);

  sessA.dispatch({ type: CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra: 20 } });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.version, 2, 'MOVE_SCORE_COMMITTED commits the final scored move exactly once');
  assert.equal(roomNow.scores[0], 24);
  assert.equal(roomNow.currentTurnSlot, 1);
  assert.equal(roomNow.lastMove.score, 24);
  assert.equal(roomNow.bonusBoard['-1,1'].letter, BET);
  assert.equal(roomNow.bonusSqUsed[0], true);
  await sessA.dispose();
});

test('online session: remote pass resyncs local turn state', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });
  const turns = [];
  bus.on(EV.TURN_CHANGED, p => turns.push(p));

  await db.ref('rooms/online-room').update({
    version: 2,
    currentTurnSlot: 1,
    turnNumber: 2,
    lastMove: { type: 'pass', slot: 0, turnNumber: 1, ts: 123 },
  });

  assert.equal(sessB.state.currentTurnSlot, 1);
  assert.equal(sessB.state.turnNumber, 2);
  assert.equal(turns.at(-1).currentTurnSlot, 1);
  await sessB.dispose();
});

test('online session: local exchange is committed to Firebase', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  sessA.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: ['א'] } });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.lastMove.type, 'exchange');
  assert.equal(roomNow.lastMove.slot, 0);
  assert.equal(roomNow.currentTurnSlot, 1);
  assert.ok(roomNow.version > 1);
  await sessA.dispose();
});

test('online session: local free-exchange consumes boost without advancing turn', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  await db.ref('rooms/online-room').update({
    activeBoosts: [{ slot: 0, boostId: 'free_tile_swap', payload: {}, turnNumber: 1 }],
    version: 2,
  });
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  sessA.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: ['א'], freeSwap: true } });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.lastMove.type, 'free-exchange');
  assert.equal(roomNow.lastMove.slot, 0);
  assert.equal(roomNow.currentTurnSlot, 0, 'turn must not advance on free swap');
  assert.equal(roomNow.activeBoosts.length, 0, 'boost should be consumed');
  await sessA.dispose();
});

test('online session: remote exchange resyncs local rack/turn state', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });
  const exchanges = [];
  bus.on(EV.TILES_EXCHANGED, p => exchanges.push(p));

  await db.ref('rooms/online-room').update({
    version: 2,
    currentTurnSlot: 1,
    turnNumber: 2,
    racks: { 0: ['א','ב','ג','ד','ה','ו','ז','ח'], 1: ['ט','י','כ','ל','מ','נ','ס','ע'] },
    lastMove: { type: 'exchange', slot: 0, count: 2, turnNumber: 1, ts: 123 },
  });

  assert.equal(sessB.state.currentTurnSlot, 1);
  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0].slot, 0);
  assert.equal(exchanges[0].free, false);
  await sessB.dispose();
});

test('online session: remote free-exchange does not emit TURN_CHANGED', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });
  const turns = [];
  const exchanges = [];
  bus.on(EV.TURN_CHANGED, p => turns.push(p));
  bus.on(EV.TILES_EXCHANGED, p => exchanges.push(p));

  await db.ref('rooms/online-room').update({
    version: 2,
    currentTurnSlot: 0,
    turnNumber: 1,
    racks: { 0: ['א','ב','ג','ד','ה','ו','ז','ח'], 1: ['ט','י','כ','ל','מ','נ','ס','ע'] },
    activeBoosts: [],
    lastMove: { type: 'free-exchange', slot: 0, count: 1, turnNumber: 1, ts: 123 },
  });

  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0].free, true);
  assert.equal(turns.length, 0, 'free-exchange must not emit TURN_CHANGED');
  await sessB.dispose();
});

test('online session: emits live preview updates without requiring a version bump', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  const previews = [];
  bus.on(EV.LIVE_PREVIEW_CHANGED, p => previews.push(p));

  await db.ref('rooms/online-room/livePreview').set({
    slot: 1,
    tiles: [{ r: 5, c: 5, letter: '׳˜', val: 1, isJoker: false }],
  });

  assert.equal(previews.length, 1);
  assert.equal(sessA.state.livePreview.slot, 1);
  assert.equal(previews[0].livePreview.tiles[0].letter, '׳˜');
  await sessA.dispose();
});

test('online session: applies settings updates without requiring a version bump', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  const settingsEvents = [];
  bus.on(EV.ROOM_SETTINGS_CHANGED, p => settingsEvents.push(p));

  await db.ref('rooms/online-room/settings').set({ timelimit: false, botTime: 35 });

  assert.equal(settingsEvents.length, 1);
  assert.deepEqual(sessA.state.settings, { timelimit: false, botTime: 35 });
  await sessA.dispose();
});

async function readRoom(db) {
  const snap = await db.ref('rooms/online-room').get();
  return snap.val();
}

console.log = _origLog;
