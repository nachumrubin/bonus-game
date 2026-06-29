import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { EV } from '../../events/eventTypes.js';
import { makeMockDb } from '../online/mockFirebase.js';
import { mountDebugRecorder } from './debugRecorder.js';
import { configureDebugLogger } from './debugLogger.js';
import { WARNING_TYPE } from './debugSchema.js';

configureDebugLogger({ serverTimestamp: () => 1000 });

function flat(occupied = {}) {
  const f = new Array(100).fill(null);
  for (const [i, letter] of Object.entries(occupied)) f[i] = { letter, val: 1 };
  return f;
}

function makeState() {
  return {
    status: 'playing', currentTurnSlot: 0, turnNumber: 1,
    players: { 0: { uid: 'u0', displayName: 'Nachum' }, 1: { uid: 'u1', displayName: 'Hodaya' } },
    scores: { 0: 0, 1: 0 }, racks: { 0: ['א'], 1: ['ב'] }, board: flat(),
    bag: new Array(80).fill('א'), moveHistory: [], roomId: 'room1',
  };
}

function setup() {
  bus._reset();
  const db = makeMockDb();
  const state = makeState();
  const ag = { online: true, mode: 'friend-live', mySlot: 0, session: { roomId: 'room1', mySlot: 0, state } };
  let roomCb = null;
  const watchRoom = (_db, _id, cb) => { roomCb = cb; return () => { roomCb = null; }; };
  const rec = mountDebugRecorder({ bus, getDb: () => db, getActiveGame: () => ag, watchRoom });
  return { db, state, ag, rec, driveRoom: (room) => roomCb?.(room) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('GAME_STARTED writes event, game index and a client snapshot', async () => {
  const { db, rec } = setup();
  bus.emit(EV.GAME_STARTED, {});
  await tick();
  const events = Object.values(db._data.gameEvents.room1);
  assert.ok(events.some(e => e.type === 'GAME_STARTED'));
  assert.equal(db._data.debugGameIndex.room1.hostName, 'Nachum');
  assert.equal(db._data.debugGameIndex.room1.guestName, 'Hodaya');
  assert.ok(db._data.clientSnapshots.room1['0'], 'a slot-0 client snapshot was written');
  assert.ok(rec.getLastEventId(), 'lastEventId tracked');
});

test('MOVE_CONFIRMED records a readable WORD_ACCEPTED summary + new client snapshot', async () => {
  const { db, state } = setup();
  bus.emit(EV.GAME_STARTED, {});
  await tick();
  const snapsBefore = Object.keys(db._data.clientSnapshots.room1['0']).length;
  // simulate engine applying the move before emitting
  state.board = flat({ 44: 'ש', 45: 'ל' });
  state.scores = { 0: 14, 1: 0 };
  state.moveHistory.push({ slot: 0, words: ['של'], score: 14 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [{ r: 4, c: 4 }], score: 14 });
  await tick();
  const events = Object.values(db._data.gameEvents.room1);
  const accepted = events.find(e => e.type === 'WORD_ACCEPTED');
  assert.ok(accepted);
  assert.match(accepted.summary, /Nachum played של for 14 points/);
  const snapsAfter = Object.keys(db._data.clientSnapshots.room1['0']).length;
  assert.ok(snapsAfter > snapsBefore, 'board change wrote a new client snapshot');
});

test('client snapshot stores a flat 100-cell board even from a 2D engine board', async () => {
  const { db, state } = setup();
  // Engine board is 2D (board[r][c]); a tile near the centre, top rows empty.
  state.board = Array.from({ length: 10 }, () => new Array(10).fill(null));
  state.board[4][4] = { letter: 'ש', val: 3, isJoker: false };
  bus.emit(EV.GAME_STARTED, {});
  await tick();
  const snap = Object.values(db._data.clientSnapshots.room1['0'])[0];
  assert.ok(Array.isArray(snap.board), 'stored board is a flat array');
  assert.equal(snap.board.length, 100);
  assert.equal(snap.board[44]?.letter, 'ש', 'tile mapped to flat index r*10+c');
  assert.equal(snap.board[0], null, 'empty cells are null');
});

test('client snapshot captures boost-square data (assignment, bonusBoard tiles, used)', async () => {
  const { db, state } = setup();
  state.bonusAssignment = Array.from({ length: 12 }, (_, i) => ({ type: `B${i + 1}`, pts: 10 + i, ic: '⚡' }));
  state.bonusBoard = new Map([['-1,1', { letter: 'ק', val: 5, isJoker: false }]]); // tile dropped on a top boost square
  state.bonusSqUsed = { 0: true };
  bus.emit(EV.GAME_STARTED, {});
  await tick();
  const snap = Object.values(db._data.clientSnapshots.room1['0'])[0];
  assert.equal(snap.bonusAssignment[0].type, 'B1');
  assert.equal(snap.bonusBoard['-1,1'].letter, 'ק', 'Map serialized to a plain keyed object');
  assert.equal(snap.bonusSqUsed['0'], true);
});

test('INVALID_MOVE_REJECTED records the reason AND the offending word(s)', async () => {
  const { db } = setup();
  bus.emit(EV.GAME_STARTED, {});
  bus.emit(EV.INVALID_MOVE_REJECTED, { reason: 'word-not-in-dictionary', placed: [], invalidWords: ['גמל', 'דשא'] });
  await tick();
  const rejected = Object.values(db._data.gameEvents.room1).find(e => e.type === 'WORD_REJECTED');
  assert.ok(rejected);
  assert.match(rejected.summary, /word-not-in-dictionary \(גמל, דשא\)/);
  assert.deepEqual(rejected.payload.invalidWords, ['גמל', 'דשא']);
});

test('INVALID_MOVE_REJECTED with no word list still records just the reason', async () => {
  const { db } = setup();
  bus.emit(EV.GAME_STARTED, {});
  bus.emit(EV.INVALID_MOVE_REJECTED, { reason: 'has-gaps', placed: [] });
  await tick();
  const rejected = Object.values(db._data.gameEvents.room1).find(e => e.type === 'WORD_REJECTED');
  assert.equal(rejected.summary, 'Move rejected: has-gaps');
});

test('server room versions write /gameSnapshots and host writes warnings', async () => {
  const { db, driveRoom } = setup();
  bus.emit(EV.GAME_STARTED, {});
  await tick();
  // A version with a negative score → NEGATIVE_SCORE warning (host = slot 0 writes it).
  driveRoom({
    version: 2, status: 'playing', currentTurnSlot: 1, turnNumber: 2,
    players: { 0: { uid: 'u0' }, 1: { uid: 'u1' } },
    scores: { 0: -5, 1: 10 }, racks: { 0: ['א'], 1: ['ב'] }, board: flat(), bag: new Array(80).fill('א'),
    lastMove: { slot: 0, score: 0 },
  });
  await tick();
  assert.ok(db._data.gameSnapshots.room1['2'], 'server snapshot stored under version key');
  const warnings = Object.values(db._data.debugWarnings?.room1 ?? {});
  assert.ok(warnings.some(w => w.type === WARNING_TYPE.NEGATIVE_SCORE), 'negative-score warning written');
});

test('guest (slot 1) does NOT write /gameSnapshots — only the host does', async () => {
  bus._reset();
  const db = makeMockDb();
  const state = makeState();
  const ag = { online: true, mode: 'friend-live', mySlot: 1, session: { roomId: 'room1', mySlot: 1, state } };
  let roomCb = null;
  const watchRoom = (_db, _id, cb) => { roomCb = cb; return () => { roomCb = null; }; };
  mountDebugRecorder({ bus, getDb: () => db, getActiveGame: () => ag, watchRoom });
  bus.emit(EV.GAME_STARTED, {});
  await tick();
  roomCb?.({
    version: 2, status: 'playing', currentTurnSlot: 0, turnNumber: 2,
    players: { 0: { uid: 'u0' }, 1: { uid: 'u1' } },
    scores: { 0: 5, 1: 10 }, racks: { 0: ['א'], 1: ['ב'] }, board: flat(), bag: new Array(80).fill('א'),
    lastMove: { slot: 0, score: 5 },
  });
  await tick();
  // The guest still records its own client snapshots, but never the server stream.
  assert.equal(db._data.gameSnapshots?.room1, undefined, 'guest wrote no server snapshot (avoids write-once race)');
  assert.ok(db._data.clientSnapshots.room1['1'], 'guest still wrote its own client snapshot');
});

test('getLastActions returns the in-memory ring buffer for reports', async () => {
  const { rec } = setup();
  bus.emit(EV.GAME_STARTED, {});
  bus.emit(EV.INVALID_MOVE_REJECTED, { reason: 'has-gaps' });
  await tick();
  const actions = rec.getLastActions();
  assert.ok(actions.length >= 2);
  assert.equal(actions[0].type, 'GAME_STARTED');
});
