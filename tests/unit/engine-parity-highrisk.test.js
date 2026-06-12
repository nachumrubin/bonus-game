const test = require('node:test');
const assert = require('node:assert/strict');

let modulesPromise;

function loadModules() {
  modulesPromise ??= Promise.all([
    import('../../src/events/bus.js'),
    import('../../src/events/commands.js'),
    import('../../src/events/eventTypes.js'),
    import('../../src/game/core/board.js'),
    import('../../src/game/core/gameEngine.js'),
    import('../../src/game/core/hebrewDictionary.js'),
    import('../../src/game/boosts/index.js'),
    import('../../src/game/online/mockFirebase.js'),
    import('../../src/game/online/roomService.js'),
    import('../../src/game/online/schema.js'),
    import('../../src/game/sessions/onlineGameSession.js'),
    import('../../src/ui/screens/miniGames/wordSearchMiniGame.js'),
    import('../../src/ui/screens/miniGames/crosswordMiniGame.js'),
    import('../../src/ui/screens/miniGames/crossingWordsMiniGame.js'),
    import('../../src/game/account/dictionaryService.js'),
    import('../../src/game/account/ratingService.js'),
    import('../../src/game/settings/settingsCompat.js'),
  ]).then(([
    bus, commands, events, board, engine, dict, boosts, mockFirebase,
    roomService, schema, onlineSession, wordSearch, crossword, crossingWords,
    dictionaryService, ratingService, settingsCompat,
  ]) => ({
    bus, commands, events, board, engine, dict, boosts, mockFirebase,
    roomService, schema, onlineSession, wordSearch, crossword, crossingWords,
    dictionaryService, ratingService, settingsCompat,
  }));
  return modulesPromise;
}

function seedDict(dict, words) {
  dict.DICT.clear();
  dict.addWordsFromText(words.join('\n'));
}

function capture(bus, events) {
  const seen = [];
  for (const type of Object.values(events.EV)) bus.on(type, payload => seen.push({ type, payload }));
  bus.on('evt/SYNC_REJECTED', payload => seen.push({ type: 'evt/SYNC_REJECTED', payload }));
  return seen;
}

function makeState(engine, overrides = {}) {
  const state = engine.createInitialState({
    mode: overrides.mode ?? 'offline-2p',
    tileBagSeed: overrides.seed ?? 'highrisk-parity',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
    settings: overrides.settings ?? {},
  });
  state.racks[0] = overrides.rack0 ?? ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.racks[1] = overrides.rack1 ?? ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.bag = overrides.bag ?? [];
  state.currentTurnSlot = overrides.turn ?? 0;
  return state;
}

async function makeEngine(overrides = {}) {
  const { bus, engine, boosts } = await loadModules();
  bus._reset();
  boosts._resetAndRegister();
  const state = makeState(engine, overrides);
  return { ...(await loadModules()), state, eng: engine.createEngine({ state, bus }) };
}

function placeSimpleWord(commands, eng, letters = ['א', 'ב'], row = 4) {
  eng.dispatch({
    type: commands.CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: row, c: 4, letter: letters[0], val: letters[0] === 'א' ? 1 : 3 },
        { r: row, c: 5, letter: letters[1], val: letters[1] === 'ב' ? 3 : 4 },
      ],
    },
  });
}

test('legacy commitPlay: quadNext multiplies word score only, then bonusOk extra is added after multiplier', async () => {
  const { bus, commands, events, dict, state, eng } = await makeEngine();
  seedDict(dict, ['אב']);
  capture(bus, events);
  state.activeBoosts = [{ slot: 0, boostId: 'multiply_next_turns', payload: { multiplier: 4, turnsRemaining: 1 }, turnNumber: 1 }];

  placeSimpleWord(commands, eng);
  eng.dispatch({ type: commands.CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, extra: 20 } });

  assert.equal(state.scores[0], 36, 'legacy commitPlay computes (4 * 4) + 20, never (4 + 20) * 4');
  assert.deepEqual(state.activeBoosts, [], 'legacy commitPlay consumes quadNext after the scoring turn');
});

test('legacy commitPlay: doubleNext decrements once and remains for the second scoring turn', async () => {
  const { commands, dict, state, eng } = await makeEngine({
    rack0: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'],
    rack1: ['ה', 'ו', 'ז', 'ח', 'ט', 'י', 'כ', 'ל'],
  });
  seedDict(dict, ['אב', 'אבג']);
  state.activeBoosts = [{ slot: 0, boostId: 'multiply_next_turns', payload: { multiplier: 2, turnsRemaining: 2 }, turnNumber: 1 }];

  placeSimpleWord(commands, eng, ['א', 'ב'], 4);
  assert.equal(state.scores[0], 8);
  assert.equal(state.activeBoosts[0]?.payload?.turnsRemaining, 1);

  state.currentTurnSlot = 0;
  state.turnNumber += 1;
  state.firstMove = false;
  eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: [{ r: 4, c: 6, letter: 'ג', val: 5 }] } });
  assert.equal(state.activeBoosts.some(b => b.boostId === 'multiply_next_turns'), false);
});

test('legacy commitPlay: emptyRackEmptyBag ends the game immediately', async () => {
  const { commands, dict, state, eng } = await makeEngine({ rack0: ['א', 'ב'], bag: [] });
  seedDict(dict, ['אב']);

  placeSimpleWord(commands, eng);

  assert.equal(state.racks[0].length, 0);
  assert.equal(state.bag.length, 0);
  assert.equal(state.status, 'completed', 'legacy commitPlay calls endGame when the player empties rack and bag');
});

test('legacy nextTurn/_doTurnStart: skipNextTurn auto-skips the opponent turn', async () => {
  const { commands, dict, state, eng } = await makeEngine();
  seedDict(dict, ['אב']);
  state.activeBoosts = [{ slot: 0, boostId: 'skip_opponent_turn', payload: {}, turnNumber: 1 }];

  placeSimpleWord(commands, eng);

  assert.equal(state.currentTurnSlot, 0, 'legacy nextTurn skips player 1 and returns to player 0');
  assert.equal(state.activeBoosts.some(b => b.boostId === 'skip_opponent_turn'), false);
});

test('legacy _doTurnStart/handleOnlinePendingEffect/showTileSwapPicker: tileSwap creates a pending turn-start effect', async () => {
  const { commands, dict, state, eng } = await makeEngine();
  seedDict(dict, ['אב']);
  state.activeBoosts = [{ slot: 1, boostId: 'free_tile_swap', payload: {}, turnNumber: 1 }];

  placeSimpleWord(commands, eng);

  assert.equal(state.currentTurnSlot, 1);
  assert.deepEqual(
    state.pendingTurnEffect,
    { type: 'tileSwap', player: 1 },
    'legacy nextTurn pauses the new turn and routes through handleOnlinePendingEffect/showTileSwapPicker',
  );
});

test('legacy online.inboundNoRevalidate/listenForMoves: opponent move applies without dictionary validation', async () => {
  const {
    bus, events, mockFirebase, roomService, onlineSession,
  } = await loadModules();
  bus._reset();
  const db = mockFirebase.makeMockDb();
  const engineState = makeState((await loadModules()).engine, { mode: 'friend-live' });
  await roomService.createRoom(db, {
    roomId: 'inbound-no-revalidate',
    mode: 'friend-live',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
    settings: {},
    engineState,
    serverTimestamp: 1,
  });
  const room = await roomService.readRoom(db, 'inbound-no-revalidate');
  const seen = capture(bus, events);
  const session = await onlineSession.createOnlineGameSession({ bus, db, room, mySlot: 1 });

  // `ts` is required: onlineGameSession dedupes inbound snapshots by
  // lastMove.ts (see the lastSeenMoveTs guard in the room watcher) so an
  // un-stamped move is silently ignored. Real moves always carry Date.now().
  const moveTs = Date.now();
  // Build a board that has the placed tiles at positions matching lastMove —
  // this is what a real commit produces (commitCurrentState writes both board
  // AND lastMove). Prior versions of this test sent an empty board, relying
  // on applyOpponentMove to populate state.board purely from lastMove.tiles.
  // The watcher's resync now treats incoming.board as authoritative (added
  // to fix the ghost-move-after-failed-commit bug — see
  // tests/unit/online-ghost-move-rollback.test.js), so the board field must
  // be realistic.
  const inboundBoard = new Array(100).fill(null);
  inboundBoard[44] = { letter: 'ז', val: 8, isJoker: false };
  inboundBoard[45] = { letter: 'ז', val: 8, isJoker: false };
  await db.ref('rooms/inbound-no-revalidate').update({
    version: 2,
    scores: { 0: 99, 1: 0 },
    currentTurnSlot: 1,
    turnNumber: 2,
    board: inboundBoard,
    moveHistory: [{
      slot: 0,
      tiles: [{ r: 4, c: 4, letter: 'ז', val: 8 }, { r: 4, c: 5, letter: 'ז', val: 8 }],
      words: ['זז'],
      wordTiles: [],
      score: 99,
      ts: moveTs,
    }],
    lastMove: {
      slot: 0,
      tiles: [{ r: 4, c: 4, letter: 'ז', val: 8 }, { r: 4, c: 5, letter: 'ז', val: 8 }],
      words: ['זז'],
      wordTiles: [],
      score: 99,
      ts: moveTs,
    },
  });

  assert.equal(session.state.board[4][4]?.letter, 'ז');
  assert.equal(session.state.board[4][5]?.letter, 'ז');
  assert.ok(seen.some(e => e.type === events.EV.OPPONENT_MOVED));
  assert.equal(seen.some(e => e.type === events.EV.INVALID_MOVE_REJECTED), false);
  await session.dispose();
});

test('legacy triggerBonus/bonusOk: B1-B13 activation branches are represented through the engine lifecycle', async () => {
  const cases = [
    ['B1',  'pending', 'minigame'],
    ['B2',  'auto', 20],
    ['B3',  'pending', 'minigame'],
    ['B4',  'auto', 1],
    ['B5',  'repeat', 'extra_turn'],
    ['B6',  'future', 'multiply_next_turns'],
    ['B7',  'future', 'multiply_next_turns'],
    ['B8',  'pending', 'minigame'],
    ['B9',  'auto', 25],
    ['B10', 'pending', 'minigame'],
    ['B11', 'pending', 'minigame'],
    ['B12', 'pending', 'minigame'],
    ['B13', 'pending', 'wheel'],
  ];

  for (const [bonusType, kind, expected] of cases) {
    const { bus, commands, events, board, dict, state, eng } = await makeEngine({ seed: `bonus-${bonusType}` });
    seedDict(dict, ['בא']);
    const seen = capture(bus, events);
    state.firstMove = false;
    state.racks[0] = ['ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    state.bonusAssignment[0] = { type: bonusType };
    board.setCommittedTile(state, 0, 1, { letter: 'א', val: 1, isJoker: false });

    eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: [{ r: -1, c: 1, letter: 'ב', val: 3 }] } });

    assert.equal(state.bonusSqUsed[0], true, `legacy triggerBonus marks used square for ${bonusType}`);
    if (kind === 'auto') {
      assert.ok(seen.some(e => e.type === events.EV.BOOST_ACTIVATED && e.payload.boostId === 'auto_extra_score' && e.payload.payload.extra === expected), bonusType);
    } else if (kind === 'future') {
      assert.ok(state.activeBoosts.some(b => b.boostId === expected && b.bonusIdx === 0), bonusType);
    } else if (kind === 'repeat') {
      eng.dispatch({ type: commands.CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra: 0 } });
      assert.equal(state.currentTurnSlot, 0, bonusType);
      assert.equal(state.activeBoosts.some(b => b.boostId === expected), false, bonusType);
    } else {
      assert.ok(state.pendingBonuses.some(p => p.idx === 0 && p.kind === expected), bonusType);
      assert.ok(seen.some(e => e.type === events.EV.BONUS_PENDING && e.payload.kind === expected), bonusType);
    }
  }
});

test('legacy bonusOk B5: extra-turn bonus applies when the award overlay is acknowledged', async () => {
  const { commands, board, dict, state, eng } = await makeEngine();
  seedDict(dict, ['בא']);
  state.firstMove = false;
  state.racks[0] = ['ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  state.bonusAssignment[0] = { type: 'B5' };
  board.setCommittedTile(state, 0, 1, { letter: 'א', val: 1, isJoker: false });

  eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: [{ r: -1, c: 1, letter: 'ב', val: 3 }] } });

  assert.equal(state.activeBoosts.some(b => b.boostId === 'extra_turn'), true);
  eng.dispatch({ type: commands.CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra: 0 } });
  assert.equal(state.currentTurnSlot, 0, 'legacy bonusOk sets futBon.extraTurn before commitPlay calls nextTurn');
  assert.equal(state.activeBoosts.some(b => b.boostId === 'extra_turn'), false);
});

test('legacy bonusSkip: skipped pending bonus is cleared after base move commit', async () => {
  const { commands, board, dict, state, eng } = await makeEngine();
  seedDict(dict, ['בא']);
  state.firstMove = false;
  state.racks[0] = ['ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  state.bonusAssignment[0] = { type: 'B1' };
  board.setCommittedTile(state, 0, 1, { letter: 'א', val: 1, isJoker: false });
  eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: [{ r: -1, c: 1, letter: 'ב', val: 3 }] } });
  assert.equal(state.pendingBonuses.length, 1);

  eng.dispatch({ type: commands.CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra: 0 } });

  assert.equal(state.pendingBonuses.length, 0, 'legacy bonusSkip clears bonusPend and only commits the base move');
});

// Reported bug: "skipping a תפזורת (B11 word search) still granted 10 bonus
// points." Skipping resolves the mini-game with extra:0, so the committed
// score must be ONLY the base word score (here 'בא' = 3+1 = 4) — never base
// + a phantom bonus. Covers B11 and the other interactive mini-game tiles.
test('skipping an interactive mini-game (B11 תפזורת etc.) commits only the base word score', async () => {
  for (const bonusType of ['B11', 'B1', 'B3', 'B8', 'B10', 'B12']) {
    const { commands, board, dict, state, eng } = await makeEngine({ seed: `skip-${bonusType}` });
    seedDict(dict, ['בא']);
    state.firstMove = false;
    state.racks[0] = ['ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    state.bonusAssignment[0] = { type: bonusType };
    board.setCommittedTile(state, 0, 1, { letter: 'א', val: 1, isJoker: false });

    eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: [{ r: -1, c: 1, letter: 'ב', val: 3 }] } });
    assert.equal(state.pendingBonuses.length, 1, `${bonusType} defers scoring`);
    const baseScore = state.pendingScoreCommit?.baseScore ?? 0;
    assert.equal(baseScore, 4, `${bonusType} base 'בא' = 4`);
    assert.equal(state.scores[0], 0, `${bonusType} base score held until the mini-game resolves`);

    // Skip = resolve with extra 0 (what bonusActivationController.resolveMiniGame
    // dispatches when found.size === 0).
    eng.dispatch({ type: commands.CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra: 0 } });

    assert.equal(state.scores[0], baseScore, `${bonusType} skip commits ONLY the base word score (no phantom bonus)`);
    assert.equal(state.scores[0], 4, `${bonusType} skip total is 4, not 14`);
    assert.equal(state.pendingBonuses.length, 0, `${bonusType} pending bonus cleared`);
  }
});

test('legacy bonusOk: interactive B1/B3/B8/B10/B11/B12 success clears pending and awards only after acknowledgement', async () => {
  const interactive = [
    ['B1', 100],
    ['B3', 40],
    ['B8', 20],
    ['B10', 40],
    ['B11', 100],
    ['B12', 50],
  ];

  for (const [bonusType, extra] of interactive) {
    const { commands, board, dict, state, eng } = await makeEngine({ seed: `interactive-${bonusType}` });
    seedDict(dict, ['בא']);
    state.firstMove = false;
    state.racks[0] = ['ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    state.bonusAssignment[0] = { type: bonusType };
    board.setCommittedTile(state, 0, 1, { letter: 'א', val: 1, isJoker: false });

    eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: [{ r: -1, c: 1, letter: 'ב', val: 3 }] } });
    assert.equal(state.pendingBonuses.length, 1, bonusType);
    const baseScore = state.pendingScoreCommit?.baseScore ?? 0;
    assert.equal(state.scores[0], 0, `${bonusType} base score waits for award acknowledgement`);

    eng.dispatch({ type: commands.CMD.ACTIVATE_BOOST, payload: { slot: 0, bonusIdx: 0, boostId: 'auto_extra_score', payload: { extra } } });
    assert.equal(state.pendingBonuses.length, 0, bonusType);
    assert.equal(state.scores[0], 0, `${bonusType} bonusOk waits for award acknowledgement`);

    eng.dispatch({ type: commands.CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra } });
    assert.equal(state.scores[0], baseScore + extra, bonusType);
  }
});

test('legacy bonusOk: auto B2/B4/B9 bonuses award their configured extra after acknowledgement', async () => {
  const auto = [
    ['B2', 20],
    ['B4', 1],
    ['B9', 25],
  ];

  for (const [bonusType, extra] of auto) {
    const { commands, board, dict, state, eng } = await makeEngine({ seed: `auto-${bonusType}` });
    seedDict(dict, ['בא']);
    state.firstMove = false;
    state.racks[0] = ['ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    state.bonusAssignment[0] = { type: bonusType };
    board.setCommittedTile(state, 0, 1, { letter: 'א', val: 1, isJoker: false });

    eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: [{ r: -1, c: 1, letter: 'ב', val: 3 }] } });
    const baseScore = state.pendingScoreCommit?.baseScore ?? 0;
    assert.equal(state.scores[0], 0, `${bonusType} base score waits for award acknowledgement`);
    eng.dispatch({ type: commands.CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra } });
    assert.equal(state.scores[0], baseScore + extra, bonusType);
  }
});

test('legacy B13 wheel lifecycle: future and auto outcomes clear pending state through ACTIVATE_BOOST', async () => {
  const { commands, board, dict, state, eng } = await makeEngine();
  seedDict(dict, ['בא']);
  state.firstMove = false;
  state.racks[0] = ['ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  state.bonusAssignment[0] = { type: 'B13' };
  board.setCommittedTile(state, 0, 1, { letter: 'א', val: 1, isJoker: false });

  eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: [{ r: -1, c: 1, letter: 'ב', val: 3 }] } });
  assert.equal(state.pendingBonuses[0]?.kind, 'wheel');

  eng.dispatch({ type: commands.CMD.ACTIVATE_BOOST, payload: { slot: 0, bonusIdx: 0, boostId: 'free_tile_swap', payload: {} } });
  assert.equal(state.pendingBonuses.length, 0);
  assert.ok(state.activeBoosts.some(b => b.boostId === 'free_tile_swap' && b.bonusIdx === 0));

  eng.dispatch({ type: commands.CMD.ACTIVATE_BOOST, payload: { slot: 0, bonusIdx: 0, boostId: 'auto_extra_score', payload: { extra: 50 } } });
  const baseScore = state.pendingScoreCommit?.baseScore ?? 0;
  eng.dispatch({ type: commands.CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra: 50 } });
  assert.equal(state.scores[0], baseScore + 50);
});

test('legacy computeExpiredOnlineTurnState/shouldClaimExpiredOnlineTurn: online timeout claim helpers are exported', async () => {
  const { roomService } = await loadModules();

  assert.equal(typeof roomService.computeExpiredOnlineTurnState, 'function');
  assert.equal(typeof roomService.shouldClaimExpiredOnlineTurn, 'function');
});

test('legacy computeExpiredOnlineTurnState/shouldClaimExpiredOnlineTurn: online timeout state patch matches legacy fields', async () => {
  const { roomService } = await loadModules();
  // missedTurns[1] starts at 0 so the bump to 1 stays under
  // MISSED_TURNS_FORFEIT_THRESHOLD (=2); the function would otherwise force
  // turnDeadlineMs back to 0 and flip status to ABANDONED on forfeit, which
  // is its own code path tested elsewhere.
  const state = {
    turn: 1,
    passCount: 2,
    moveCount: 7,
    turnDeadlineMs: 9_000,
    stateSeq: 4,
    missedTurns: { 0: 3, 1: 0 },
  };
  assert.equal(roomService.shouldClaimExpiredOnlineTurn(state, 0, 10_001, 1_000), true);
  assert.equal(roomService.shouldClaimExpiredOnlineTurn(state, 1, 10_001, 1_000), false);

  const next = roomService.computeExpiredOnlineTurnState(state, 20_000, 30_000);
  assert.equal(next.turn, 0);
  assert.equal(next.currentTurnSlot, 0);
  assert.equal(next.passCount, 3);
  assert.equal(next.moveCount, 8);
  assert.equal(next.turnDeadlineMs, 50_000);
  assert.deepEqual(next.missedTurns, { 0: 0, 1: 1 });
  assert.equal(next.stateSeq, 5);
  assert.notEqual(next.status, 'abandoned');
});

test('legacy buildWordSearch: modular word-search builder keeps grid size, word count, and extract/match behavior', async () => {
  const { wordSearch } = await loadModules();
  const words = wordSearch.HEBREW_WORD_POOL.slice(0, 12);
  const puzzle = wordSearch.placeWords(words, { rng: constantRng(0.1) });

  assert.equal(puzzle.grid.length, 10);
  assert.equal(puzzle.grid[0].length, 10);
  assert.equal(puzzle.placements.length, 10);
  const first = puzzle.placements[0];
  assert.equal(wordSearch.extractWord(puzzle.grid, first.from, first.to), first.word);
  assert.equal(wordSearch.matchPlacement(puzzle.placements, first.from, first.to)?.word, first.word);
});

test('legacy buildCrossword: modular crossword draws 20 non-joker tiles and rejects any illegal word on finalize', async () => {
  const { crossword } = await loadModules();
  const pool = crossword.drawCrosswordPool(['?', 'א', '?', 'ב'], { rng: constantRng(0.2) });
  assert.equal(pool.length, 20);
  assert.equal(pool.includes('?'), false);

  const placements = Array.from({ length: 5 }, () => Array(7).fill(null));
  placements[0][0] = { l: 'א', v: 1 };
  placements[0][1] = { l: 'ב', v: 3 };
  placements[1][0] = { l: 'ז', v: 8 };
  placements[1][1] = { l: 'ז', v: 8 };
  const result = crossword.scanCrosswordWords(placements, { validator: word => word === 'אב' });
  assert.equal(result.legal['אב'], 4);
  assert.equal(result.illegal['זז'], 16);
  assert.equal(result.hasIllegal, true);
});

test('legacy buildCrossingWords: modular crossing builder uses fallback and grades shared letter', async () => {
  const { crossingWords } = await loadModules();
  const none = crossingWords.findCrossingPair(['אב', 'הו'], { minLen: 3 });
  assert.equal(none, null);
  assert.deepEqual(crossingWords.FALLBACK_CROSSING_PAIR, {
    h: 'תפוח',
    v: 'חגים',
    hpos: 3,
    vpos: 0,
    shared: 'ח',
  });
  assert.equal(crossingWords.gradeCrossingLetter('ח', crossingWords.FALLBACK_CROSSING_PAIR), true);
  assert.equal(crossingWords.gradeCrossingLetter('א', crossingWords.FALLBACK_CROSSING_PAIR, { dictCheck: () => false }), false);
});

test('legacy addApprovedDictionaryWords/checkDictionaryQuery: approved words sync into the active dictionary set', async () => {
  const { mockFirebase, dictionaryService, dict } = await loadModules();
  const db = mockFirebase.makeMockDb();
  await db.ref('dictionaryApproved/שלום').set({ word: 'שלום' });
  await db.ref('dictionaryApproved/ספר').set({ normalizedWord: 'ספר' });
  dict.DICT.clear();

  const count = await dictionaryService.syncApprovedDictionaryWordsOnce(db, dict.DICT);

  assert.equal(count, 2);
  assert.equal(dict.DICT.has('שלום'), true);
  assert.equal(dict.DICT.has('ספר'), true);
});

test('legacy calcElo/ranking rows: modular rating helpers preserve Elo math and sorted leaderboard behavior', async () => {
  const { ratingService } = await loadModules();
  assert.equal(ratingService.applyDelta(800, 800, 1), 812);
  assert.equal(ratingService.applyDelta(800, 800, 0), 788);
  assert.deepEqual(
    ratingService.rankRatings({
      a: { name: 'A', rating: 900, updatedAt: 1 },
      b: { name: 'B', rating: 900, updatedAt: 2 },
      c: { name: 'C', rating: 700, updatedAt: 3 },
    }, { limit: 2 }).map(r => r.uid),
    ['b', 'a'],
  );
});

test('legacy settings rows: timer settings round-trip between legacy globals and modular settings', async () => {
  const { settingsCompat } = await loadModules();
  const settings = settingsCompat.settingsFromLegacyGlobals({
    gameSettings: { timelimit: true, botTime: 45, music: false, showBothRacks: true },
  });
  assert.equal(settings.timelimit, true);
  assert.equal(settings.botTime, 45);
  assert.equal(settings.music, false);
  assert.equal(settings.showBothRacks, true);
  const globals = { settings: {} };
  settingsCompat.applyGameSettingsToGlobals(globals, settings);
  assert.equal(globals.settings.computerTimerSecs, 45);
  assert.equal(globals.settings.musicOn, false);
});

function constantRng(value) {
  const rng = () => value;
  rng.int = n => Math.floor(value * n);
  return rng;
}
