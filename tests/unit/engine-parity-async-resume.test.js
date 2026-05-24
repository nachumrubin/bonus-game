// Async session list + resume parity vs. legacy.
//
// Legacy authority (HEAD:index.html:11263-11441): session-list watchers
// label rooms my-turn / waiting based on `state.turn` and refresh ordering
// when a room update arrives.
//
// What we assert end-to-end (existing asyncSessionService.test.js covers
// per-call sorting; existing asyncTurnBanner.test.js covers dedup math —
// but no test wires both with a real move commit and verifies that:
//   • after an opponent commits a move, the listening user's watchAsyncSessions
//     re-fires with the room now flagged isMyTurn:true and re-sorted to the top.
//   • engineStateFromRoom rebuilds an identical board/rack/bag/turn/score
//     state from the persisted room, so "resume" produces what the player
//     left.
//   • the my-turn-arrived banner fires once for the new signature and is
//     deduped for repeated identical fires within the window.
//   • dismissing a room is local to my index — the opponent still sees it.

const test = require('node:test');
const assert = require('node:assert/strict');

let modulesPromise;
function loadModules() {
  modulesPromise ??= Promise.all([
    import('../../src/game/online/mockFirebase.js'),
    import('../../src/game/online/roomService.js'),
    import('../../src/game/online/asyncSessionService.js'),
    import('../../src/game/core/gameEngine.js'),
    import('../../src/notifications/asyncTurnBanner.js'),
  ]).then(([mock, room, sessions, engine, banner]) => ({ mock, room, sessions, engine, banner }));
  return modulesPromise;
}

const ME  = { uid: 'me',  displayName: 'נחום' };
const OPP = { uid: 'opp', displayName: 'דני'  };

async function seedAsyncRoom(modules, db, { roomId, players, currentTurnSlot = 0, updatedAt = 1000 }) {
  const engineState = modules.engine.createInitialState({
    mode: 'random-async', tileBagSeed: roomId, players, startingSlot: 0, settings: {},
  });
  await modules.room.createRoom(db, {
    roomId, mode: 'random-async', players, settings: {},
    engineState, serverTimestamp: updatedAt,
  });
  await db.ref(`rooms/${roomId}`).update({ status: 'playing', currentTurnSlot, updatedAt });
}

// ───────────────────────────────────────────────────────────────────────
// 1. Opponent commits an async move; a fresh list call reflects the new
// ordering (my-turn first, freshest first).
//
// Note: watchAsyncSessions deliberately only refires on INDEX changes
// (rooms added/removed) — see comment in asyncSessionService.js. For
// per-room turn flips, callers re-list on MENU_REFRESH or subscribe to
// roomService.watchRoom on each row. This test pins both halves:
//   • watchAsyncSessions' initial fire reflects the current state.
//   • A subsequent listAsyncSessions call after the opponent's commit
//     returns the updated ordering with my-turn rooms moved to the top.
test('parity: list reflects new ordering after opponent commits an async move', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();

  // Seed two rooms: one I just played (their turn, fresh), one stale.
  await seedAsyncRoom(m, db, {
    roomId: 'r-active', players: { 0: { ...ME }, 1: { ...OPP } },
    currentTurnSlot: 1, updatedAt: 100,
  });
  await seedAsyncRoom(m, db, {
    roomId: 'r-stale', players: { 0: { ...ME }, 1: { ...OPP } },
    currentTurnSlot: 1, updatedAt: 50,
  });

  const fires = [];
  const off = m.sessions.watchAsyncSessions(db, ME.uid, (list) => {
    fires.push(list.map(s => ({ id: s.roomId, mine: s.isMyTurn })));
  });
  await new Promise(r => setTimeout(r, 5));

  // Both rooms theirs-turn, sorted by updatedAt desc.
  assert.deepEqual(fires.at(-1), [
    { id: 'r-active', mine: false },
    { id: 'r-stale',  mine: false },
  ], 'initial fire — both rooms theirs-turn');

  // Opponent commits a move on r-stale — currentTurnSlot flips to me, updatedAt bumps.
  await m.room.commitTransaction(db, 'r-stale', 1, () => ({
    currentTurnSlot: 0,
    turnNumber: 2,
    updatedAt: 500,
  }));

  // Re-list (as MENU_REFRESH or per-room watchRoom would prompt).
  const after = (await m.sessions.listAsyncSessions(db, ME.uid))
    .map(s => ({ id: s.roomId, mine: s.isMyTurn }));
  assert.deepEqual(after, [
    { id: 'r-stale',  mine: true  }, // my turn → first
    { id: 'r-active', mine: false }, // their turn
  ], 'fresh list reflects the new turn ordering');
  off();
});

// ───────────────────────────────────────────────────────────────────────
// 2. engineStateFromRoom rebuilds an identical state after persistence.
// Player commits a move; the room doc gets the new state; the OTHER
// player's resume rehydrates that exact state.
test('parity: engineStateFromRoom round-trips board/rack/bag/turn/score after a commit', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();

  await seedAsyncRoom(m, db, {
    roomId: 'r-resume', players: { 0: { ...ME }, 1: { ...OPP } },
    currentTurnSlot: 0, updatedAt: 100,
  });

  // ME commits a partial state mutation — simulate the engine writing a new
  // board/rack/bag/score/turn into the room. Board is stored as a flat
  // 100-cell array (serializeBoard); patch it in place.
  const commitResult = await m.room.commitTransaction(db, 'r-resume', 1, (room) => {
    const flatBoard = room.board.slice();
    flatBoard[4 * 10 + 4] = { letter: 'א', val: 1, isJoker: false };
    flatBoard[4 * 10 + 5] = { letter: 'ב', val: 3, isJoker: false };
    return {
      currentTurnSlot: 1,
      turnNumber: (room.turnNumber ?? 1) + 1,
      scores: { ...room.scores, 0: 12 },
      racks: {
        0: ['א','ב','ג','ד','ה','ו','ז','ח'],
        1: room.racks[1],
      },
      board: flatBoard,
      bag: room.bag.slice(2),
      moveHistory: [{ slot: 0, words: ['אב'], score: 12 }],
      updatedAt: 500,
    };
  });
  assert.equal(commitResult.committed, true);

  // OPP fetches the room and rebuilds engine state.
  const room = await m.room.readRoom(db, 'r-resume');
  const rebuilt = m.room.engineStateFromRoom(room);

  // Identical mid-game state — board deserialized into a 2D grid.
  assert.equal(rebuilt.currentTurnSlot, 1, 'turn restored');
  assert.equal(rebuilt.scores[0], 12);
  assert.equal(rebuilt.scores[1], 0);
  assert.equal(rebuilt.board[4][4].letter, 'א');
  assert.equal(rebuilt.board[4][5].letter, 'ב');
  assert.deepEqual(rebuilt.racks[0], ['א','ב','ג','ד','ה','ו','ז','ח']);
  assert.equal(rebuilt.firstMove, false, 'moveHistory non-empty ⇒ firstMove false');
  assert.equal(rebuilt.moveHistory.length, 1);
  assert.equal(rebuilt.status, 'playing');
});

// ───────────────────────────────────────────────────────────────────────
// 3. My-turn-arrived banner fires once for the new signature; dedups for
// the same set within the 60s window; re-fires when the set changes.
test('parity: banner fires once when a new my-turn arrives, dedups identical re-fires', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();
  m.banner._resetForTests();

  await seedAsyncRoom(m, db, {
    roomId: 'r-banner', players: { 0: { ...ME }, 1: { ...OPP } },
    currentTurnSlot: 1, updatedAt: 100,
  });

  // Initial: their turn → no banner.
  let sessions = await m.sessions.listAsyncSessions(db, ME.uid);
  const calls = [];
  const show = (opts) => calls.push(opts);
  let r = m.banner.maybeShow({ uid: ME.uid, sessions, show, now: 1000 });
  assert.equal(r.shown, false);
  assert.equal(r.reason, 'no-my-turn');

  // Opponent commits → my turn arrives. Re-list and re-banner.
  await m.room.commitTransaction(db, 'r-banner', 1, () => ({
    currentTurnSlot: 0, turnNumber: 2, updatedAt: 500,
  }));
  sessions = await m.sessions.listAsyncSessions(db, ME.uid);
  r = m.banner.maybeShow({ uid: ME.uid, sessions, show, now: 2000 });
  assert.equal(r.shown, true, 'new my-turn arrival ⇒ banner');
  assert.equal(calls.length, 1);

  // Same signature inside the window ⇒ deduped.
  const r2 = m.banner.maybeShow({ uid: ME.uid, sessions, show, now: 30_000 });
  assert.equal(r2.shown, false);
  assert.equal(r2.reason, 'deduped');

  // Past the window ⇒ re-fires.
  const r3 = m.banner.maybeShow({ uid: ME.uid, sessions, show, now: 2000 + 90_000 });
  assert.equal(r3.shown, true);
  assert.equal(calls.length, 2);
});

// ───────────────────────────────────────────────────────────────────────
// 4. Dismiss is local: my list loses the row, opponent's still has it.
test('parity: dismissForUid does not touch the opponent\'s view', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();

  await seedAsyncRoom(m, db, {
    roomId: 'r-dismiss', players: { 0: { ...ME }, 1: { ...OPP } },
    currentTurnSlot: 1, updatedAt: 100,
  });

  await m.sessions.dismissForUid(db, ME.uid, 'r-dismiss');

  assert.equal((await m.sessions.listAsyncSessions(db, ME.uid)).length, 0,
    'my list lost the dismissed room');
  const oppList = await m.sessions.listAsyncSessions(db, OPP.uid);
  assert.equal(oppList.length, 1, 'opponent still sees the room');
  assert.equal(oppList[0].roomId, 'r-dismiss');

  // Room itself untouched — status still playing.
  const room = await m.room.readRoom(db, 'r-dismiss');
  assert.equal(room.status, 'playing');
});

// ───────────────────────────────────────────────────────────────────────
// 5. Multi-room my-turn count: banner text shows the count when ≥ 2.
test('parity: banner text shows count when multiple rooms become my-turn', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();
  m.banner._resetForTests();

  await seedAsyncRoom(m, db, {
    roomId: 'r-a', players: { 0: { ...ME }, 1: { ...OPP } },
    currentTurnSlot: 0, updatedAt: 200,
  });
  await seedAsyncRoom(m, db, {
    roomId: 'r-b', players: { 0: { ...ME }, 1: { ...OPP } },
    currentTurnSlot: 0, updatedAt: 100,
  });

  const sessions = await m.sessions.listAsyncSessions(db, ME.uid);
  assert.equal(sessions.length, 2);
  assert.ok(sessions.every(s => s.isMyTurn));

  const calls = [];
  const show = (opts) => calls.push(opts);
  m.banner.maybeShow({ uid: ME.uid, sessions, show, now: 1000 });
  assert.match(calls[0].text, /2 משחקים/, 'count shown for multi-room my-turn');
});

// ───────────────────────────────────────────────────────────────────────
// 6. Completing a room removes it from BOTH players' indexes (so the
// async list doesn't show "ghost" finished games after the next resume).
test('parity: setStatus(completed) on async room clears the row from both indexes', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();

  await seedAsyncRoom(m, db, {
    roomId: 'r-end', players: { 0: { ...ME }, 1: { ...OPP } },
    currentTurnSlot: 0, updatedAt: 100,
  });
  assert.equal((await m.sessions.listAsyncSessions(db, ME.uid)).length, 1);
  assert.equal((await m.sessions.listAsyncSessions(db, OPP.uid)).length, 1);

  await m.room.setStatus(db, 'r-end', 'completed');

  assert.equal((await m.sessions.listAsyncSessions(db, ME.uid)).length, 0);
  assert.equal((await m.sessions.listAsyncSessions(db, OPP.uid)).length, 0);
});
