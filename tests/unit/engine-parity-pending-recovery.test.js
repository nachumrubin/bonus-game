// Pending-tile recovery parity vs. legacy `doRecall()` / `expireCurrentMove()`.
//
// Legacy authority (HEAD:index.html):
//   - doRecall() at line 5069: returns every `placed` tile to the rack at its
//     original rackSlot index (placed tiles were removed from the rack on
//     placement) and clears `placed`.
//   - expireCurrentMove() at line 3797: on timeout with tentative placements,
//     animates rollback then calls doRecall(), then advances the turn through
//     finishExpiredTurn() (which increments passCount and calls nextTurn).
//
// Player-visible invariants we assert:
//   - After ANY recovery path, the player sees their full original rack.
//   - The board has no tentative tiles in the cells they touched.
//   - The bag count is unchanged.
//   - Both score panels are unchanged.
//   - Recall keeps the turn; timeout/invalid-word advance the turn AND
//     increment passCount.
//
// The spine model differs structurally: tentative placements live only in
// the controller's view; the engine rack is never decremented at placement
// time, so recovery cannot lose tiles by construction. These tests pin that
// invariant so a future change that moves placement state into the engine
// (or otherwise touches the rack at place-time) is caught immediately.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const LEGACY_SOURCE = execFileSync('git', ['show', 'HEAD:index.html'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

function extractFunction(name) {
  const start = LEGACY_SOURCE.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find legacy function ${name}`);
  let depth = 0;
  const open = LEGACY_SOURCE.indexOf('{', start);
  for (let j = open; j < LEGACY_SOURCE.length; j++) {
    const ch = LEGACY_SOURCE[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return LEGACY_SOURCE.slice(start, j + 1);
    }
  }
  throw new Error(`Could not extract legacy function ${name}`);
}

let modulesPromise;
function loadModules() {
  modulesPromise ??= Promise.all([
    import('../../src/events/bus.js'),
    import('../../src/events/commands.js'),
    import('../../src/events/eventTypes.js'),
    import('../../src/game/core/hebrewDictionary.js'),
    import('../../src/game/sessions/localGameSession.js'),
    import('../../src/ui/controllers/gameController.js'),
    import('../../src/ui/controllers/turnTimerController.js'),
  ]).then(([bus, commands, events, dict, localSession, controller, timer]) => ({
    bus: bus, commands, events, dict, localSession, controller, timer,
  }));
  return modulesPromise;
}

const PLAYERS = { 0: { uid: 'a', displayName: 'A' }, 1: { uid: 'b', displayName: 'B' } };
const RACK_0 = ['א','ב','ג','ד','ה','ו','ז','ח'];
const RACK_1 = ['ט','י','כ','ל','מ','נ','ס','ע'];

async function setupSpine({ timed = false, dictWords = ['אב'] } = {}) {
  const m = await loadModules();
  m.bus._reset();
  m.dict.DICT.clear();
  m.dict.addWordsFromText(dictWords.join('\n'));

  const session = m.localSession.createLocalGameSession({
    bus: m.bus,
    mode: 'offline-2p',
    tileBagSeed: 'recovery-parity',
    players: PLAYERS,
    settings: timed ? { timelimit: true, botTime: 20 } : {},
  });
  session.state.racks[0] = [...RACK_0];
  session.state.racks[1] = [...RACK_1];

  const gc = m.controller.createGameController({ bus: m.bus, session, mySlot: 0 });
  return { session, gc, modules: m };
}

function snapshotEngine(state) {
  return {
    rack0: [...state.racks[0]],
    rack1: [...state.racks[1]],
    bagLen: state.bag.length,
    score0: state.scores[0],
    score1: state.scores[1],
    turnSlot: state.currentTurnSlot,
    turnNumber: state.turnNumber,
    passCount: state.passCount,
    moveCount: state.moveCount,
    status: state.status,
    boardCells: collectBoardTiles(state.board),
  };
}

function collectBoardTiles(board) {
  const out = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const t = board?.[r]?.[c];
      if (t) out.push({ r, c, letter: t.letter });
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────
// 1. Manual recall.
// Legacy doRecall: rack restored, placed cleared, turn unchanged, score
// unchanged, passCount unchanged.
// Spine: gc.recallAll() clears view.placed; engine rack was never touched.
test('parity: manual recall keeps engine state untouched and clears tentative tiles', async () => {
  const { session, gc } = await setupSpine();
  const before = snapshotEngine(session.state);

  gc.placeTile({ r: 4, c: 4, letter: 'א', val: 1, rackIndex: 0 });
  gc.placeTile({ r: 4, c: 5, letter: 'ב', val: 3, rackIndex: 1 });
  assert.equal(gc.view.placed.length, 2);

  // Spine invariant: engine state is untouched while tiles are merely placed.
  assert.deepEqual(snapshotEngine(session.state), before, 'engine state must not mutate on tentative placement');

  gc.recallAll();

  assert.equal(gc.view.placed.length, 0, 'view.placed cleared by recall');
  assert.deepEqual(snapshotEngine(session.state), before, 'recall must not advance turn, lose tiles, or mutate score');
});

// ───────────────────────────────────────────────────────────────────────
// 2. Timeout auto-pass with tentative tiles.
// Legacy expireCurrentMove → animateRollback → doRecall → finishExpiredTurn:
//   rack restored, placed cleared, passCount++, turn advanced, scores
//   unchanged, bag unchanged.
// Spine: turnTimerController dispatches CMD.PASS_TURN(timeout) → engine
//   passes → TURN_CHANGED → controller clears view.placed.
test('parity: timeout auto-pass restores rack, clears placed, advances turn, bumps passCount', async () => {
  const { session, gc, modules } = await setupSpine({ timed: true });
  const before = snapshotEngine(session.state);

  gc.placeTile({ r: 4, c: 4, letter: 'א', val: 1, rackIndex: 0 });
  gc.placeTile({ r: 4, c: 5, letter: 'ב', val: 3, rackIndex: 1 });
  assert.equal(gc.view.placed.length, 2);

  const dispatched = [];
  const origDispatch = session.dispatch.bind(session);
  session.dispatch = (cmd) => { dispatched.push(cmd); origDispatch(cmd); };

  // First sync installs the deadline (offline/optional mode allocates a fresh
  // clock); second sync after time advances past it dispatches the timeout.
  let nowMs = 1_000_000;
  const t = modules.timer.createTurnTimerController({
    bus: modules.bus,
    root: { querySelector: () => ({ textContent: '', classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} } }) },
    sessionRef: () => session,
    now: () => nowMs,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  // botTime is 20s; jump 25s into the future and re-sync.
  nowMs += 25_000;
  t.sync();

  const pass = dispatched.find(c => c.type === modules.commands.CMD.PASS_TURN);
  assert.ok(pass, 'timer dispatched PASS_TURN on expiry');
  assert.equal(pass.payload.reason, 'timeout');

  assert.equal(gc.view.placed.length, 0, 'view.placed cleared by TURN_CHANGED');
  assert.deepEqual(session.state.racks[0], before.rack0, 'rack 0 not mutated by tentative placement → recovery');
  assert.deepEqual(session.state.racks[1], before.rack1, 'rack 1 untouched');
  assert.equal(session.state.bag.length, before.bagLen, 'bag count unchanged');
  assert.equal(session.state.scores[0], before.score0, 'score 0 unchanged');
  assert.equal(session.state.scores[1], before.score1, 'score 1 unchanged');
  assert.notEqual(session.state.currentTurnSlot, before.turnSlot, 'turn advanced');
  assert.equal(session.state.passCount, before.passCount + 1, 'passCount incremented');
  assert.deepEqual(collectBoardTiles(session.state.board), [], 'no ghost tiles committed to the board');

  t.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 3. Invalid-word commit → auto-pass after 1100ms.
// Legacy: dictionary rejection routes through the review/appeal flow; on
// abandonment placed is recalled and turn passes. Spine deliberately removed
// the appeal UI: invalid-word INVALID_MOVE_REJECTED schedules a 1100ms timer
// that clears placed and dispatches PASS_TURN(reason: illegal-word). The
// engine's pass handler RESETS passCount on illegal-word (intentional spine
// divergence so a bot pass after an illegal-word forfeit doesn't accidentally
// end the game on the 2-consecutive-passes heuristic). Net player-visible
// state: rack restored, board untouched, turn advanced.
test('parity: invalid-word commit clears tentative tiles and auto-passes after the flash window', async () => {
  const { session, gc, modules } = await setupSpine({ dictWords: ['אב'] /* 'אג' is NOT in dict */ });

  // Lay one tile on the board first so a second move is "connected".
  session.state.firstMove = false;
  session.state.board[5][5] = { letter: 'ת', val: 4, isJoker: false };

  const before = snapshotEngine(session.state);

  // Place 'א' + 'ג' adjacent to the committed 'ת' to form a non-dict word.
  gc.placeTile({ r: 5, c: 6, letter: 'א', val: 1, rackIndex: 0 });
  gc.placeTile({ r: 5, c: 7, letter: 'ג', val: 5, rackIndex: 2 });

  // Capture the original setTimeout so we can synchronously fire the 1100ms callback.
  const scheduled = [];
  const origSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { scheduled.push({ fn, ms }); return 0; };
  try {
    const ok = gc.confirmMove();
    assert.equal(ok, true);
  } finally {
    globalThis.setTimeout = origSetTimeout;
  }

  // Engine rejected (dictionary), gameController scheduled the 1100ms cleanup.
  assert.equal(gc.view.lastInvalidReason, 'word-not-in-dictionary');
  const cleanup = scheduled.find(s => s.ms === 1100);
  assert.ok(cleanup, 'controller scheduled 1100ms cleanup');

  // Tiles still visually present until flash window elapses (matches legacy
  // animateRollback timing — player sees their word before it disappears).
  assert.equal(gc.view.placed.length, 2, 'placed retained during flash window');

  // Fire the cleanup synchronously.
  cleanup.fn();

  assert.equal(gc.view.placed.length, 0, 'view.placed cleared after flash');
  assert.deepEqual(session.state.racks[0], before.rack0, 'rack restored to original (no tile loss)');
  assert.deepEqual(session.state.racks[1], before.rack1);
  assert.equal(session.state.bag.length, before.bagLen, 'bag unchanged (no draw on invalid)');
  assert.equal(session.state.scores[0], before.score0, 'score unchanged on invalid commit');
  assert.equal(session.state.scores[1], before.score1);
  assert.notEqual(session.state.currentTurnSlot, before.turnSlot, 'turn advanced (illegal-word auto-pass)');
  // Spine deliberately resets passCount on illegal-word — see gameEngine.handlePass.
  assert.equal(session.state.passCount, 0, 'passCount reset on illegal-word (spine divergence vs. legacy)');
  // The committed 'ת' tile should still be on the board; the tentative
  // 'א'/'ג' tiles must NOT have been written.
  assert.deepEqual(
    collectBoardTiles(session.state.board).sort((a,b)=>a.c-b.c),
    [{ r: 5, c: 5, letter: 'ת' }],
    'only the pre-existing committed tile remains; no tentative ghosts'
  );
});

// ───────────────────────────────────────────────────────────────────────
// 4. Legacy doRecall behavioural fingerprint.
// Run legacy doRecall in a vm sandbox with a representative starting state.
// We do NOT compare implementation; we compare the abstract pre→post shape:
//   (rack, placed) — proving the legacy invariant we just asserted on the
//   spine in test #1 is the same legacy invariant on which it is based.
test('parity: legacy doRecall pre→post shape matches the spine recall invariant', () => {
  const ctx = vm.createContext({
    placed: [
      { r: 4, c: 4, letter: 'א', isJoker: false, rackSlot: 0 },
      { r: 4, c: 5, letter: 'ב', isJoker: false, rackSlot: 1 },
    ],
    // Legacy zeroes the rack slot on placement (racks[turn][selTile]=null at
    // HEAD:index.html:4993), so by the time doRecall runs the rack has null
    // placeholders at slots 0 and 1.
    racks: { 0: [null, null, 'ג','ד','ה','ו','ז','ח'], 1: [...RACK_1] },
    turn: 0,
    replacedThisTurn: null,
    selTile: null,
    selPlaced: null,
    document: { body: { classList: { remove: () => {}, add: () => {} } } },
    pushLiveToFirebase: () => {},
    renderBoard: () => {},
    renderRack: () => {},
    setS: () => {},
    undoReplacement: () => {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
  });
  vm.runInContext(extractFunction('doRecall'), ctx);
  vm.runInContext('doRecall();', ctx);

  // Legacy invariant (also the spine's): rack restored at rackSlot indexes,
  // placed cleared, replacement undone (nothing to undo here).
  // Compare across realms by copying values out of the vm context.
  assert.deepEqual([...ctx.racks[0]], RACK_0, 'legacy doRecall restores rack');
  assert.equal(ctx.placed.length, 0, 'legacy doRecall clears placed');
});
