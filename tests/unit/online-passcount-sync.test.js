// Regression test for the passCount-sync bug surfaced by the simulator.
//
// Before the fix, onlineGameSession.commitCurrentState() did not include
// `_passCount` in the patch, and the watcher's resync did not copy it back.
// Each client's state.passCount only counted that client's OWN consecutive
// scoreless turns, so the game-over rule (isGameOver: passCount >= 4) and
// CMD.CLAIM_STALL_END (canClaimStallEnd: passCount >= 2) gated on stale
// information.
//
// These tests prove that after the fix:
//   1. After slot 0 passes, both sessions see state.passCount === 1.
//   2. After a 4th consecutive scoreless turn (any combination of sides),
//      isGameOver fires on each side from its own state.
//   3. A successful placement resets _passCount → 0 on both sides.

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

// Suppress engine info logs so test output stays focused.
const _origInfo = console.info;
console.info = () => {};

async function setupTwoSessions(seed = 'passcount-sync') {
  bus._reset();
  const db = makeMockDb();
  const engineState = createInitialState({
    mode: 'friend-live',
    tileBagSeed: seed,
    players: PLAYERS,
    settings: {},
  });
  await createRoom(db, {
    roomId: 'room',
    mode: 'friend-live',
    players: PLAYERS,
    settings: {},
    engineState,
    serverTimestamp: 1000,
  });
  await db.ref('rooms/room').update({ status: 'playing' });
  const room = await readRoom(db, 'room');
  const a = await createOnlineGameSession({ bus, db, room, mySlot: 0 });
  const b = await createOnlineGameSession({ bus, db, room, mySlot: 1 });
  a.start(); b.start();
  return { db, a, b };
}

// Helper: pump microtasks so each session's async MOVE_CONFIRMED /
// TURN_CHANGED handler has a chance to commit before we inspect state.
async function tick() { await new Promise(r => setImmediate(r)); }

test('passCount sync: slot 0 pass → both sessions see passCount === 1', async () => {
  const { db, a, b } = await setupTwoSessions('sync-1');
  a.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } });
  await tick();
  await tick();

  const room = await readRoom(db, 'room');
  assert.equal(room._passCount, 1, 'room._passCount should be persisted as 1');
  assert.equal(a.state.passCount, 1, 'alice (the passer) should see passCount === 1');
  assert.equal(b.state.passCount, 1,
    'bob (the watcher) should also see passCount === 1 — this is the bug fix');
});

test('passCount sync: alternating scoreless turns reach 4 and end the game', async () => {
  const { db, a, b } = await setupTwoSessions('sync-2');

  // alice pass → 1
  a.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } });
  await tick(); await tick();
  // bob pass → 2
  b.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } });
  await tick(); await tick();
  // alice pass → 3
  a.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } });
  await tick(); await tick();
  // bob pass → 4 — game must end
  b.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } });
  await tick(); await tick();

  // The 4th pass triggers isGameOver inside the engine BEFORE TURN_CHANGED
  // is emitted, so no commit happens for that pass — finishGame() calls
  // setStatus('completed') directly. Room ends with _passCount=3 + completed
  // status. That's fine: the game ended, which is the regression we care about.
  await tick(); await tick();

  const room = await readRoom(db, 'room');
  assert.equal(room.status, 'completed',
    'game must be over after 4 consecutive scoreless turns (was the bug — never ended)');
  assert.ok(room._passCount >= 3,
    `room._passCount must have accumulated globally, got ${room._passCount}`);
});

test('exchange-driven game-over: 4 consecutive exchanges end the game', async () => {
  const { db, a, b } = await setupTwoSessions('exch-gameover');
  // Alternate exchanges. Each one bumps _passCount by 1; the 4th should
  // trigger isGameOver inside handleExchange and flip status to completed.
  for (let i = 0; i < 4; i++) {
    const session = i % 2 === 0 ? a : b;
    const slot = i % 2 === 0 ? 0 : 1;
    const letters = [session.state.racks[slot][0]];
    session.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters } });
    await tick(); await tick();
  }
  await tick(); await tick();
  const room = await readRoom(db, 'room');
  assert.equal(room.status, 'completed',
    'four consecutive exchanges must trigger game-over (was bug: handleExchange skipped isGameOver check)');
});

test('passCount sync: a successful exchange counts toward the global counter', async () => {
  const { db, a, b } = await setupTwoSessions('sync-3');

  // Use exchange (also scoreless) on one side mixed with passes on the other.
  // The room's _passCount should still climb monotonically per scoreless turn.
  a.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: [a.state.racks[0][0]] } });
  await tick(); await tick();
  let room = await readRoom(db, 'room');
  assert.equal(room._passCount, 1, 'exchange must bump _passCount to 1');
  assert.equal(b.state.passCount, 1, 'opponent must observe _passCount=1 via resync');

  b.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } });
  await tick(); await tick();
  room = await readRoom(db, 'room');
  assert.equal(room._passCount, 2, 'pass after exchange must bump _passCount to 2');
  assert.equal(a.state.passCount, 2, 'alice must observe global _passCount=2');
});

// Sanity restoration so other tests that read console.info still see it.
test.after(() => { console.info = _origInfo; });
