// Regression test: a bonus-square move whose finalize commit fails must not
// leave the game stuck. Found by the live soak agents (Oct 2026 regression
// run, signature stuck-turn, untimed random-async / friend-async games).
//
// A bonus-square move is two writes — the deferred commit (tiles, turn stays)
// and the finalize (score + turn rotation) sent once the award card is
// acknowledged. When the finalize write failed, the session rolled back and
// resynced: the server still held the deferred move on our turn, but the award
// had already been acknowledged, so nothing ever dispatched the finalize again.
// No watchdog runs in an untimed game, so the turn never moved on.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../src/events/bus.js';
import { CMD } from '../../src/events/commands.js';
import * as dict from '../../src/game/core/hebrewDictionary.js';
import * as board from '../../src/game/core/board.js';
import * as boosts from '../../src/game/boosts/index.js';
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

// Rejects the room write with the given (1-based) index once, the way a
// transient permission_denied or a dropped connection surfaces.
function failNthWrite(db, n) {
  let writes = 0;
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== 'ref') return Reflect.get(target, prop);
      return (path) => {
        const ref = target.ref(path);
        if (path !== 'rooms/room') return ref;
        return new Proxy(ref, {
          get(r, p) {
            const v = Reflect.get(r, p);
            if (p !== 'update' && p !== 'transaction') return typeof v === 'function' ? v.bind(r) : v;
            return (...args) => {
              writes++;
              if (writes === n) return Promise.reject(new Error('PERMISSION_DENIED'));
              return v.apply(r, args);
            };
          },
        });
      };
    },
  });
}

test('a failed finalize commit is re-sent while the server still holds our deferred move', async () => {
  bus._reset();
  boosts._resetAndRegister();
  dict.DICT.clear();
  dict.addWordsFromText('בא');
  const base = makeMockDb();
  const engineState = createInitialState({ mode: 'random-async', tileBagSeed: 'finalize-retry', players: PLAYERS, settings: { timelimit: false }, startingSlot: 0 });
  await createRoom(base, { roomId: 'room', mode: 'random-async', players: PLAYERS, settings: { timelimit: false }, engineState, serverTimestamp: 1000 });
  await base.ref('rooms/room').update({ status: 'playing' });
  const room = await readRoom(base, 'room');
  // Write 1 = deferred commit, write 2 = finalize (fails once).
  const alice = await createOnlineGameSession({ bus, db: failNthWrite(base, 2), room, mySlot: 0 });
  alice.start();
  await tick();
  const N = (await readRoom(base, 'room')).version;

  const st = alice.state;
  st.firstMove = false;
  st.racks[0] = ['ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  st.bonusAssignment[0] = { type: 'B2' };
  board.setCommittedTile(st, 0, 1, { letter: 'א', val: 1, isJoker: false });

  const rejected = [];
  bus.on('evt/SYNC_REJECTED', (p) => rejected.push(p));

  alice.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [{ r: -1, c: 1, letter: 'ב', val: 3 }] } });
  await tick(16);
  let server = await readRoom(base, 'room');
  assert.equal(server.lastMove?.scoringDeferred, true, 'deferred commit landed');
  assert.equal(server.currentTurnSlot, 0);

  // The player acknowledges the award card.
  alice.dispatch({ type: CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra: 0 } });
  await tick(40);

  assert.equal(rejected.length, 1, 'the first finalize write was rejected');
  server = await readRoom(base, 'room');
  assert.equal(server.lastMove?.scoringDeferred, false, 'the finalize was re-sent and landed');
  assert.equal(server.currentTurnSlot, 1, "the turn passed to Bob — the game is not stuck");
  assert.equal(server.version, N + 2);
  assert.equal(alice.state.currentTurnSlot, 1);
  assert.equal(alice.state.pendingScoreCommit ?? null, null);
  assert.equal(Number(server.scores[0]), Number(alice.state.scores[0]), 'server and client agree on the score');
  assert.ok(Number(server.scores[0]) > 0, 'the move was scored');
});

test.after(() => { console.info = _origInfo; });
