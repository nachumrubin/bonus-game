// End-to-end test of onlineGameSession against the mock Firebase.
// Two sessions (one per slot) play a move each and we verify both clients
// converge on the same state via the room's version-guarded transactions.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { DICT, addWordsFromText } from '../core/hebrewDictionary.js';
import { makeMockDb } from '../online/mockFirebase.js';
import { createRoom } from '../online/roomService.js';
import { createInitialState } from '../core/gameEngine.js';
import { createOnlineGameSession } from './onlineGameSession.js';
import {
  _setServerTimeOffsetForTests, _resetServerClockForTests,
} from '../online/serverClock.js';
import { _resetAndRegister as registerBoosts } from '../boosts/index.js';

const _origLog = console.log;
console.log = () => {};

const PLAYERS = {
  0: { uid: 'a', displayName: 'A', avatar: null, joinedAt: 1 },
  1: { uid: 'b', displayName: 'B', avatar: null, joinedAt: 1 },
};

async function setupRoom(db, mode = 'friend-live', settings = {}) {
  const engineState = createInitialState({
    mode, tileBagSeed: 'online-test', players: PLAYERS, settings,
  });
  // Force known racks so both clients produce the same engineState on engineStateFromRoom
  engineState.racks = {
    0: ['א','ב','ג','ד','ה','ו','ז','ח'],
    1: ['ט','י','כ','ל','מ','נ','ס','ע'],
  };
  await createRoom(db, {
    roomId: 'online-room', mode, players: PLAYERS, settings,
    engineState, serverTimestamp: 1000,
  });
  // Tests bypass the ready handshake — flip status to 'playing' directly.
  const initialDeadline = settings?.timelimit ? 1000 + Number(settings.botTime || 0) * 1000 : null;
  await db.ref('rooms/online-room').update({ status: 'playing', turnDeadlineMs: initialDeadline });
}

test('online session: local move is committed to Firebase and remote slot sees it', async () => {
  bus._reset();
  DICT.clear();
  addWordsFromText('אב\n');
  const db = makeMockDb();
  await setupRoom(db);

  // Two sessions sharing the SAME bus and SAME db (simulating two clients
  // for the purpose of this in-memory test). In production they'd be
  // separate processes; the mock fires watchers synchronously which is good
  // enough to test round-trip via Firebase semantics.
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  const moveConfirmed = [];
  bus.on(EV.MOVE_CONFIRMED, p => moveConfirmed.push(p));

  // Slot 0 plays 'אב' at (4,4)-(4,5)
  sessA.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1 },
        { r: 4, c: 5, letter: 'ב', val: 3 },
      ],
    },
  });

  // Allow microtasks to flush (commitTransaction is async)
  await new Promise(r => setTimeout(r, 0));

  assert.equal(moveConfirmed.length, 1);
  assert.equal(moveConfirmed[0].score, 4);

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.scores[0], 4);
  assert.equal(roomNow.currentTurnSlot, 1);
  assert.ok(roomNow.version > 1);

  await sessA.dispose();
});

test('online session: refuses to dispatch CONFIRM_MOVE when not your turn', async () => {
  bus._reset();
  DICT.clear();
  addWordsFromText('אב\n');
  const db = makeMockDb();
  await setupRoom(db);

  // mySlot=1 but currentTurnSlot=0 → engine sees 0; this client tries to commit anyway.
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });

  let confirmed = 0;
  bus.on(EV.MOVE_CONFIRMED, () => { confirmed++; });

  sessB.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: 4, c: 4, letter: 'א', val: 1 }] },
  });

  await new Promise(r => setTimeout(r, 0));
  assert.equal(confirmed, 0); // gated by mySlot mismatch
  await sessB.dispose();
});

test('online session: local pass is committed to Firebase', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  sessA.dispatch({ type: CMD.PASS_TURN });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.currentTurnSlot, 1);
  assert.equal(roomNow.lastMove.type, 'pass');
  assert.equal(roomNow.lastMove.slot, 0);
  assert.ok(roomNow.version > 1);
  await sessA.dispose();
});

test('online session: local resign writes terminal status and clears async indexes', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db, 'friend-async');
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  sessA.dispatch({ type: CMD.RESIGN_GAME, payload: { slot: 0 } });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.status, 'abandoned');
  assert.equal(roomNow.abandonedBy, 0);
  assert.equal(db._data.users.a.asyncRooms?.['online-room'] ?? null, null);
  assert.equal(db._data.users.b.asyncRooms?.['online-room'] ?? null, null);
  await sessA.dispose();
});

test('online session: remote terminal status is observed even without a version bump', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db, 'friend-live');
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });
  const completed = [];
  bus.on(EV.GAME_COMPLETED, p => completed.push(p));

  await db.ref('rooms/online-room').update({
    status: 'abandoned',
    abandonedBy: 0,
  });
  await new Promise(r => setTimeout(r, 0));

  assert.equal(sessB.state.status, 'abandoned');
  assert.equal(sessB.state.abandonedBy, 0);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, 'abandoned');
  assert.equal(completed[0].abandonedBy, 0);
  await sessB.dispose();
});

test('online session: turn-advancing commit rotates the shared deadline and resets missed turn count', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db, 'friend-live', { timelimit: true, botTime: 20 });
  await db.ref('rooms/online-room').update({ missedTurns: { 0: 2, 1: 0 } });
  const before = db._data.rooms['online-room'].turnDeadlineMs;
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  sessA.dispatch({ type: CMD.PASS_TURN });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.currentTurnSlot, 1);
  assert.ok(roomNow.turnDeadlineMs > before);
  assert.equal(roomNow.missedTurns[0], 0);
  await sessA.dispose();
});

test('online session: an extra-turn move gets a FRESH deadline (not the stale one it would inherit)', async () => {
  // Regression: in a timed game, an extra_turn boost keeps the turn with the
  // same player but `turnChanged` is false, so the deadline was NOT reset —
  // the player inherited their already-expired deadline and the opponent's
  // watchdog timed them out the instant the boost overlay closed. (Seen in
  // prod room mm_1781378227581_8c2yxm: B5 extra_turn, missedTurns[1]=1.)
  bus._reset();
  registerBoosts();
  DICT.clear();
  addWordsFromText('אב\n');
  const db = makeMockDb();
  await setupRoom(db, 'friend-live', { timelimit: true, botTime: 20 });
  // A nearly-expired deadline: not yet past (so the move itself is allowed),
  // but with ~no time left — exactly what the extra turn would inherit.
  const stale = Date.now() + 1500;
  await db.ref('rooms/online-room').update({ turnDeadlineMs: stale });

  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  sessA.state.turnDeadlineMs = stale;
  // Bank an extra_turn for slot 0 so the upcoming move keeps the turn.
  sessA.state.activeBoosts.push({ slot: 0, boostId: 'extra_turn', payload: {}, turnNumber: sessA.state.turnNumber });

  sessA.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: 4, c: 4, letter: 'א', val: 1 }, { r: 4, c: 5, letter: 'ב', val: 3 }] },
  });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.currentTurnSlot, 0, 'extra_turn keeps the same player on turn');
  // Without the fix the deadline stays ~`stale`; with it, a full ~20s window.
  assert.ok(roomNow.turnDeadlineMs >= Date.now() + 15_000,
    `extra-turn must get a fresh full deadline, got ${roomNow.turnDeadlineMs} (stale was ${stale})`);
  await sessA.dispose();
});

test('online session: a queued timer_bonus extends the NEXT player\'s committed deadline (and is consumed once)', async () => {
  // The committing client is authoritative for the next player's deadline.
  // When the turn rotates to a slot that banked a B13 timer_bonus, the engine's
  // applyTurnStartEffects records state.turnTimerBonusMs and rawCommitCurrentState
  // must add it on top of the base limit — then clear it (one-shot).
  bus._reset();
  registerBoosts();
  DICT.clear();
  addWordsFromText('אב\n');
  const db = makeMockDb();
  await setupRoom(db, 'friend-live', { timelimit: true, botTime: 20 });

  // A comfortably-future deadline so the move isn't gated as a late commit.
  const live = Date.now() + 15_000;
  await db.ref('rooms/online-room').update({ turnDeadlineMs: live });
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  sessA.state.turnDeadlineMs = live;
  // Bank a +10s timer_bonus for slot 1 — it fires when the turn rotates to them.
  sessA.state.activeBoosts.push({ slot: 1, boostId: 'timer_bonus', payload: { seconds: 10 }, turnNumber: sessA.state.turnNumber });

  sessA.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: 4, c: 4, letter: 'א', val: 1 }, { r: 4, c: 5, letter: 'ב', val: 3 }] },
  });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.currentTurnSlot, 1, 'turn rotates to the booster');
  // Base 20s alone could never reach now+25s; the +10s bonus must have applied.
  assert.ok(roomNow.turnDeadlineMs >= Date.now() + 25_000,
    `next deadline must include the +10s bonus, got ${roomNow.turnDeadlineMs}`);
  // One-shot: cleared after the commit resolved.
  assert.equal(Number(sessA.state.turnTimerBonusMs) || 0, 0, 'timer bonus consumed after commit');
  // And the boost itself was consumed from activeBoosts.
  assert.ok(!sessA.state.activeBoosts.some(b => b.boostId === 'timer_bonus'), 'timer_bonus boost consumed');
  await sessA.dispose();
});

test('online session: no-lastMove timeout snapshot resyncs remote turn state', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db, 'friend-live', { timelimit: true, botTime: 20 });
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });
  const turns = [];
  bus.on(EV.TURN_CHANGED, p => turns.push(p));

  await db.ref('rooms/online-room').update({
    version: 2,
    currentTurnSlot: 1,
    turnNumber: 2,
    turnDeadlineMs: 50_000,
    missedTurns: { 0: 1, 1: 0 },
    lastMove: null,
  });
  await new Promise(r => setTimeout(r, 0));

  assert.equal(sessB.state.currentTurnSlot, 1);
  assert.equal(sessB.state.turnNumber, 2);
  assert.equal(sessB.state.turnDeadlineMs, 50_000);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].currentTurnSlot, 1);
  await sessB.dispose();
});

// Two-phase commit for a bonus-square move. The FIRST commit publishes the tiles
// immediately (so the opponent can see what was played during a mini-game that
// may run 60s) but does NOT rotate the turn or award any score. The SECOND commit,
// on MOVE_SCORE_COMMITTED, adds the bonus points and rotates the turn.
test('online session: deferred bonus move publishes tiles immediately, scores + rotates only on MOVE_SCORE_COMMITTED', async () => {
  bus._reset();
  DICT.clear();
  const ALEF = '\u05d0';
  const BET = '\u05d1';
  addWordsFromText(`${BET}${ALEF}\n`);
  const db = makeMockDb();
  await setupRoom(db, 'friend-live');

  const board = new Array(100).fill(null);
  board[1] = { letter: ALEF, val: 1, isJoker: false };
  await db.ref('rooms/online-room').update({
    board,
    racks: {
      0: [BET, '\u05d2', '\u05d3', '\u05d4', '\u05d5', '\u05d6', '\u05d7', '\u05d8'],
      1: ['\u05d8', '\u05d9', '\u05db', '\u05dc', '\u05de', '\u05e0', '\u05e1', '\u05e2'],
    },
    currentTurnSlot: 0,
    firstMove: false,
    bonusAssignment: [{ type: 'B2', pts: 40, ic: '*' }],
    bonusSqUsed: {},
  });
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  sessA.state.firstMove = false;

  sessA.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [{ r: -1, c: 1, letter: BET, val: 3 }],
    },
  });
  await new Promise(r => setTimeout(r, 0));

  // Phase 1: the tiles are published right away so the opponent isn't left
  // staring at a blank board for the length of the mini-game...
  const deferredRoom = db._data.rooms['online-room'];
  assert.equal(deferredRoom.version, 2, 'deferred MOVE_CONFIRMED publishes the move');
  assert.equal(deferredRoom.bonusBoard['-1,1'].letter, BET, 'opponent can see the played tile');
  // ...but the score is withheld and the turn does NOT rotate.
  assert.equal(deferredRoom.scores[0], 0, 'score stays deferred until the bonus resolves');
  assert.equal(deferredRoom.currentTurnSlot, 0, 'turn must NOT rotate on the deferred commit');

  sessA.dispatch({ type: CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra: 20 } });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.version, 3, 'MOVE_SCORE_COMMITTED commits the final scored move exactly once');
  assert.equal(roomNow.scores[0], 24);
  assert.equal(roomNow.currentTurnSlot, 1);
  assert.equal(roomNow.lastMove.score, 24);
  assert.equal(roomNow.bonusBoard['-1,1'].letter, BET);
  assert.equal(roomNow.bonusSqUsed[0], true);
  await sessA.dispose();
});

// Regression: prod room fc_1786040881489_8bjchc. A bonus-square move whose
// PHASE-1 commit lost the version race was rolled back on the board — but
// `pendingScoreCommit` survived the rollback, so when the in-flight bonus flow
// resolved, handleFinalizeBoostAward committed `baseScore + extra` for a move
// the server never accepted. The client kept +32 the room never had, and every
// later snapshot was discarded, freezing that client on a divergent score.
test('online session: a deferred bonus commit that loses the race clears pendingScoreCommit', async () => {
  bus._reset();
  DICT.clear();
  const ALEF = 'א';
  const BET = 'ב';
  addWordsFromText(`${BET}${ALEF}\n`);
  const db = makeMockDb();
  await setupRoom(db, 'friend-live');

  const board = new Array(100).fill(null);
  board[1] = { letter: ALEF, val: 1, isJoker: false };
  await db.ref('rooms/online-room').update({
    board,
    racks: {
      0: [BET, 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'],
      1: ['ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע'],
    },
    currentTurnSlot: 0,
    firstMove: false,
    bonusAssignment: [{ type: 'B2', pts: 40, ic: '*' }],
    bonusSqUsed: {},
  });
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  sessA.state.firstMove = false;

  const aborted = [];
  bus.on('bonus/aborted', p => aborted.push(p));

  // Stale the session out without notifying it, exactly as the opponent's
  // watchdog does when it claims an expired turn: the phase-1 commit's version
  // guard will now abort.
  db._data.rooms['online-room'].version += 5;

  sessA.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: -1, c: 1, letter: BET, val: 3 }] },
  });
  await new Promise(r => setTimeout(r, 0));

  assert.equal(sessA.state.pendingScoreCommit ?? null, null,
    'the withheld base score must not survive the rollback');
  assert.equal(sessA.state.scores[0], 0, 'no points for a move the server rejected');
  assert.equal(sessA.state.currentTurnSlot, 0, 'the turn did not rotate');
  assert.equal(aborted.length, 1, 'the in-flight bonus flow was told to drop the award');

  // The engine must now be inert for this move: even if a stray finalize for the
  // rolled-back move arrives, there is no pending base score to re-commit.
  sessA.dispatch({ type: CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra: 0 } });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sessA.state.scores[0], 0, 'still no phantom base score');

  await sessA.dispose();
});

// The mirror case: phase 1 lands but the SECOND commit (score + turn rotation)
// loses the race. That handler previously had no rollback snapshot at all — it
// relied solely on forceResync, so when that read failed the bonus points and
// the rotated turn stayed in local state permanently.
test('online session: a deferred bonus phase-2 commit that loses the race rolls back score and turn', async () => {
  bus._reset();
  DICT.clear();
  const ALEF = 'א';
  const BET = 'ב';
  addWordsFromText(`${BET}${ALEF}\n`);
  const db = makeMockDb();
  await setupRoom(db, 'friend-live');

  const board = new Array(100).fill(null);
  board[1] = { letter: ALEF, val: 1, isJoker: false };
  await db.ref('rooms/online-room').update({
    board,
    racks: {
      0: [BET, 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'],
      1: ['ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע'],
    },
    currentTurnSlot: 0,
    firstMove: false,
    bonusAssignment: [{ type: 'B2', pts: 40, ic: '*' }],
    bonusSqUsed: {},
  });
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  sessA.state.firstMove = false;

  // Phase 1 succeeds.
  sessA.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: -1, c: 1, letter: BET, val: 3 }] },
  });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(db._data.rooms['online-room'].scores[0], 0, 'baseline: score still withheld');
  assert.equal(sessA.state.currentTurnSlot, 0, 'baseline: turn not yet rotated');

  const turnChanges = [];
  bus.on(EV.TURN_CHANGED, p => turnChanges.push(p));

  // Now lose the race on the SECOND commit.
  db._data.rooms['online-room'].version += 5;
  sessA.dispatch({ type: CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra: 20 } });
  await new Promise(r => setTimeout(r, 0));

  assert.ok(turnChanges.some(t => t.reason === 'commit-rollback'),
    'the phase-2 rollback ran synchronously');
  assert.equal(sessA.state.scores[0], 0, 'neither the base score nor the bonus was kept');
  assert.equal(sessA.state.currentTurnSlot, 0, 'the optimistic turn rotation was undone');

  await sessA.dispose();
});

// Regression: prod room fc_1786040881489_8bjchc. `turnDeadlineMs` is stamped by
// one device and enforced by the other. When the submitting device's clock runs
// behind, the late-commit gate compares an opponent-stamped deadline against a
// local `Date.now()` that has not reached it yet — so the gate passes, the
// engine mutates, and the commit then loses the version race to the watchdog
// that already claimed the turn. serverNow() removes the skew.
test('online session: late commit is refused even when the LOCAL clock says there is time left', async () => {
  bus._reset();
  DICT.clear();
  const ALEF = 'א';
  const BET = 'ב';
  addWordsFromText(`${BET}${ALEF}\n`);
  const db = makeMockDb();
  await setupRoom(db, 'friend-live', { timelimit: true, botTime: 40 });

  const board = new Array(100).fill(null);
  board[1] = { letter: ALEF, val: 1, isJoker: false };
  await db.ref('rooms/online-room').update({
    board,
    racks: {
      0: [BET, 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'],
      1: ['ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע'],
    },
    currentTurnSlot: 0,
    firstMove: false,
  });
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  sessA.state.firstMove = false;

  // Our clock is 5 s BEHIND the server's. The deadline (stamped in server time
  // by the opponent) is 2 s in our local future but 3 s in the server's past.
  _setServerTimeOffsetForTests(5000);
  sessA.state.turnDeadlineMs = Date.now() + 2000;

  const rejected = [];
  bus.on(EV.INVALID_MOVE_REJECTED, p => rejected.push(p));
  const versionBefore = db._data.rooms['online-room'].version;

  sessA.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: 0, c: 0, letter: BET, val: 3 }] },
  });
  await new Promise(r => setTimeout(r, 0));

  assert.ok(rejected.some(r => r.reason === 'turn-expired'),
    'the gate must fire on server time, not local time');
  assert.equal(db._data.rooms['online-room'].version, versionBefore,
    'nothing was committed');
  assert.equal(sessA.state.scores[0], 0, 'the engine never applied the move');

  _resetServerClockForTests();
  await sessA.dispose();
});

// Control for the test above: with the clocks agreeing, the identical move at
// the identical local time is accepted. Proves the gate tightened on skew only
// and did not simply start rejecting everything.
test('online session: the same move commits normally when the clocks agree', async () => {
  bus._reset();
  DICT.clear();
  const ALEF = 'א';
  const BET = 'ב';
  addWordsFromText(`${BET}${ALEF}\n`);
  const db = makeMockDb();
  await setupRoom(db, 'friend-live', { timelimit: true, botTime: 40 });

  const board = new Array(100).fill(null);
  board[1] = { letter: ALEF, val: 1, isJoker: false };
  await db.ref('rooms/online-room').update({
    board,
    racks: {
      0: [BET, 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'],
      1: ['ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע'],
    },
    currentTurnSlot: 0,
    firstMove: false,
  });
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  sessA.state.firstMove = false;

  _resetServerClockForTests(); // offset 0 — clocks agree
  sessA.state.turnDeadlineMs = Date.now() + 2000;

  const rejected = [];
  bus.on(EV.INVALID_MOVE_REJECTED, p => rejected.push(p));

  sessA.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: 0, c: 0, letter: BET, val: 3 }] },
  });
  await new Promise(r => setTimeout(r, 0));

  assert.equal(rejected.filter(r => r.reason === 'turn-expired').length, 0,
    'an in-time move is not rejected');
  assert.equal(db._data.rooms['online-room'].currentTurnSlot, 1, 'the move committed');

  await sessA.dispose();
});

// The deadline we WRITE must also be server-stamped, or we hand the opponent a
// deadline shifted by our own skew — the same bug from the other end.
test('online session: the committed deadline is stamped on the server clock', async () => {
  bus._reset();
  DICT.clear();
  const ALEF = 'א';
  const BET = 'ב';
  addWordsFromText(`${BET}${ALEF}\n`);
  const db = makeMockDb();
  await setupRoom(db, 'friend-live', { timelimit: true, botTime: 40 });

  const board = new Array(100).fill(null);
  board[1] = { letter: ALEF, val: 1, isJoker: false };
  await db.ref('rooms/online-room').update({
    board,
    racks: {
      0: [BET, 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'],
      1: ['ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע'],
    },
    currentTurnSlot: 0,
    firstMove: false,
  });
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  sessA.state.firstMove = false;

  _setServerTimeOffsetForTests(60_000); // our clock is a minute behind
  sessA.state.turnDeadlineMs = Date.now() + 120_000; // plenty of time either way

  const localBefore = Date.now();
  sessA.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: 0, c: 0, letter: BET, val: 3 }] },
  });
  await new Promise(r => setTimeout(r, 0));

  const written = Number(db._data.rooms['online-room'].turnDeadlineMs);
  // 40 s limit written on a clock 60 s ahead of ours ⇒ ~100 s past local now.
  assert.ok(written >= localBefore + 95_000,
    `deadline must be server-stamped (got ${written - localBefore}ms past local now)`);

  _resetServerClockForTests();
  await sessA.dispose();
});

test('online session: opponent score includes the multiplier and extra used by clock grace', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });
  const moves = [];
  bus.on(EV.OPPONENT_MOVED, p => moves.push(p));
  await db.ref('rooms/online-room').update({
    version: 2, currentTurnSlot: 1, turnNumber: 2,
    lastMove: { slot: 0, tiles: [], words: [], wordTiles: [], score: 30,
      baseScore: 20, bonusExtra: 10, multiplier: 2, turnNumber: 1, ts: 123 },
  });
  assert.equal(moves.length, 1);
  assert.equal(moves[0].bonusExtra, 10);
  assert.equal(moves[0].multiplier, 2);
  assert.equal(moves[0].baseScore, 20);
  await sessB.dispose();
});

test('online session: remote pass resyncs local turn state', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });
  const turns = [];
  bus.on(EV.TURN_CHANGED, p => turns.push(p));

  await db.ref('rooms/online-room').update({
    version: 2,
    currentTurnSlot: 1,
    turnNumber: 2,
    lastMove: { type: 'pass', slot: 0, turnNumber: 1, ts: 123 },
  });

  assert.equal(sessB.state.currentTurnSlot, 1);
  assert.equal(sessB.state.turnNumber, 2);
  assert.equal(turns.at(-1).currentTurnSlot, 1);
  await sessB.dispose();
});

test('online session: local exchange is committed to Firebase', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  sessA.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: ['א'] } });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.lastMove.type, 'exchange');
  assert.equal(roomNow.lastMove.slot, 0);
  assert.equal(roomNow.currentTurnSlot, 1);
  assert.ok(roomNow.version > 1);
  await sessA.dispose();
});

test('online session: local free-exchange consumes boost without advancing turn', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  await db.ref('rooms/online-room').update({
    activeBoosts: [{ slot: 0, boostId: 'free_tile_swap', payload: {}, turnNumber: 1 }],
    version: 2,
  });
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  sessA.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: ['א'], freeSwap: true } });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.lastMove.type, 'free-exchange');
  assert.equal(roomNow.lastMove.slot, 0);
  assert.equal(roomNow.currentTurnSlot, 0, 'turn must not advance on free swap');
  assert.equal(roomNow.activeBoosts.length, 0, 'boost should be consumed');
  await sessA.dispose();
});

test('online session: remote exchange resyncs local rack/turn state', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });
  const exchanges = [];
  bus.on(EV.TILES_EXCHANGED, p => exchanges.push(p));

  await db.ref('rooms/online-room').update({
    version: 2,
    currentTurnSlot: 1,
    turnNumber: 2,
    racks: { 0: ['א','ב','ג','ד','ה','ו','ז','ח'], 1: ['ט','י','כ','ל','מ','נ','ס','ע'] },
    lastMove: { type: 'exchange', slot: 0, count: 2, turnNumber: 1, ts: 123 },
  });

  assert.equal(sessB.state.currentTurnSlot, 1);
  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0].slot, 0);
  assert.equal(exchanges[0].free, false);
  await sessB.dispose();
});

test('online session: remote free-exchange does not emit TURN_CHANGED', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });
  const turns = [];
  const exchanges = [];
  bus.on(EV.TURN_CHANGED, p => turns.push(p));
  bus.on(EV.TILES_EXCHANGED, p => exchanges.push(p));

  await db.ref('rooms/online-room').update({
    version: 2,
    currentTurnSlot: 0,
    turnNumber: 1,
    racks: { 0: ['א','ב','ג','ד','ה','ו','ז','ח'], 1: ['ט','י','כ','ל','מ','נ','ס','ע'] },
    activeBoosts: [],
    lastMove: { type: 'free-exchange', slot: 0, count: 1, turnNumber: 1, ts: 123 },
  });

  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0].free, true);
  assert.equal(turns.length, 0, 'free-exchange must not emit TURN_CHANGED');
  await sessB.dispose();
});

test('online session: emits live preview updates without requiring a version bump', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  const previews = [];
  bus.on(EV.LIVE_PREVIEW_CHANGED, p => previews.push(p));

  await db.ref('rooms/online-room/livePreview').set({
    slot: 1,
    tiles: [{ r: 5, c: 5, letter: '׳˜', val: 1, isJoker: false }],
  });

  assert.equal(previews.length, 1);
  assert.equal(sessA.state.livePreview.slot, 1);
  assert.equal(previews[0].livePreview.tiles[0].letter, '׳˜');
  await sessA.dispose();
});

test('online session: applies settings updates without requiring a version bump', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  const settingsEvents = [];
  bus.on(EV.ROOM_SETTINGS_CHANGED, p => settingsEvents.push(p));

  await db.ref('rooms/online-room/settings').set({ timelimit: false, botTime: 35 });

  assert.equal(settingsEvents.length, 1);
  assert.deepEqual(sessA.state.settings, { timelimit: false, botTime: 35 });
  await sessA.dispose();
});

// A lock-only turn (CMD.PLACE_LOCK) optimistically spends a lock, drops it on
// the board, and advances the turn before the commit. If that commit loses the
// version race, the phantom lock used to sit on the board until forceResync's
// network round-trip returned (and forever if that read failed) — unlike
// CONFIRM_MOVE, which rolled back synchronously. This verifies the lock path
// now rolls back synchronously too.
test('online session: a lock commit that loses the version race rolls back synchronously', async () => {
  bus._reset();
  DICT.clear();
  addWordsFromText('אב\n');
  const db = makeMockDb();
  await setupRoom(db);
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });

  assert.equal(sessA.state.currentTurnSlot, 0, 'baseline: slot 0 to move');
  sessA.state.scores[0] = 10; // must be able to afford the 10-pt lock cost
  const inv0Before = [...sessA.state.lockInventory[0]];

  const turnChanges = [];
  bus.on(EV.TURN_CHANGED, p => turnChanges.push(p));
  const rejected = [];
  bus.on('evt/SYNC_REJECTED', p => rejected.push(p));

  // Stale the session out WITHOUT notifying it: bump the stored room version
  // directly (not via .ref().update(), which would fire the watcher and let the
  // session catch up). The lock commit's version guard now aborts.
  db._data.rooms['online-room'].version += 5;

  sessA.dispatch({ type: CMD.PLACE_LOCK, payload: { r: 7, c: 7, duration: 3 } });
  await new Promise(r => setTimeout(r, 0));

  assert.ok(rejected.length >= 1, 'a stale-version rejection fired');
  // The tell for the SYNCHRONOUS rollback (vs. forceResync cleaning up later):
  // the commit-rollback turn change, emitted only by the rollback path.
  assert.ok(turnChanges.some(t => t.reason === 'commit-rollback'),
    'the lock rollback flipped the turn back synchronously');
  // Net effect: no phantom lock, inventory restored, still slot 0 to move.
  assert.equal(sessA.state.lockedCells.length, 0, 'no phantom lock left on the board');
  assert.deepEqual(sessA.state.lockInventory[0], inv0Before, 'the spent lock is returned');
  assert.equal(sessA.state.currentTurnSlot, 0, 'the turn did not advance');

  await sessA.dispose();
});

// ── Turn-flow notices across the wire ─────────────────────────────────────
// The reported bug: the opponent wins an extra turn (or eats yours) and your
// client says nothing — the turn simply never arrives. Neither effect can be
// inferred from the snapshot, because both are granted AND consumed inside a
// single turn-end on the mover's device, so they never appear in the
// activeBoosts the victim resyncs. They have to be shipped explicitly.

test('online session: extra_turn is published on the room so the opponent can be told', async () => {
  bus._reset();
  registerBoosts();
  DICT.clear();
  addWordsFromText('אב\n');
  const db = makeMockDb();
  await setupRoom(db);
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  sessA.state.activeBoosts = [{ slot: 0, boostId: 'extra_turn', payload: {}, turnNumber: 1 }];

  sessA.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: 4, c: 4, letter: 'א', val: 1 }, { r: 4, c: 5, letter: 'ב', val: 3 }] },
  });
  await new Promise(r => setTimeout(r, 0));

  const roomNow = db._data.rooms['online-room'];
  assert.equal(roomNow.currentTurnSlot, 0, 'extra_turn keeps the turn with slot 0');
  assert.deepEqual(roomNow.turnEffects, [{ type: 'extra-turn', slot: 0 }],
    'the effect must reach the room — activeBoosts is already empty by now');
  assert.deepEqual(roomNow.activeBoosts, [],
    'proves the opponent could not have derived this from activeBoosts');
  await sessA.dispose();
});

test('online session: remote turnEffects re-emit TURN_EFFECTS_APPLIED on the victim client', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessB = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 1 });
  const notices = [];
  bus.on(EV.TURN_EFFECTS_APPLIED, p => notices.push(p));

  await db.ref('rooms/online-room').update({
    version: 2,
    currentTurnSlot: 0,
    turnNumber: 2,
    lastMove: { type: 'pass', slot: 0, turnNumber: 1, ts: 4242 },
    turnEffects: [{ type: 'skip-turn', slot: 1, bySlot: 0 }],
  });
  await new Promise(r => setTimeout(r, 0));

  assert.equal(notices.length, 1, 'slot 1 must be told why its turn was taken');
  assert.deepEqual(notices[0].effects, [{ type: 'skip-turn', slot: 1, bySlot: 0 }]);
  assert.equal(notices[0].remote, true);
  await sessB.dispose();
});

// The mover's engine already fired the notice locally; the commit echo must
// not fire a duplicate on the same device.
test('online session: own-move echo does not re-fire the turn-effect notice', async () => {
  bus._reset();
  const db = makeMockDb();
  await setupRoom(db);
  const sessA = await createOnlineGameSession({ bus, db, room: await readRoom(db), mySlot: 0 });
  const notices = [];
  bus.on(EV.TURN_EFFECTS_APPLIED, p => notices.push(p));

  await db.ref('rooms/online-room').update({
    version: 2,
    currentTurnSlot: 0,
    turnNumber: 2,
    lastMove: { type: 'pass', slot: 0, turnNumber: 1, ts: 5151 },
    turnEffects: [{ type: 'extra-turn', slot: 0 }],
  });
  await new Promise(r => setTimeout(r, 0));

  assert.equal(notices.length, 0, 'the mover already saw this from its own engine');
  await sessA.dispose();
});

async function readRoom(db) {
  const snap = await db.ref('rooms/online-room').get();
  return snap.val();
}

console.log = _origLog;
