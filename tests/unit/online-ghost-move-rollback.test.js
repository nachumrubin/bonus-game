// Regression test for the ghost-move bug surfaced by the simulator's
// e2e forced-deadline-loss scenario.
//
// Before the fix, onlineGameSession's SYNC_REJECTED path (commit failed
// because version was stale OR because Firebase rules rejected the write)
// just emitted an event and waited for the next watchRoom snapshot — which
// often never came (the room was already at its latest version). The local
// engine had optimistically applied the move (state.board with new tiles,
// state.scores bumped, state.racks shortened), but the server never
// recorded it. The active player saw their word on the board; the opponent
// and server did not.
//
// The fix is `forceResync()` in onlineGameSession: every SYNC_REJECTED
// site re-reads the authoritative room and rebuilds the engine state via
// engineStateFromRoom, wiping any optimistic mutation.
//
// This test reproduces the bug class against mockFirebase by stubbing the
// first .transaction() call to return committed:false (simulating "watchdog
// claimed first, my commit lost the version race"). It then asserts the
// session has no ghost tiles after the failure.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let modulesPromise;
function loadModules() {
  modulesPromise ??= (async () => {
    const [bus, cmds, evts, engine, dict, mock, roomSvc, sessionMod] = await Promise.all([
      import('../../src/events/bus.js'),
      import('../../src/events/commands.js'),
      import('../../src/events/eventTypes.js'),
      import('../../src/game/core/gameEngine.js'),
      import('../../src/game/core/hebrewDictionary.js'),
      import('../../src/game/online/mockFirebase.js'),
      import('../../src/game/online/roomService.js'),
      import('../../src/game/sessions/onlineGameSession.js'),
    ]);
    if (!globalThis.__GHOST_MOVE_DICT_LOADED__) {
      dict.addWordsFromText(fs.readFileSync(
        path.join(__dirname, '..', '..', 'data', 'dictionary.base.txt'), 'utf8',
      ));
      globalThis.__GHOST_MOVE_DICT_LOADED__ = true;
    }
    return {
      bus, CMD: cmds.CMD,
      createInitialState: engine.createInitialState,
      makeMockDb: mock.makeMockDb,
      createRoom: roomSvc.createRoom,
      readRoom: roomSvc.readRoom,
      createOnlineGameSession: sessionMod.createOnlineGameSession,
    };
  })();
  return modulesPromise;
}

const PLAYERS = {
  0: { uid: 'alice', displayName: 'Alice', joinedAt: 1 },
  1: { uid: 'bob',   displayName: 'Bob',   joinedAt: 2 },
};

// Suppress engine info logs.
const _origInfo = console.info;
console.info = () => {};

test('ghost-move rollback: failed commit does not leave optimistic tiles on the local board', async () => {
  const {
    bus, CMD, createInitialState, makeMockDb, createRoom, readRoom, createOnlineGameSession,
  } = await loadModules();
  bus._reset();

  const db = makeMockDb();
  const engineState = createInitialState({
    mode: 'friend-live', tileBagSeed: 'ghost-move-test',
    players: PLAYERS, settings: {},
  });
  // Deterministic alice rack — 'אב' is in the dict so the placement is valid.
  engineState.racks = {
    0: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'],
    1: ['ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע'],
  };
  await createRoom(db, {
    roomId: 'room', mode: 'friend-live',
    players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000,
  });
  await db.ref('rooms/room').update({ status: 'playing' });

  const room = await readRoom(db, 'room');
  const sess = await createOnlineGameSession({ bus, db, room, mySlot: 0 });
  sess.start();

  // Force the NEXT .transaction() call (alice's commit) to return
  // committed:false (simulating "watchdog claimed first, our commit lost the
  // version race"). mockFirebase's db.ref returns a fresh ref each call, so
  // we wrap db.ref to intercept the transaction method on every ref returned
  // for /rooms/room. After one consumed fail, subsequent transactions fall
  // through normally so forceResync's readRoom + downstream still work.
  let pendingFails = 1;
  const realRef = db.ref.bind(db);
  db.ref = (p) => {
    const ref = realRef(p);
    if (p === 'rooms/room' && typeof ref.transaction === 'function') {
      const realTx = ref.transaction.bind(ref);
      ref.transaction = (updateFn) => {
        if (pendingFails > 0) {
          pendingFails--;
          return Promise.resolve({ committed: false, snapshot: null });
        }
        return realTx(updateFn);
      };
    }
    return ref;
  };

  // Alice places "אב" — engine validates + applies optimistically.
  sess.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1, isJoker: false },
        { r: 4, c: 5, letter: 'ב', val: 3, isJoker: false },
      ],
      swappedTiles: [],
    },
  });

  // Let the failed commit + forceResync settle.
  await new Promise(r => setTimeout(r, 30));

  // Authoritative server has NO tiles at those positions (the commit was
  // stubbed to fail; the room hasn't been mutated).
  const finalRoom = await readRoom(db, 'room');
  const sBoard = finalRoom.board ?? {};
  const at44 = Array.isArray(sBoard) ? sBoard[44] : sBoard['44'];
  const at45 = Array.isArray(sBoard) ? sBoard[45] : sBoard['45'];
  assert.equal(at44 ?? null, null, 'server must not have alice\'s tile at (4,4)');
  assert.equal(at45 ?? null, null, 'server must not have alice\'s tile at (4,5)');

  // The bug: alice's local board would still show her tiles even though
  // the commit failed. forceResync wipes them.
  assert.equal(sess.state.board[4][4], null,
    'alice\'s local board must NOT have a ghost tile at (4,4) after failed commit');
  assert.equal(sess.state.board[4][5], null,
    'alice\'s local board must NOT have a ghost tile at (4,5) after failed commit');
  // Her rack should also be restored — applyMove had removed 'א' and 'ב'.
  assert.ok(sess.state.racks[0].includes('א'), 'alice\'s rack must have א back after rollback');
  assert.ok(sess.state.racks[0].includes('ב'), 'alice\'s rack must have ב back after rollback');
});

test.after(() => { console.info = _origInfo; });
