// Regression test for the "poisoned version cursor" bug found by the live soak
// agents under simulated poor-network latency (October 2026, run3b g5).
//
// The Firebase SDK applies a client's own transaction OPTIMISTICALLY and
// raises it to listeners before the server answers. onlineGameSession's
// watcher treats that snapshot as the echo of our move and advances
// lastAppliedVersion to N+1. If the server then REJECTS the write (rules
// deny — e.g. a stale auto-pass after a lost race), the SDK reverts to the
// server's version N. Before the fix:
//   - the watcher ignored the reverted snapshot (N <= N+1), and
//   - forceResync only ever moved the cursor forward,
// so the cursor stayed at N+1. The opponent's next REAL move also carries
// version N+1 and was silently discarded: the player never saw it, never got
// their turn, and was timed out by the opponent's watchdog.

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

test('a rejected optimistic echo must not make the client ignore the opponent\'s next real move', async () => {
  bus._reset();
  const db = makeMockDb();
  const engineState = createInitialState({ mode: 'friend-live', tileBagSeed: 'cursor-1', players: PLAYERS, settings: {}, startingSlot: 0 });
  await createRoom(db, { roomId: 'room', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });
  await db.ref('rooms/room').update({ status: 'playing' });
  const room = await readRoom(db, 'room');
  // Only Bob (slot 1) needs a full session for this scenario; Alice (slot 0)
  // is the opponent whose move we write as a server snapshot.
  const bob = await createOnlineGameSession({ bus, db, room, mySlot: 1 });
  bob.start();
  await tick();
  const serverRoom = await readRoom(db, 'room');
  const N = serverRoom.version;
  assert.equal(serverRoom.currentTurnSlot, 0, "Alice's turn");

  // 1) The SDK raises Bob's OWN optimistic write (version N+1, lastMove = Bob's
  //    pass) to his listener...
  const optimistic = { ...serverRoom, version: N + 1, currentTurnSlot: 0, turnNumber: serverRoom.turnNumber + 1,
    lastMove: { type: 'pass', slot: 1, ts: 5_000_001, passReason: 'timeout' } };
  await db.ref('rooms/room').set(optimistic);
  await tick();
  // 2) ...then the server rejects it and the SDK reverts to version N.
  await db.ref('rooms/room').set(serverRoom);
  await tick(8);

  // 3) Alice makes a real move: the server's next version is N+1 again.
  const aliceMove = { ...serverRoom, version: N + 1, currentTurnSlot: 1, turnNumber: serverRoom.turnNumber + 1,
    lastMove: { type: 'pass', slot: 0, ts: 5_000_002, passReason: 'pass' }, _passCount: 1 };
  await db.ref('rooms/room').set(aliceMove);
  await tick(8);

  assert.equal(bob.state.currentTurnSlot, 1, "Bob must see Alice's move and know it is his turn");
  assert.equal(bob.state.turnNumber, aliceMove.turnNumber);
  // And Bob can act on it: his commit must target the real version.
  bob.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } });
  await tick(8);
  const after = await readRoom(db, 'room');
  assert.equal(after.version, N + 2, "Bob's pass commits on top of Alice's real move");
  assert.equal(after.currentTurnSlot, 0);
});

test.after(() => { console.info = _origInfo; });
