// Regression test for a game-ending turn whose own commit never reached the
// room. Found by the live soak agents (Oct 2026 regression run, soak4 g25,
// signature end-desync-ownRack, friend-async).
//
// An exchange is a scoreless turn, so the 4th one in a row ends the game. The
// engine emits TILES_EXCHANGED (the session queues the room commit) and then
// GAME_COMPLETED in the same tick. The commit is queued behind the commit
// chain, but the GAME_COMPLETED handler wrote `status: 'completed'` at once,
// so the status reached the server FIRST. The room was terminal before the
// exchange arrived and the rules refused it, so the finished game kept the
// player's pre-exchange rack and bag while their own screen showed the new
// rack.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../src/events/bus.js';
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

// Like the RTDB rules: once the room is terminal, a game-state write is refused.
function withTerminalGuard(db) {
  const order = [];
  return {
    order,
    db: new Proxy(db, {
      get(target, prop) {
        if (prop !== 'ref') return Reflect.get(target, prop);
        return (path) => {
          const ref = target.ref(path);
          if (path !== 'rooms/room') return ref;
          return new Proxy(ref, {
            get(r, p) {
              if (p !== 'update') {
                const v = Reflect.get(r, p);
                return typeof v === 'function' ? v.bind(r) : v;
              }
              return async (patch) => {
                const cur = (await r.get()).val();
                const terminal = ['completed', 'abandoned', 'expired'].includes(cur?.status);
                const isStatusWrite = Object.keys(patch).includes('status');
                order.push(isStatusWrite ? 'status' : 'commit');
                if (terminal && !isStatusWrite) {
                  throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' });
                }
                return r.update(patch);
              };
            },
          });
        };
      },
    }),
  };
}

test('a game-ending exchange reaches the room before the game-over status', async () => {
  bus._reset();
  const base = makeMockDb();
  const guarded = withTerminalGuard(base);
  const engineState = createInitialState({ mode: 'friend-live', tileBagSeed: 'end-exchange', players: PLAYERS, settings: {}, startingSlot: 0 });
  await createRoom(base, { roomId: 'room', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });
  await base.ref('rooms/room').update({ status: 'playing' });
  const room = await readRoom(base, 'room');
  const alice = await createOnlineGameSession({ bus, db: guarded.db, room, mySlot: 0 });
  alice.start();
  await tick();

  // Three scoreless turns (played as Alice for brevity — the mock has no
  // turn rules), so the next exchange is the game-ending 4th.
  for (let i = 0; i < 3; i++) {
    alice.state.currentTurnSlot = 0;
    alice.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } });
    await tick(8);
  }
  assert.equal(alice.state.passCount, 3);
  alice.state.currentTurnSlot = 0;
  guarded.order.length = 0;

  alice.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: alice.state.racks[0].slice(0, 2) } });
  await tick(16);

  assert.equal(alice.state.status, 'completed');
  const after = await readRoom(base, 'room');
  assert.equal(after.status, 'completed');
  assert.deepEqual(guarded.order, ['commit', 'status'], 'the exchange commit goes out before the status write');
  assert.deepEqual(after.racks[0], alice.state.racks[0], "the room holds Alice's post-exchange rack");
  assert.deepEqual(after.bag ?? [], alice.state.bag);
});

test.after(() => { console.info = _origInfo; });
