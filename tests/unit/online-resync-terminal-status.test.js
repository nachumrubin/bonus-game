// Regression test for a terminal status being reverted to 'playing' by a
// stale forceResync read. Found by the live soak agents (Oct 2026 regression
// run, signature end-status-mismatch / end-desync-status, friend-live with a
// poor-network player).
//
// The game ends with a status-only write: the 4th scoreless turn is committed
// at version N (still 'playing'), then the engine that saw game-over writes
// `status: 'completed'` WITHOUT bumping the version. A client that is in the
// middle of a forceResync (its own commit just lost the race) can therefore:
//   1. start readRoom → the SDK answers with the room as it is NOW (N, playing)
//   2. receive the status-only update on its watcher → status 'completed',
//      GAME_COMPLETED fires
//   3. have the read resolve → forceResync copied `status: 'playing'` back.
// forceResync's stale-read guard compared versions only, and both reads are
// version N. The client was left on a live board for a game that was over.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../src/events/bus.js';
import { EV } from '../../src/events/eventTypes.js';
import { CMD } from '../../src/events/commands.js';
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

// Wrap the mock db so reads of the room can be held in flight: the value is
// captured when get() is called (what the SDK would answer from its view at
// that moment) and only delivered when the test releases it.
function makeHoldableDb(db) {
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
            if (p !== 'get' || !holding) {
              const v = Reflect.get(r, p);
              return typeof v === 'function' ? v.bind(r) : v;
            }
            return async () => {
              const snap = await r.get();
              const value = snap.val();
              return new Promise((resolve) => held.push(() => resolve({ val: () => value, exists: () => value != null })));
            };
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

test('a stale forceResync read cannot revert a terminal status the watcher already applied', async () => {
  bus._reset();
  const base = makeMockDb();
  const h = makeHoldableDb(base);
  const engineState = createInitialState({ mode: 'friend-live', tileBagSeed: 'resync-terminal', players: PLAYERS, settings: {}, startingSlot: 0 });
  await createRoom(base, { roomId: 'room', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });
  await base.ref('rooms/room').update({ status: 'playing' });
  const room = await readRoom(base, 'room');
  const bob = await createOnlineGameSession({ bus, db: h.db, room, mySlot: 1 });
  bob.start();
  await tick();
  const serverRoom = await readRoom(base, 'room');
  const N = serverRoom.version;

  const completed = [];
  bus.on(EV.GAME_COMPLETED, (p) => completed.push(p));

  // Bob's own optimistic write is raised (N+1) and then rejected (back to N):
  // the watcher realigns and calls forceResync — whose read we hold.
  h.hold();
  await base.ref('rooms/room').set({ ...serverRoom, version: N + 1,
    lastMove: { type: 'pass', slot: 1, ts: 7_000_001, passReason: 'timeout' } });
  await tick();
  await base.ref('rooms/room').set(serverRoom);
  await tick(8);
  assert.ok(h.heldCount() >= 1, 'forceResync read is in flight');

  // The game ends with a status-only write at the same version N.
  await base.ref('rooms/room').update({ status: 'completed' });
  await tick(8);
  assert.equal(bob.state.status, 'completed', 'watcher applied the terminal status');
  assert.equal(completed.length, 1);

  // The stale read (N, playing) now resolves.
  h.release();
  await tick(12);

  assert.equal(bob.state.status, 'completed', 'a stale read must not put a finished game back into play');
  assert.equal(completed.length, 1, 'GAME_COMPLETED fires exactly once');
});

test.after(() => { console.info = _origInfo; });

// Second shape of the same failure (soak g8, 4g/4g): Bob's own turn timer
// expires on the 4th scoreless turn, his engine ends the game and writes the
// terminal status directly. Alice's watchdog committed the very same timeout
// one version later, still 'playing' (her client hadn't run game-over yet).
// That newer snapshot reached Bob before any status-only update and the
// watcher copied 'playing' over his finished game.
test("a newer 'playing' snapshot does not revive a game this client already ended", async () => {
  bus._reset();
  const db = makeMockDb();
  const engineState = createInitialState({ mode: 'friend-live', tileBagSeed: 'resync-terminal-2', players: PLAYERS, settings: {}, startingSlot: 1 });
  await createRoom(db, { roomId: 'room', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });
  await db.ref('rooms/room').update({ status: 'playing', _passCount: 3 });
  const room = await readRoom(db, 'room');
  const bob = await createOnlineGameSession({ bus, db, room, mySlot: 1 });
  bob.start();
  await tick();
  const serverRoom = await readRoom(db, 'room');
  assert.equal(bob.state.currentTurnSlot, 1);
  assert.equal(bob.state.passCount, 3);

  const completed = [];
  bus.on(EV.GAME_COMPLETED, (p) => completed.push(p));

  // Swallow Bob's own writes so only Alice's snapshot reaches the room: on a
  // slow uplink his pass / status write haven't arrived yet.
  const realRef = db.ref.bind(db);
  db.ref = (p) => {
    const ref = realRef(p);
    if (p === 'rooms/room') {
      ref.update = () => new Promise(() => {});
      ref.transaction = () => new Promise(() => {});
    }
    return ref;
  };
  bob.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'timeout' } });
  await tick(8);
  assert.equal(bob.state.status, 'completed', "Bob's engine ended the game on the 4th scoreless turn");
  assert.equal(completed.length, 1);

  db.ref = realRef;
  // Alice's watchdog commit of the same timeout: newer version, still playing.
  await db.ref('rooms/room').set({ ...serverRoom, version: serverRoom.version + 1, currentTurnSlot: 0,
    turnNumber: serverRoom.turnNumber + 1, _passCount: 4 });
  await tick(8);

  assert.equal(bob.state.status, 'completed', 'the finished game stays finished');
  assert.equal(completed.length, 1, 'GAME_COMPLETED fires exactly once');
});
