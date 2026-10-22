// Regression test for a client rolling itself back a turn after the server had
// already acknowledged its own write. Found by the live soak agents (Oct 2026
// regression run, soak3 g9, signature desync-currentTurnSlot, random-async
// with a poor-network player).
//
// On a slow downlink the room snapshot for our own earlier write (version N)
// can reach the watcher AFTER the server acknowledged a later write of ours
// (N+1) and the cursor moved to N+1. The watcher's "version went backwards"
// branch took that late delivery for a REVERTED optimistic write: it moved
// the cursors back to N and forced a resync — and when that read was stale
// too, the client sat on the previous turn (thinking it was still its move)
// while the server had moved on. A version the server acknowledged can never
// be reverted, so anything older than it is a late delivery: ignore it.

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

// Wrap the mock db so the test controls the room's downlink: watcher
// deliveries can be held and replayed, an arbitrary (late) snapshot can be
// pushed to the watcher, and reads can be made to answer with a stale room.
function makeSlowLinkDb(db) {
  const handlers = [];
  let staleRead = null;
  const wrapped = new Proxy(db, {
    get(target, prop) {
      if (prop !== 'ref') return Reflect.get(target, prop);
      return (path) => {
        const ref = target.ref(path);
        if (path !== 'rooms/room') return ref;
        return new Proxy(ref, {
          get(r, p) {
            if (p === 'on') {
              return (ev, h, ...rest) => { handlers.push(h); return r.on(ev, h, ...rest); };
            }
            if ((p === 'get' || p === 'once') && staleRead) {
              const value = staleRead;
              return async () => ({ val: () => value, exists: () => true });
            }
            const v = Reflect.get(r, p);
            return typeof v === 'function' ? v.bind(r) : v;
          },
        });
      };
    },
  });
  return {
    db: wrapped,
    deliver(room) { for (const h of handlers) h({ val: () => room, exists: () => room != null }); },
    setStaleRead(room) { staleRead = room; },
  };
}

test('a late snapshot older than our acknowledged write does not roll the client back', async () => {
  bus._reset();
  const base = makeMockDb();
  const link = makeSlowLinkDb(base);
  const engineState = createInitialState({ mode: 'friend-live', tileBagSeed: 'stale-after-ack', players: PLAYERS, settings: {}, startingSlot: 0 });
  await createRoom(base, { roomId: 'room', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });
  await base.ref('rooms/room').update({ status: 'playing' });
  const room = await readRoom(base, 'room');
  const alice = await createOnlineGameSession({ bus, db: link.db, room, mySlot: 0 });
  alice.start();
  await tick();
  const before = await readRoom(base, 'room');
  const N = before.version;
  assert.equal(before.currentTurnSlot, 0, "Alice's turn");

  const resyncs = [];
  bus.on(EV.TURN_CHANGED, (p) => { if (String(p?.reason ?? '').startsWith('force-resync')) resyncs.push(p.reason); });

  // Alice passes; the server acknowledges version N+1.
  alice.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } });
  await tick(8);
  const acked = await readRoom(base, 'room');
  assert.equal(acked.version, N + 1);
  assert.equal(alice.state.currentTurnSlot, 1);

  // The slow downlink now hands the watcher the OLD room (version N), and a
  // resync read would be just as far behind.
  link.setStaleRead(before);
  link.deliver(before);
  await tick(12);
  link.setStaleRead(null);

  assert.deepEqual(resyncs, [], 'a late delivery is not a reverted write — no forced resync');
  assert.equal(alice.state.currentTurnSlot, 1, "Alice stays on Bob's turn");
  assert.equal(alice.state.turnNumber, acked.turnNumber);

  // Bob's real move (N+2) still reaches Alice, and her next commit lands on it.
  const bobMove = { ...acked, version: N + 2, currentTurnSlot: 0, turnNumber: acked.turnNumber + 1,
    lastMove: { type: 'pass', slot: 1, ts: 9_000_001, passReason: 'pass' } };
  await base.ref('rooms/room').set(bobMove);
  await tick(8);
  assert.equal(alice.state.currentTurnSlot, 0, "Alice sees Bob's move");
  alice.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } });
  await tick(8);
  const after = await readRoom(base, 'room');
  assert.equal(after.version, N + 3, "Alice's next commit builds on Bob's move");
  assert.equal(after.currentTurnSlot, 1);
});

test.after(() => { console.info = _origInfo; });
