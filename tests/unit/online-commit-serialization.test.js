// Regression test for back-to-back own commits racing each other. Found by the
// live soak agents (Oct 2026 regression run, signature stuck-turn, an untimed
// random-async game with a poor-network player).
//
// A bonus-square move is two writes: the deferred commit (tiles, no score, turn
// stays) and, once the award is acknowledged, the finalize commit (score +
// turn rotation). On a slow link the deferred commit's promise had not resolved
// yet when the player tapped the award card, so the finalize commit was issued
// with the OLD expectedVersion. The rules demand version + 1, the write was
// rejected, local state rolled back, and the resync showed the server still
// holding our deferred move on our turn — but the award had already been
// acknowledged, so nothing ever re-sent the finalize. In an untimed game no
// watchdog rescues it: the game was stuck forever.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../src/events/bus.js';
import { EV } from '../../src/events/eventTypes.js';
import { makeMockDb } from '../../src/game/online/mockFirebase.js';
import { createRoom, readRoom } from '../../src/game/online/roomService.js';
import { createInitialState } from '../../src/game/core/gameEngine.js';
import { createOnlineGameSession } from '../../src/game/sessions/onlineGameSession.js';

const PLAYERS = {
  0: { uid: 'alice', displayName: 'Alice', avatar: null, joinedAt: 1 },
  1: { uid: 'bob',   displayName: 'Bob',   avatar: null, joinedAt: 2 },
};
const _origInfo = console.info;
console.info = () => {};
async function tick(n = 4) { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); }

// A slow uplink: while holding, writes are only sent to the server (and so
// only echo back to listeners) when released — the simulator's network model.
function makeSlowAckDb(db) {
  const held = [];
  let holding = false;
  const wrapped = new Proxy(db, {
    get(target, prop) {
      if (prop !== 'ref') return Reflect.get(target, prop);
      return (path) => {
        const ref = target.ref(path);
        if (path !== 'rooms/room') return ref;
        return new Proxy(ref, {
          get(r, p) {
            const v = Reflect.get(r, p);
            if ((p !== 'update' && p !== 'transaction') || !holding) return typeof v === 'function' ? v.bind(r) : v;
            return (...args) => new Promise((resolve, reject) => {
              held.push(() => v.apply(r, args).then(resolve, reject));
            });
          },
        });
      };
    },
  });
  return {
    db: wrapped,
    hold() { holding = true; },
    release() { holding = false; for (const fn of held.splice(0)) fn(); },
    heldCount: () => held.length,
  };
}

test('the finalize commit of a bonus-square move waits for the slow deferred commit instead of racing it', async () => {
  bus._reset();
  const base = makeMockDb();
  const h = makeSlowAckDb(base);
  const engineState = createInitialState({ mode: 'random-async', tileBagSeed: 'serial-1', players: PLAYERS, settings: { timelimit: false }, startingSlot: 0 });
  await createRoom(base, { roomId: 'room', mode: 'random-async', players: PLAYERS, settings: { timelimit: false }, engineState, serverTimestamp: 1000 });
  await base.ref('rooms/room').update({ status: 'playing' });
  const room = await readRoom(base, 'room');
  const alice = await createOnlineGameSession({ bus, db: h.db, room, mySlot: 0 });
  alice.start();
  await tick();
  const N = (await readRoom(base, 'room')).version;
  const st = alice.state;

  // Alice's bonus-square move, as the engine leaves it after CONFIRM_MOVE with
  // deferred scoring: tiles placed, turn and score untouched.
  const move = { slot: 0, tiles: [{ r: 5, c: 5, letter: 'א', val: 1, isJoker: false }], words: ['א'], score: 7, ts: 9_000_001, scoringDeferred: true };
  st.board[5][5] = { letter: 'א', val: 1, slot: 0 };
  st.moveHistory.push(move);
  st.firstMove = false;

  h.hold();
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, scoringDeferred: true, placed: move.tiles, score: 7 });
  await tick(8);
  assert.equal(h.heldCount(), 1, 'deferred commit still travelling');

  // The player acknowledges the award before the ack arrives: the engine
  // finalizes (score + turn rotation) and MOVE_SCORE_COMMITTED fires.
  move.scoringDeferred = false;
  st.scores[0] += 7;
  st.currentTurnSlot = 1;
  st.turnNumber += 1;
  const rejected = [];
  bus.on('evt/SYNC_REJECTED', (p) => rejected.push(p));
  bus.emit(EV.MOVE_SCORE_COMMITTED, { slot: 0, score: 7 });
  await tick(8);

  // Release in a loop: a commit queued behind the first is only sent after
  // the first resolves.
  for (let i = 0; i < 4; i++) { h.release(); await tick(16); }

  const server = await readRoom(base, 'room');
  assert.deepEqual(rejected, [], 'neither commit is rejected');
  assert.equal(server.version, N + 2, 'deferred + finalize both landed');
  assert.equal(server.currentTurnSlot, 1, "the turn passed to Bob — the game is not stuck on Alice's pending bonus");
  assert.equal(server.lastMove.scoringDeferred, false);
  assert.equal(server.scores[0], st.scores[0]);
  assert.equal(alice.state.currentTurnSlot, 1);
});

test('two quick own commits in one turn (free swap, then a move) both land', async () => {
  bus._reset();
  const base = makeMockDb();
  const h = makeSlowAckDb(base);
  const engineState = createInitialState({ mode: 'friend-live', tileBagSeed: 'serial-2', players: PLAYERS, settings: {}, startingSlot: 0 });
  await createRoom(base, { roomId: 'room', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });
  await base.ref('rooms/room').update({ status: 'playing' });
  const room = await readRoom(base, 'room');
  const alice = await createOnlineGameSession({ bus, db: h.db, room, mySlot: 0 });
  alice.start();
  await tick();
  const N = (await readRoom(base, 'room')).version;

  h.hold();
  bus.emit(EV.TILES_EXCHANGED, { slot: 0, count: 2, free: true });
  await tick(8);
  const st = alice.state;
  st.moveHistory.push({ slot: 0, tiles: [{ r: 5, c: 5, letter: 'א', val: 1, isJoker: false }], words: ['א'], score: 2, ts: 9_000_002 });
  st.board[5][5] = { letter: 'א', val: 1, slot: 0 };
  st.firstMove = false;
  st.currentTurnSlot = 1;
  st.turnNumber += 1;
  const rejected = [];
  bus.on('evt/SYNC_REJECTED', (p) => rejected.push(p));
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [], score: 2 });
  await tick(8);
  // Release in a loop: a commit queued behind the first is only sent after
  // the first resolves.
  for (let i = 0; i < 4; i++) { h.release(); await tick(16); }

  const server = await readRoom(base, 'room');
  assert.deepEqual(rejected, []);
  assert.equal(server.version, N + 2);
  assert.equal(server.currentTurnSlot, 1);
});

test.after(() => { console.info = _origInfo; });
