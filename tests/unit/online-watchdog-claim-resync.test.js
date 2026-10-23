// Regression test: the client whose watchdog claims the opponent's timeout
// must end up on the claimed state. Found by the live soak agents (Oct 2026
// regression run): the claiming client's session never applied its own claim —
// once it stayed a turn behind (desync-currentTurnSlot, until the next
// snapshot), once the claim forfeited the game and the claimer was left on a
// live board (end-status-mismatch / end-no-game-completed). The delivery loss
// itself did not reproduce outside the soak, so the watchdog now tells its
// owner about every claim it committed and the session re-reads the room.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../src/events/bus.js';
import { EV } from '../../src/events/eventTypes.js';
import { makeMockDb } from '../../src/game/online/mockFirebase.js';
import { createRoom, readRoom } from '../../src/game/online/roomService.js';
import { createInitialState } from '../../src/game/core/gameEngine.js';
import { createOnlineGameSession } from '../../src/game/sessions/onlineGameSession.js';
import { createTimeoutWatchdog } from '../../src/game/online/timeoutWatchdog.js';

const PLAYERS = {
  0: { uid: 'alice', displayName: 'Alice', avatar: null, joinedAt: 1 },
  1: { uid: 'bob',   displayName: 'Bob',   avatar: null, joinedAt: 2 },
};
const SETTINGS = { timelimit: true, botTime: 60 };
const _origInfo = console.info;
console.info = () => {};
async function tick(n = 4) { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); }

// The session's room listener never sees snapshots while `deaf` is set — the
// claim's own snapshot is lost, as in the soak.
function makeDeafListenerDb(db) {
  let deaf = false;
  const wrapped = new Proxy(db, {
    get(target, prop) {
      if (prop !== 'ref') return Reflect.get(target, prop);
      return (path) => {
        const ref = target.ref(path);
        return new Proxy(ref, {
          get(r, p) {
            const v = Reflect.get(r, p);
            if (p !== 'on') return typeof v === 'function' ? v.bind(r) : v;
            return (type, handler, ...rest) => v.call(r, type, (snap, prev) => { if (!deaf) handler(snap, prev); }, ...rest);
          },
        });
      };
    },
  });
  return { db: wrapped, setDeaf(x) { deaf = x; } };
}

async function setup(missedByBob) {
  bus._reset();
  const base = makeMockDb();
  const engineState = createInitialState({ mode: 'friend-live', tileBagSeed: 'wd-resync', players: PLAYERS, settings: SETTINGS, startingSlot: 1 });
  await createRoom(base, { roomId: 'room', mode: 'friend-live', players: PLAYERS, settings: SETTINGS, engineState, serverTimestamp: 1000 });
  await base.ref('rooms/room').update({ status: 'playing', missedTurns: { 0: 0, 1: missedByBob }, turnDeadlineMs: Date.now() - 10_000 });
  const h = makeDeafListenerDb(base);
  const alice = await createOnlineGameSession({ bus, db: h.db, room: await readRoom(base, 'room'), mySlot: 0 });
  alice.start();
  await tick();
  const watchdog = createTimeoutWatchdog({
    db: base, roomId: 'room', mySlot: 0, limitMs: 60_000, now: () => Date.now(), setIntervalFn: null,
    onClaimed: () => { alice.resync('watchdog-claim'); },
  });
  return { base, h, alice, watchdog };
}

test("the claimer lands on its own watchdog claim even if the claim's snapshot never reaches it", async () => {
  const { base, h, alice, watchdog } = await setup(0);
  assert.equal(alice.state.currentTurnSlot, 1);
  h.setDeaf(true);
  const res = await watchdog.tick();
  h.setDeaf(false);
  await tick(12);
  assert.equal(res.committed, true);
  const server = await readRoom(base, 'room');
  assert.equal(server.currentTurnSlot, 0, "Bob's turn was claimed");
  assert.equal(alice.state.currentTurnSlot, 0, 'Alice knows it is her turn now');
  assert.equal(alice.state.turnNumber, server.turnNumber);
});

test('a watchdog claim that forfeits the game ends it on the claimer too', async () => {
  const { base, h, alice, watchdog } = await setup(1);
  const completed = [];
  bus.on(EV.GAME_COMPLETED, (p) => completed.push(p));
  h.setDeaf(true);
  await watchdog.tick();
  h.setDeaf(false);
  await tick(12);
  const server = await readRoom(base, 'room');
  assert.equal(server.status, 'abandoned');
  assert.equal(alice.state.status, 'abandoned');
  assert.equal(completed.length, 1, 'GAME_COMPLETED fired on the claiming client');
  assert.equal(completed[0].abandonedBy, 1);
});

test.after(() => { console.info = _origInfo; });

// Root cause (all four soak cases): right after the claimer's own move, a
// delayed OLDER snapshot reached its watcher. The "version went backwards"
// branch reset lastSeenMoveTs to that snapshot's move (the opponent's) and
// forceResync never restored it. The claim preserves lastMove — the claimer's
// own move — so it looked like "a new move of mine" and was skipped as the
// echo of our own commit.
test("a stale delivery after our own move does not make the next watchdog claim look like our echo", async () => {
  bus._reset();
  const base = makeMockDb();
  const engineState = createInitialState({ mode: 'friend-live', tileBagSeed: 'wd-echo', players: PLAYERS, settings: SETTINGS, startingSlot: 1 });
  await createRoom(base, { roomId: 'room', mode: 'friend-live', players: PLAYERS, settings: SETTINGS, engineState, serverTimestamp: 1000 });
  await base.ref('rooms/room').update({ status: 'playing', lastMove: { slot: 1, type: 'pass', ts: 5_000_001 } });
  // Capture the session's room handler so a stale snapshot can be delivered
  // to it alone (a late delivery from the latency queue).
  let roomHandler = null;
  const db = new Proxy(base, {
    get(target, prop) {
      if (prop !== 'ref') return Reflect.get(target, prop);
      return (path) => new Proxy(target.ref(path), {
        get(r, p) {
          const v = Reflect.get(r, p);
          if (p !== 'on') return typeof v === 'function' ? v.bind(r) : v;
          return (type, handler, ...rest) => { if (path === 'rooms/room') roomHandler = handler; return v.call(r, type, handler, ...rest); };
        },
      });
    },
  });
  // Bob's move hands the turn to Alice.
  const before = await readRoom(base, 'room');
  const alice = await createOnlineGameSession({ bus, db, room: before, mySlot: 0 });
  alice.start();
  await tick();
  await base.ref('rooms/room').update({ version: before.version + 1, currentTurnSlot: 0, turnNumber: 2,
    lastMove: { slot: 1, type: 'pass', ts: 5_000_002 }, turnDeadlineMs: Date.now() + 60_000 });
  await tick(8);
  const stale = await readRoom(base, 'room');
  assert.equal(alice.state.currentTurnSlot, 0);

  // Alice moves (a pass keeps the fixture small) and the commit lands.
  alice.dispatch({ type: 'cmd/PASS_TURN', payload: { reason: 'pass' } });
  await tick(16);
  const afterMove = await readRoom(base, 'room');
  assert.equal(afterMove.lastMove.slot, 0);
  assert.equal(alice.state.currentTurnSlot, 1);

  // The stale (pre-move) snapshot is delivered late → realign + resync.
  roomHandler({ val: () => stale, exists: () => true });
  await tick(16);
  assert.equal(alice.state.currentTurnSlot, 1, 'resync put Alice back on the server state');

  // Bob never moves; Alice's watchdog claims his timeout.
  await base.ref('rooms/room').update({ turnDeadlineMs: Date.now() - 10_000 });
  await tick(8);
  const watchdog = createTimeoutWatchdog({ db: base, roomId: 'room', mySlot: 0, limitMs: 60_000, now: () => Date.now(), setIntervalFn: null });
  const res = await watchdog.tick();
  await tick(12);
  assert.equal(res.committed, true);
  const server = await readRoom(base, 'room');
  assert.equal(server.currentTurnSlot, 0);
  assert.equal(alice.state.currentTurnSlot, 0, "Alice applied her own claim instead of discarding it as an echo");
  assert.equal(alice.state.turnNumber, server.turnNumber);
});

// Soak g16 (random-live): our own commit's echo usually arrives after the
// commit result advanced the cursor, so it bails on the version check without
// recording our move. A watchdog claim that preserves that move then looked
// like a new own move and was skipped as an echo.
test('after our own commit, a watchdog claim preserving our move is applied, not taken for our echo', async () => {
  bus._reset();
  const base = makeMockDb();
  const engineState = createInitialState({ mode: 'friend-live', tileBagSeed: 'wd-own-echo', players: PLAYERS, settings: SETTINGS, startingSlot: 0 });
  await createRoom(base, { roomId: 'room', mode: 'friend-live', players: PLAYERS, settings: SETTINGS, engineState, serverTimestamp: 1000 });
  await base.ref('rooms/room').update({ status: 'playing', lastMove: { slot: 1, type: 'pass', ts: 6_000_001 }, turnDeadlineMs: Date.now() + 60_000 });
  const h = makeDeafListenerDb(base);
  const alice = await createOnlineGameSession({ bus, db: h.db, room: await readRoom(base, 'room'), mySlot: 0 });
  alice.start();
  await tick();

  // Alice passes; the echo of her commit is never applied by the watcher.
  h.setDeaf(true);
  alice.dispatch({ type: 'cmd/PASS_TURN', payload: { reason: 'pass' } });
  await tick(16);
  h.setDeaf(false);
  assert.equal((await readRoom(base, 'room')).lastMove.slot, 0);
  assert.equal(alice.state.currentTurnSlot, 1);

  // Bob times out; Alice's watchdog claims (no onClaimed hook).
  await base.ref('rooms/room').update({ turnDeadlineMs: Date.now() - 10_000 });
  await tick(8);
  const watchdog = createTimeoutWatchdog({ db: base, roomId: 'room', mySlot: 0, limitMs: 60_000, now: () => Date.now(), setIntervalFn: null });
  const res = await watchdog.tick();
  await tick(12);
  assert.equal(res.committed, true);
  const server = await readRoom(base, 'room');
  assert.equal(alice.state.currentTurnSlot, server.currentTurnSlot);
  assert.equal(alice.state.turnNumber, server.turnNumber);
});

test("the watchdog's claim is not raised locally before the server accepts it", async () => {
  const base = makeMockDb();
  const engineState = createInitialState({ mode: 'friend-live', tileBagSeed: 'wd-local', players: PLAYERS, settings: SETTINGS, startingSlot: 1 });
  await createRoom(base, { roomId: 'room', mode: 'friend-live', players: PLAYERS, settings: SETTINGS, engineState, serverTimestamp: 1000 });
  await base.ref('rooms/room').update({ status: 'playing', turnDeadlineMs: Date.now() - 10_000 });
  const calls = [];
  const db = new Proxy(base, {
    get(target, prop) {
      if (prop !== 'ref') return Reflect.get(target, prop);
      return (path) => {
        const ref = target.ref(path);
        return new Proxy(ref, {
          get(r, p) {
            const v = Reflect.get(r, p);
            if (p !== 'transaction') return typeof v === 'function' ? v.bind(r) : v;
            return (...args) => { calls.push(args); return v.apply(r, args); };
          },
        });
      };
    },
  });
  const watchdog = createTimeoutWatchdog({ db, roomId: 'room', mySlot: 0, limitMs: 60_000, now: () => Date.now(), setIntervalFn: null });
  const res = await watchdog.tick();
  assert.equal(res.committed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], false, 'transaction(update, onComplete, applyLocally=false)');
});
