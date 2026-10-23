// Regression test: two different terminal statuses racing must settle on the
// one the server kept. Found by the live soak agents (Oct 2026 regression run,
// signatures end-status-mismatch / end-desync-status, random-live g21).
//
// Bob's own turn timer ran out on the 4th scoreless turn, so his engine ended
// the game 'completed' and wrote that status. At the same moment Alice's
// watchdog forfeited him: the server kept 'abandoned' and the rules rejected
// Bob's write — but the SDK had already raised it locally. Bob's listener saw
// 'abandoned', then his own refused 'completed' again, and copied that back:
// Bob ended on 'completed' while the room said 'abandoned'.

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
const SETTINGS = { timelimit: true, botTime: 20 };
const _origInfo = console.info;
console.info = () => {};
async function tick(n = 4) { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); }

// The mock has no rules: `rejectStatus` models the server refusing Bob's
// status write (the room was already finished there) — and capture the session's room handler so a
// locally-raised (later refused) snapshot can be delivered to it.
function wrapDb(base) {
  const h = { roomHandler: null, rejectStatus: false, rejectedStatusWrites: 0 };
  h.db = new Proxy(base, {
    get(target, prop) {
      if (prop !== 'ref') return Reflect.get(target, prop);
      return (path) => new Proxy(target.ref(path), {
        get(r, p) {
          const v = Reflect.get(r, p);
          if (p === 'on') {
            return (type, handler, ...rest) => { if (path === 'rooms/room') h.roomHandler = handler; return v.call(r, type, handler, ...rest); };
          }
          if (p === 'update' && path === 'rooms/room') {
            return async (patch) => {
              if ('status' in patch && h.rejectStatus) {
                h.rejectedStatusWrites++;
                throw new Error('PERMISSION_DENIED');
              }
              return v.call(r, patch);
            };
          }
          return typeof v === 'function' ? v.bind(r) : v;
        },
      });
    },
  });
  return h;
}

test("a refused terminal status raised locally does not override the server's", async () => {
  bus._reset();
  const base = makeMockDb();
  const engineState = createInitialState({ mode: 'random-live', tileBagSeed: 'term-conflict', players: PLAYERS, settings: SETTINGS, startingSlot: 1 });
  await createRoom(base, { roomId: 'room', mode: 'random-live', players: PLAYERS, settings: SETTINGS, engineState, serverTimestamp: 1000 });
  await base.ref('rooms/room').update({ status: 'playing' });
  const h = wrapDb(base);
  const bob = await createOnlineGameSession({ bus, db: h.db, room: await readRoom(base, 'room'), mySlot: 1 });
  bob.start();
  await tick();
  const completed = [];
  bus.on(EV.GAME_COMPLETED, (p) => completed.push(p.status));

  // Bob's engine ends the game itself; his status write loses the race.
  h.rejectStatus = true;
  bob.state.status = 'completed';
  bus.emit(EV.GAME_COMPLETED, { status: 'completed', winnerSlot: null, scores: { ...bob.state.scores } });
  await tick(4);
  assert.equal(h.rejectedStatusWrites, 1);
  // Alice's watchdog forfeit is what the server kept (version bump).
  const v = (await readRoom(base, 'room')).version;
  await base.ref('rooms/room').update({ version: v + 1, status: 'abandoned', abandonedBy: 1, abandonReason: 'missed-turns', turnDeadlineMs: 0 });
  const serverFinal = await readRoom(base, 'room');
  await tick(12);
  assert.equal(bob.state.status, 'abandoned', "Bob adopts the server's forfeit");

  // Bob's own refused write, raised locally, reaches his listener late.
  h.roomHandler({ val: () => ({ ...serverFinal, status: 'completed', abandonedBy: null, abandonReason: null }), exists: () => true });
  await tick(12);

  const server = await readRoom(base, 'room');
  assert.equal(server.status, 'abandoned');
  assert.equal(bob.state.status, 'abandoned', 'Bob stays on the status the server kept');
  assert.equal(completed[completed.length - 1], 'abandoned');
  assert.equal(completed.filter(s => s === 'completed').length, 1, "the refused 'completed' is not announced again");
});

test.after(() => { console.info = _origInfo; });
