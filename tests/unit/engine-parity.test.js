const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const LEGACY_SOURCE = execFileSync('git', ['show', 'HEAD:index.html'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

const BDEFS = [
  { side: 'top', br: -1, bc: 1 },
  { side: 'top', br: -1, bc: 5 },
  { side: 'top', br: -1, bc: 8 },
  { side: 'bottom', br: 10, bc: 2 },
  { side: 'bottom', br: 10, bc: 5 },
  { side: 'bottom', br: 10, bc: 7 },
  { side: 'left', br: 1, bc: -1 },
  { side: 'left', br: 4, bc: -1 },
  { side: 'left', br: 7, bc: -1 },
  { side: 'right', br: 2, bc: 10 },
  { side: 'right', br: 5, bc: 10 },
  { side: 'right', br: 8, bc: 10 },
];

const HEB = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ', 'ק', 'ר', 'ש', 'ת'];
const HV = {
  א: 1, ב: 3, ג: 5, ד: 3, ה: 4, ו: 3, ז: 8, ח: 6, ט: 8, י: 3, כ: 5,
  ל: 2, מ: 2, נ: 4, ס: 4, ע: 6, פ: 8, צ: 8, ק: 7, ר: 2, ש: 3, ת: 3,
};

let modulesPromise;

function loadModules() {
  modulesPromise ??= Promise.all([
    import('../../src/game/core/gameEngine.js'),
    import('../../src/events/commands.js'),
    import('../../src/events/eventTypes.js'),
    import('../../src/events/bus.js'),
    import('../../src/game/core/hebrewDictionary.js'),
    import('../../src/game/core/board.js'),
    import('../../src/game/core/moveValidator.js'),
    import('../../src/game/core/scoringEngine.js'),
    import('../../src/game/boosts/index.js'),
    import('../../src/game/online/schema.js'),
    import('../../src/game/online/roomService.js'),
  ]).then(([engine, commands, events, bus, dict, board, validator, scoring, boosts, schema, roomService]) => ({
    engine, commands, events, bus, dict, board, validator, scoring, boosts, schema, roomService,
  }));
  return modulesPromise;
}

function extractFunction(name) {
  const tokens = [`function ${name}(`, `function* ${name}(`];
  const start = tokens.map(t => LEGACY_SOURCE.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0];
  if (start === undefined) throw new Error(`Could not find legacy function ${name}`);
  let i = LEGACY_SOURCE.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < LEGACY_SOURCE.length; j++) {
    const ch = LEGACY_SOURCE[j];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return LEGACY_SOURCE.slice(start, j + 1);
    }
  }
  throw new Error(`Could not extract legacy function ${name}`);
}

function legacyContext({
  board = emptyBoard(),
  bonusBoard = {},
  placed = [],
  firstMove = true,
  dictWords = [],
  permissiveDictionary = false,
}) {
  const context = vm.createContext({
    BS: 10,
    BDEFS,
    bData: clone(board),
    bBoardData: { ...bonusBoard },
    placed: clone(placed),
    replacedThisTurn: null,
    firstMove,
    DICT: new Set(dictWords.length ? dictWords : ['אב']),
    window: permissiveDictionary
      ? { HebrewValidator: { ready: true, validate: () => ({ valid: true, reason: 'test' }) } }
      : {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Set,
    Math,
  });

  [
    'isCollinear',
    'isBonusPos',
    'isConnected',
    'hasGaps',
    'getCommittedTile',
    'getMoveTiles',
    'getTile',
    'getWT',
    'getAllWords',
    'scoreWord',
    'calcTotal',
    'norm',
    'terminalFinalVariants',
    'dictHas',
    'analyze',
    'isValid',
  ].forEach(name => vm.runInContext(extractFunction(name), context));

  return context;
}

function evaluateLegacyMove(fixture) {
  const ctx = legacyContext(fixture);
  const trace = [];
  const moveTiles = ctx.getMoveTiles();
  trace.push({ phase: 'moveTiles', tiles: normalizeTiles(moveTiles) });
  if (!moveTiles.length) return invalid('empty-move');

  const checks = [
    ['isCollinear', ctx.isCollinear()],
    ['hasGaps', !ctx.hasGaps(moveTiles)],
    ['firstMoveOnBonus', !(ctx.firstMove && moveTiles.some(p => ctx.isBonusPos(p.r, p.c)))],
    ['isConnected', ctx.isConnected()],
  ];
  for (const [check, ok] of checks) {
    trace.push({ phase: 'validation', check, ok });
    if (!ok) {
      const reasons = {
        isCollinear: 'not-collinear',
        hasGaps: 'has-gaps',
        firstMoveOnBonus: 'first-move-on-bonus',
        isConnected: 'not-connected',
      };
      return invalid(reasons[check]);
    }
  }

  const words = ctx.getAllWords(moveTiles);
  trace.push({ phase: 'words', words: Array.from(words, wordText), wordTiles: normalizeWords(words) });
  if (!words.length || words[0].length < 2) return invalid('word-too-short');

  const wordTexts = Array.from(words, wordText);
  const invalidWords = wordTexts.filter(w => !ctx.isValid(w));
  trace.push({ phase: 'dictionary', invalidWords });
  if (invalidWords.length) return invalid('word-not-in-dictionary', { invalidWords });

  const score = ctx.calcTotal(moveTiles);
  trace.push({ phase: 'score', score, placedCount: moveTiles.length });
  return { ok: true, words: wordTexts, wordTiles: normalizeWords(words), score, trace };

  function invalid(reason, extra = {}) {
    trace.push({ phase: 'reject', reason, ...extra });
    return { ok: false, reason, trace, ...extra };
  }
}

async function evaluateNewMove(fixture) {
  const { engine, commands, events, bus, dict, board, validator, scoring, boosts } = await loadModules();
  bus._reset();
  boosts._resetAndRegister();
  dict.DICT.clear();
  dict.addWordsFromText((fixture.dictWords || []).join('\n'));

  const previousValidator = globalThis.HebrewValidator;
  if (fixture.permissiveDictionary) {
    globalThis.HebrewValidator = { ready: true, validate: () => ({ valid: true, reason: 'test' }) };
    if (dict.DICT.size === 0) dict.addWordsFromText('אב');
  } else {
    delete globalThis.HebrewValidator;
  }

  try {
    const state = engine.createInitialState({
      mode: 'offline-2p',
      tileBagSeed: fixture.seed || 'parity-seed',
      players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
    });
    state.board = clone(fixture.board || emptyBoard());
    state.bonusBoard = new Map(Object.entries(fixture.bonusBoard || {}));
    state.firstMove = fixture.firstMove ?? true;
    state.currentTurnSlot = fixture.turn ?? 0;
    state.turnNumber = fixture.turnNumber ?? 1;
    state.racks = {
      0: [...(fixture.rack || rackFor(fixture.placed || []))],
      1: [...(fixture.opponentRack || ['ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע'])],
    };
    state.bag = [...(fixture.bag || [])];
    state.activeBoosts = clone(fixture.activeBoosts || []);

    for (const [key, tileValue] of Object.entries(fixture.bonusBoard || {})) {
      const [r, c] = key.split(',').map(Number);
      board.setCommittedTile(state, r, c, tileValue);
    }

    const placed = clone(fixture.placed || []);
    const before = snapshotState(state);
    const trace = traceNewDecision({ state, placed, validator, scoring, dict });
    const seen = [];
    Object.values(events.EV).forEach(type => bus.on(type, payload => seen.push({ type, payload })));
    const eng = engine.createEngine({ state, bus });
    eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed } });
    trace.push({ phase: 'events', events: seen.map(e => ({ type: e.type, payload: normalizePayload(e.payload) })) });
    trace.push({ phase: 'stateDelta', before, after: snapshotState(state) });

    const rejected = seen.find(e => e.type === events.EV.INVALID_MOVE_REJECTED);
    if (rejected) {
      return {
        ok: false,
        reason: rejected.payload.reason,
        invalidWords: rejected.payload.invalidWords || [],
        events: seen,
        state: snapshotState(state),
        trace,
      };
    }
    const confirmed = seen.find(e => e.type === events.EV.MOVE_CONFIRMED);
    assert.ok(confirmed, 'new engine produced neither MOVE_CONFIRMED nor INVALID_MOVE_REJECTED');
    return {
      ok: true,
      words: confirmed.payload.words,
      wordTiles: normalizeWords(confirmed.payload.wordTiles),
      score: confirmed.payload.score,
      events: seen,
      state: snapshotState(state),
      trace,
    };
  } finally {
    if (previousValidator) globalThis.HebrewValidator = previousValidator;
    else delete globalThis.HebrewValidator;
  }
}

function traceNewDecision({ state, placed, validator, scoring, dict }) {
  const trace = [{ phase: 'moveTiles', tiles: normalizeTiles(placed) }];
  const validation = validator.validateMove(state, placed);
  trace.push({ phase: 'validationResult', ok: !!validation.ok, reason: validation.reason });
  if (!validation.ok) {
    trace.push({ phase: 'reject', reason: validation.reason });
    return trace;
  }
  const words = scoring.getAllWords(state, placed);
  trace.push({ phase: 'words', words: words.map(wordText), wordTiles: normalizeWords(words) });
  if (!words.length || words[0].length < 2) {
    trace.push({ phase: 'reject', reason: 'word-too-short' });
    return trace;
  }
  const invalidWords = words.map(wordText).filter(w => !dict.isValid(w));
  trace.push({ phase: 'dictionary', invalidWords });
  if (invalidWords.length) {
    trace.push({ phase: 'reject', reason: 'word-not-in-dictionary', invalidWords });
    return trace;
  }
  trace.push({ phase: 'score', score: scoring.scoreMove(words, placed.length), placedCount: placed.length });
  return trace;
}

function assertMoveParity(name, legacy, actual) {
  const comparable = actual.ok
    ? { ok: actual.ok, words: actual.words, wordTiles: actual.wordTiles, score: actual.score }
    : { ok: actual.ok, reason: actual.reason };
  if (!actual.ok && (legacy.invalidWords || actual.invalidWords?.length)) comparable.invalidWords = actual.invalidWords || [];
  const expected = legacy.ok
    ? { ok: legacy.ok, words: legacy.words, wordTiles: legacy.wordTiles, score: legacy.score }
    : { ok: legacy.ok, reason: legacy.reason, ...(legacy.invalidWords ? { invalidWords: legacy.invalidWords } : {}) };
  assert.deepEqual(comparable, expected, `${name} diverged from legacy golden master`);
}

function assertTraceParity(name, legacyTrace = [], actualTrace = []) {
  assert.deepEqual(normalizeEssentialTrace(actualTrace), normalizeEssentialTrace(legacyTrace), `${name} intermediate decision trace diverged`);
}

function normalizeEssentialTrace(trace) {
  const out = [];
  const reject = (trace || []).find(s => s.phase === 'reject');
  const validation = (trace || []).find(s => s.phase === 'validationResult');
  if (validation) out.push(validation);
  else out.push({
    phase: 'validationResult',
    ok: !reject || ['word-too-short', 'word-not-in-dictionary'].includes(reject.reason),
    reason: reject && !['word-too-short', 'word-not-in-dictionary'].includes(reject.reason) ? reject.reason : undefined,
  });
  for (const step of trace || []) {
    if (step.phase === 'moveTiles') out.push(step);
    if (step.phase === 'words') out.push({ phase: 'words', words: step.words, wordTiles: step.wordTiles });
    if (step.phase === 'dictionary') out.push(step);
    if (step.phase === 'score') out.push(step);
    if (step.phase === 'reject') out.push(step);
  }
  return out;
}

const moveFixtures = [
  { name: 'empty move is illegal', firstMove: true, dictWords: ['אב'], placed: [] },
  { name: 'non-collinear tiles are illegal', firstMove: true, dictWords: ['אב'], placed: [tile(4, 4, 'א'), tile(5, 5, 'ב')] },
  { name: 'unfilled gap is illegal', firstMove: true, dictWords: ['אב'], placed: [tile(4, 4, 'א'), tile(4, 6, 'ב')] },
  {
    name: 'valid first move commits a two-letter word',
    firstMove: true,
    dictWords: ['אב'],
    placed: [tile(4, 4, 'א'), tile(4, 5, 'ב')],
  },
  {
    name: 'first move on a bonus square is illegal',
    firstMove: true,
    dictWords: ['אב'],
    placed: [tile(-1, 1, 'א'), tile(-1, 2, 'ב')],
  },
  {
    name: 'disconnected second move is illegal',
    firstMove: false,
    dictWords: ['אב'],
    board: withTiles([[0, 0, 'ג']]),
    placed: [tile(5, 5, 'א'), tile(5, 6, 'ב')],
  },
  {
    name: 'gap filled by a committed tile is legal',
    firstMove: false,
    dictWords: ['אבג'],
    board: withTiles([[4, 5, 'ב']]),
    placed: [tile(4, 4, 'א'), tile(4, 6, 'ג')],
  },
  {
    name: 'cross-word detection and scoring match',
    firstMove: false,
    dictWords: ['אב', 'דבה'],
    board: withTiles([[3, 5, 'ד'], [5, 5, 'ה']]),
    placed: [tile(4, 4, 'א'), tile(4, 5, 'ב')],
  },
  {
    name: 'eight-tile bingo adds fifty points',
    firstMove: true,
    dictWords: ['אבגדהוזח'],
    rack: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'],
    placed: [
      tile(4, 0, 'א'), tile(4, 1, 'ב'), tile(4, 2, 'ג'), tile(4, 3, 'ד'),
      tile(4, 4, 'ה'), tile(4, 5, 'ו'), tile(4, 6, 'ז'), tile(4, 7, 'ח'),
    ],
  },
  {
    name: 'dictionary accepts terminal final-letter variant',
    firstMove: true,
    dictWords: ['ספרן'],
    placed: [tile(4, 4, 'ס'), tile(4, 5, 'פ'), tile(4, 6, 'ר'), tile(4, 7, 'נ')],
  },
  {
    name: 'single tile beside existing tile forms a word',
    firstMove: false,
    dictWords: ['אב'],
    board: withTiles([[4, 4, 'א']]),
    placed: [tile(4, 5, 'ב')],
  },
  {
    name: 'board edge word is legal',
    firstMove: true,
    dictWords: ['אב'],
    placed: [tile(0, 8, 'א'), tile(0, 9, 'ב')],
  },
  {
    name: 'invalid cross-word mixed with valid main word is rejected',
    firstMove: false,
    dictWords: ['אב'],
    board: withTiles([[3, 5, 'ד'], [5, 5, 'ה']]),
    placed: [tile(4, 4, 'א'), tile(4, 5, 'ב')],
  },
  {
    name: 'joker tile scores zero inside legal word',
    firstMove: true,
    dictWords: ['לב'],
    rack: ['?', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'],
    placed: [tile(4, 4, 'ל', 0, true), tile(4, 5, 'ב')],
  },
  {
    name: 'bonus square after first move can form an off-grid word',
    firstMove: false,
    dictWords: ['בא'],
    board: withTiles([[0, 1, 'א']]),
    placed: [tile(-1, 1, 'ב')],
  },
  {
    name: 'boost active but invalid move does not affect legality',
    firstMove: true,
    dictWords: ['אב'],
    activeBoosts: [{ slot: 0, boostId: 'multiply_next_turns', payload: { multiplier: 2, turnsRemaining: 1 }, turnNumber: 1 }],
    placed: [tile(4, 4, 'א'), tile(5, 5, 'ב')],
  },
];

for (const fixture of moveFixtures) {
  test(`golden parity: ${fixture.name}`, async () => {
    const legacy = evaluateLegacyMove(fixture);
    const actual = await evaluateNewMove(fixture);
    assertMoveParity(fixture.name, legacy, actual);
    assertTraceParity(fixture.name, legacy.trace, actual.trace);
  });
}

test('successful move preserves legacy board, rack, score, and turn updates', async () => {
  const fixture = {
    firstMove: true,
    dictWords: ['אב'],
    rack: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'],
    bag: ['ט', 'י'],
    placed: [tile(4, 4, 'א'), tile(4, 5, 'ב')],
  };
  const actual = await evaluateNewMove(fixture);
  assert.equal(actual.ok, true);
  assert.equal(actual.state.scores[0], 4);
  assert.equal(actual.state.board['4,4'].letter, 'א');
  assert.equal(actual.state.board['4,5'].letter, 'ב');
  assert.equal(actual.state.currentTurnSlot, 1);
  assert.equal(actual.state.turnNumber, 2);
  assert.equal(actual.state.firstMove, false);
  assert.deepEqual(actual.state.racks[0].sort(), ['ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י'].sort());
});

test('timer helper parity: formatting and ceil-based seconds left match legacy', () => {
  const ctx = legacyContext({});
  vm.runInContext(extractFunction('formatTimerSec'), ctx);
  vm.runInContext(extractFunction('computeTurnSecondsLeft'), ctx);
  ctx.fbServerTimeOffsetMs = 0;
  assert.equal(ctx.formatTimerSec(65), '01:05');
  assert.equal(ctx.formatTimerSec(-10), '00:00');
  assert.equal(ctx.computeTurnSecondsLeft(12_001, 10_002), 2);
  assert.equal(ctx.computeTurnSecondsLeft(12_000, 12_000), 0);
});

test('exchange parity: regular exchange advances turn and keeps rack size', async () => {
  const { engine, commands, events, bus, boosts } = await loadModules();
  boosts._resetAndRegister();
  bus._reset();
  const state = engine.createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'exchange-parity',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
  });
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.bag = ['ט', 'י'];
  const seen = [];
  Object.values(events.EV).forEach(type => bus.on(type, payload => seen.push({ type, payload })));
  engine.createEngine({ state, bus }).dispatch({ type: commands.CMD.EXCHANGE_TILE, payload: { letters: ['א', 'ב'] } });
  assert.equal(state.racks[0].length, 8);
  assert.equal(state.currentTurnSlot, 1);
  assert.equal(state.turnNumber, 2);
  assert.ok(seen.some(e => e.type === events.EV.TILES_EXCHANGED));
});

test('free exchange parity: requires matching active free swap and does not advance turn', async () => {
  const { engine, commands, events, bus, boosts } = await loadModules();
  boosts._resetAndRegister();
  bus._reset();
  const state = engine.createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'free-exchange-parity',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
  });
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.bag = ['ט'];
  state.activeBoosts = [{ slot: 0, boostId: 'free_tile_swap', payload: {}, turnNumber: 1 }];
  const seen = [];
  Object.values(events.EV).forEach(type => bus.on(type, payload => seen.push({ type, payload })));
  engine.createEngine({ state, bus }).dispatch({ type: commands.CMD.EXCHANGE_TILE, payload: { letters: ['א'], freeSwap: true } });
  assert.equal(state.racks[0].length, 8);
  assert.equal(state.currentTurnSlot, 0);
  assert.equal(state.turnNumber, 1);
  assert.equal(state.activeBoosts.length, 0);
  assert.ok(seen.some(e => e.type === events.EV.TILES_EXCHANGED && e.payload.free === true));
});

test('scenario replay parity: complete sequence with restore checkpoint', async () => {
  const { engine, commands, events, bus, dict, board, boosts, schema } = await loadModules();
  boosts._resetAndRegister();
  bus._reset();
  dict.DICT.clear();
  dict.addWordsFromText(['אב', 'אבג', 'דבה', 'הו', 'לב'].join('\n'));

  const legacy = makeLegacyReplayState({
    rack0: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'],
    rack1: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'],
    bag: ['ט', 'י', 'כ', 'ל', 'מ', 'נ'],
    exchangeSeed: 12345,
  });
  const state = engine.createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'scenario-replay',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
  });
  state.racks = { 0: [...legacy.racks[0]], 1: [...legacy.racks[1]] };
  state.bag = [...legacy.bag];
  state.exchangeRng = makeDeterministicRng(12345);
  Object.values(events.EV).forEach(type => bus.on(type, () => {}));
  const eng = engine.createEngine({ state, bus });

  replayMove('first move', legacy, eng, commands, [tile(4, 4, 'א'), tile(4, 5, 'ב')]);
  compareReplayState('after first move', legacy, state);
  replayInvalidMove('invalid disconnected move', legacy, eng, commands, [tile(8, 8, 'ה'), tile(8, 9, 'ו')]);
  compareReplayState('after invalid move', legacy, state);

  replayMove('touching extension', legacy, eng, commands, [tile(4, 6, 'ג')]);
  compareReplayState('after touching extension', legacy, state);

  replayExchange('regular exchange', legacy, eng, commands, [legacy.racks[legacy.turn][0]]);
  compareReplayState('after exchange', legacy, state);
  replayPass('single pass', legacy, eng, commands);
  compareReplayState('after pass', legacy, state);

  const restored = schema.deserializeBoard(schema.serializeBoard(state.board));
  assert.deepEqual(restored, state.board, 'online board serialize/restore changed board tiles');
});

test('turn parity: legacy does not end the game after only two consecutive passes', async () => {
  const { engine, commands, events, bus, boosts } = await loadModules();
  boosts._resetAndRegister();
  bus._reset();
  const state = engine.createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'pass-parity',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
  });
  const seen = [];
  Object.values(events.EV).forEach(type => bus.on(type, payload => seen.push({ type, payload })));
  const eng = engine.createEngine({ state, bus });
  eng.dispatch({ type: commands.CMD.PASS_TURN });
  eng.dispatch({ type: commands.CMD.PASS_TURN });
  assert.equal(
    seen.some(e => e.type === events.EV.GAME_COMPLETED),
    false,
    'legacy nextTurn/expireCurrentMove uses passCount >= 6 before ending; modular engine completed after two passes',
  );
});

test('turn parity: legacy completes only after six consecutive passes or timeouts', async () => {
  const { engine, commands, events, bus, boosts } = await loadModules();
  boosts._resetAndRegister();
  bus._reset();
  const state = engine.createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'six-pass-parity',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
  });
  const seen = [];
  Object.values(events.EV).forEach(type => bus.on(type, payload => seen.push({ type, payload })));
  const eng = engine.createEngine({ state, bus });
  for (let i = 0; i < 5; i++) eng.dispatch({ type: commands.CMD.PASS_TURN });
  assert.equal(state.status, 'playing');
  assert.equal(seen.some(e => e.type === events.EV.GAME_COMPLETED), false);
  eng.dispatch({ type: commands.CMD.PASS_TURN });
  assert.equal(state.status, 'completed');
  assert.equal(seen.some(e => e.type === events.EV.GAME_COMPLETED), true);
});

test('lock parity: new games start with the legacy [3,3,5] lock inventory', async () => {
  const { engine } = await loadModules();
  const state = engine.createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'lock-inventory-parity',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
  });
  assert.deepEqual(state.lockInventory, { 0: [3, 3, 5], 1: [3, 3, 5] });
});

test('timeout parity: timeout forfeits active score multiplier and advances as a pass', async () => {
  const { engine, commands, events, bus, boosts } = await loadModules();
  boosts._resetAndRegister();
  bus._reset();
  const state = engine.createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'timeout-parity',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
  });
  state.activeBoosts = [{ slot: 0, boostId: 'multiply_next_turns', payload: { multiplier: 4, turnsRemaining: 1 }, turnNumber: 1 }];
  const seen = [];
  Object.values(events.EV).forEach(type => bus.on(type, payload => seen.push({ type, payload })));
  engine.createEngine({ state, bus }).dispatch({ type: commands.CMD.PASS_TURN, payload: { reason: 'timeout' } });
  assert.deepEqual(state.activeBoosts, []);
  assert.equal(state.passCount, 1);
  assert.equal(state.currentTurnSlot, 1);
  assert.ok(seen.some(e => e.type === events.EV.BOOST_ACTIVATED && e.payload.reason === 'timeout' && e.payload.consumed === true));
});

test('illegal-word parity: illegal-word forfeit consumes active score multiplier', async () => {
  const { engine, commands, events, bus, boosts } = await loadModules();
  boosts._resetAndRegister();
  bus._reset();
  const state = engine.createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'illegal-multiplier-parity',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
  });
  state.activeBoosts = [{ slot: 0, boostId: 'multiply_next_turns', payload: { multiplier: 2, turnsRemaining: 1 }, turnNumber: 1 }];
  const seen = [];
  Object.values(events.EV).forEach(type => bus.on(type, payload => seen.push({ type, payload })));
  engine.createEngine({ state, bus }).dispatch({ type: commands.CMD.PASS_TURN, payload: { reason: 'illegal-word' } });
  assert.deepEqual(state.activeBoosts, []);
  assert.equal(state.passCount, 0);
  assert.equal(state.currentTurnSlot, 1);
  assert.ok(seen.some(e => e.type === events.EV.BOOST_ACTIVATED && e.payload.reason === 'illegal-word' && e.payload.consumed === true));
});

test('bonus parity: valid move on unused auto bonus square activates and marks used once', async () => {
  const { engine, commands, events, bus, dict, board, boosts } = await loadModules();
  boosts._resetAndRegister();
  bus._reset();
  dict.DICT.clear();
  dict.addWordsFromText('בא');
  const state = engine.createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'bonus-auto-parity',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
  });
  state.firstMove = false;
  state.racks[0] = ['ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  state.bag = [];
  state.bonusAssignment[0] = { type: 'B2' };
  board.setCommittedTile(state, 0, 1, { letter: 'א', val: 1, isJoker: false });
  const seen = [];
  Object.values(events.EV).forEach(type => bus.on(type, payload => seen.push({ type, payload })));
  engine.createEngine({ state, bus }).dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: [tile(-1, 1, 'ב')] } });
  assert.equal(state.bonusSqUsed[0], true);
  assert.equal(state.scores[0], 0, 'move score and auto bonus wait for FINALIZE_BOOST_AWARD, as in the overlay flow');
  assert.equal(state.pendingScoreCommit?.baseScore, 4);
  assert.ok(seen.some(e => e.type === events.EV.BOOST_ACTIVATED && e.payload.boostId === 'auto_extra_score' && e.payload.payload.extra === 20));
});

test('bonus parity: future and minigame bonus squares are represented in engine state', async () => {
  const { engine, commands, events, bus, dict, board, boosts } = await loadModules();
  boosts._resetAndRegister();
  bus._reset();
  dict.DICT.clear();
  dict.addWordsFromText('בא\nגא');
  const state = engine.createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'bonus-future-parity',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
  });
  state.firstMove = false;
  state.racks[0] = ['ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  state.racks[1] = ['ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י'];
  state.bag = [];
  state.bonusAssignment[0] = { type: 'B5' };
  state.bonusAssignment[1] = { type: 'B1' };
  board.setCommittedTile(state, 0, 1, { letter: 'א', val: 1, isJoker: false });
  board.setCommittedTile(state, 0, 5, { letter: 'א', val: 1, isJoker: false });
  const seen = [];
  Object.values(events.EV).forEach(type => bus.on(type, payload => seen.push({ type, payload })));
  const eng = engine.createEngine({ state, bus });
  eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: [tile(-1, 1, 'ב')] } });
  assert.equal(state.currentTurnSlot, 0, 'B5 waits on the award acknowledgement before ending the triggering move');
  assert.equal(state.activeBoosts.some(b => b.boostId === 'extra_turn'), true);
  assert.equal(state.bonusSqUsed[0], true);
  eng.dispatch({ type: commands.CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, bonusIdx: 0, extra: 0 } });
  assert.equal(state.currentTurnSlot, 0, 'B5 extra-turn fires when the award is acknowledged');
  assert.equal(state.activeBoosts.some(b => b.boostId === 'extra_turn'), false);

  state.currentTurnSlot = 1;
  state.turnNumber += 1;
  eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: [tile(-1, 5, 'ג')] } });
  assert.equal(state.bonusSqUsed[1], true);
  assert.ok(state.pendingBonuses.some(p => p.idx === 1 && p.kind === 'minigame'));
  assert.ok(seen.some(e => e.type === events.EV.BONUS_PENDING && e.payload.idx === 1));
});

test('online serialization parity: bonus assignment, used flags, pending bonuses, and bonus-board tiles survive restore', async () => {
  const { engine, board, schema, roomService } = await loadModules();
  const state = engine.createInitialState({
    mode: 'friend-live',
    tileBagSeed: 'bonus-serialize-parity',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
  });
  state.bonusAssignment = [{ type: 'B2' }, { type: 'B5' }];
  state.bonusSqUsed = { 0: true };
  state.pendingBonuses = [{ idx: 1, bonusType: 'B1', slot: 0, turnNumber: 3, kind: 'minigame' }];
  board.setCommittedTile(state, -1, 1, { letter: 'ב', val: 3, isJoker: false });
  const room = schema.buildRoomDoc({
    roomId: 'bonus-room',
    mode: 'friend-live',
    players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
    engineState: state,
    createdAt: 1,
  });
  const restored = roomService.engineStateFromRoom(room);
  assert.deepEqual(restored.bonusAssignment, state.bonusAssignment);
  assert.deepEqual(restored.bonusSqUsed, state.bonusSqUsed);
  assert.deepEqual(restored.pendingBonuses, state.pendingBonuses);
  assert.deepEqual(Object.fromEntries(restored.bonusBoard.entries()), Object.fromEntries(state.bonusBoard.entries()));
});

test('fuzz parity: 1000 deterministic random scenarios agree with legacy move oracle', async () => {
  const cases = buildGeometryFuzzCases(1000);
  for (const fixture of cases) {
    const legacy = evaluateLegacyMove(fixture);
    const actual = await evaluateNewMove(fixture);
    assertMoveParity(fixture.name, legacy, actual);
  }
});

test('randomized differential audit reports all 1000 traced scenarios with no unclassified mismatch', async () => {
  const cases = buildGeometryFuzzCases(1000);
  const mismatches = [];
  for (const fixture of cases) {
    const legacy = evaluateLegacyMove(fixture);
    const actual = await evaluateNewMove(fixture);
    try {
      assertMoveParity(fixture.name, legacy, actual);
      assertTraceParity(fixture.name, legacy.trace, actual.trace);
    } catch (err) {
      mismatches.push({ name: fixture.name, message: err.message, legacy: stripTrace(legacy), actual: stripTrace(actual) });
    }
  }
  assert.deepEqual(mismatches, [], 'randomized differential parity mismatches');
});

function buildGeometryFuzzCases(count) {
  let seed = 0xC0FFEE;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const cases = [];
  for (let i = 0; i < count; i++) {
    const firstMove = rnd() < 0.45;
    const len = 1 + Math.floor(rnd() * 5);
    const horizontal = rnd() < 0.5;
    const baseR = Math.floor(rnd() * 10);
    const baseC = Math.floor(rnd() * 10);
    const gap = rnd() < 0.25 ? 1 : 0;
    const scatter = rnd() < 0.18;
    const placed = [];
    for (let j = 0; j < len; j++) {
      const letter = HEB[(i + j) % HEB.length];
      if (scatter) placed.push(tile((baseR + j) % 10, (baseC + j) % 10, letter));
      else placed.push(tile(horizontal ? baseR : Math.min(9, baseR + j + gap), horizontal ? Math.min(9, baseC + j + gap) : baseC, letter));
    }
    if (i % 13 === 0) placed[0] = tile(-1, 1, placed[0].letter);
    const board = emptyBoard();
    if (!firstMove) {
      const ar = Math.max(0, Math.min(9, placed[0].r));
      const ac = Math.max(0, Math.min(9, placed[0].c - 1));
      board[ar][ac] = { letter: 'ת', val: HV['ת'], isJoker: false };
    }
    const randomCommitted = Math.floor(rnd() * 6);
    for (let k = 0; k < randomCommitted; k++) {
      const rr = Math.floor(rnd() * 10);
      const cc = Math.floor(rnd() * 10);
      if (!placed.some(p => p.r === rr && p.c === cc)) {
        const l = HEB[(i + k + 7) % HEB.length];
        board[rr][cc] = { letter: l, val: HV[l] || 1, isJoker: false };
      }
    }
    cases.push({
      name: `fuzz-${i}`,
      firstMove,
      board,
      placed,
      rack: randomRackFor(placed, rnd),
      turn: rnd() < 0.5 ? 0 : 1,
      bag: HEB.slice(0, Math.floor(rnd() * 8)),
      permissiveDictionary: true,
    });
  }
  return cases;
}

function tile(r, c, letter, val = HV[letter] || 1, isJoker = false) {
  return { r, c, letter, val, isJoker };
}

function wordText(word) {
  return word.map(t => t.letter).join('');
}

function normalizeWords(words) {
  return Array.from(words, w => Array.from(w, t => ({ r: t.r, c: t.c, letter: t.letter, val: t.val })));
}

function normalizeTiles(tiles) {
  return Array.from(tiles || [], t => ({ r: t.r, c: t.c, letter: t.letter, val: t.val, isJoker: !!t.isJoker }));
}

function emptyBoard() {
  return Array.from({ length: 10 }, () => Array(10).fill(null));
}

function withTiles(entries) {
  const board = emptyBoard();
  for (const [r, c, letter] of entries) board[r][c] = { letter, val: HV[letter] || 1, isJoker: false };
  return board;
}

function rackFor(placed) {
  const rack = placed.map(p => (p.isJoker ? '?' : p.letter));
  for (const l of HEB) {
    if (rack.length >= 8) break;
    rack.push(l);
  }
  return rack;
}

function randomRackFor(placed, rnd) {
  const rack = rackFor(placed);
  while (rack.length < 8) rack.push(HEB[Math.floor(rnd() * HEB.length)]);
  return rack.slice(0, 8);
}

function snapshotState(state) {
  const board = {};
  for (let r = 0; r < state.board.length; r++) {
    for (let c = 0; c < state.board[r].length; c++) {
      if (state.board[r][c]) board[`${r},${c}`] = state.board[r][c];
    }
  }
  return {
    board,
    bonusBoard: Object.fromEntries(state.bonusBoard.entries()),
    racks: { 0: [...state.racks[0]], 1: [...state.racks[1]] },
    scores: { ...state.scores },
    currentTurnSlot: state.currentTurnSlot,
    turnNumber: state.turnNumber,
    firstMove: state.firstMove,
    passCount: state.passCount,
    moveCount: state.moveCount,
    status: state.status,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  return JSON.parse(JSON.stringify(payload));
}

function stripTrace(result) {
  const { trace, events, state, ...rest } = result;
  return rest;
}

function makeLegacyReplayState({ rack0, rack1, bag, exchangeSeed = 1 }) {
  return {
    board: emptyBoard(),
    bonusBoard: {},
    racks: { 0: [...rack0], 1: [...rack1] },
    bag: [...bag],
    scores: { 0: 0, 1: 0 },
    turn: 0,
    turnNumber: 1,
    firstMove: true,
    passCount: 0,
    moveCount: 0,
    exchangeRng: makeDeterministicRng(exchangeSeed),
  };
}

function makeDeterministicRng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

function legacyShuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function replayMove(label, legacy, eng, commands, placed) {
  const expected = evaluateLegacyMove({
    board: legacy.board,
    bonusBoard: legacy.bonusBoard,
    placed,
    firstMove: legacy.firstMove,
    dictWords: ['אב', 'אבג', 'אבגד', 'דבה', 'הו', 'לב'],
    rack: legacy.racks[legacy.turn],
  });
  assert.equal(expected.ok, true, `${label} legacy oracle rejected setup: ${expected.reason}`);
  eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: clone(placed) } });
  commitLegacyMove(legacy, placed, expected.score);
}

function replayInvalidMove(label, legacy, eng, commands, placed) {
  const expected = evaluateLegacyMove({
    board: legacy.board,
    bonusBoard: legacy.bonusBoard,
    placed,
    firstMove: legacy.firstMove,
    dictWords: ['אב', 'אבג', 'אבגד', 'דבה', 'הו', 'לב'],
    rack: legacy.racks[legacy.turn],
  });
  assert.equal(expected.ok, false, `${label} legacy oracle accepted setup unexpectedly`);
  eng.dispatch({ type: commands.CMD.CONFIRM_MOVE, payload: { placed: clone(placed) } });
}

function replayExchange(_label, legacy, eng, commands, letters) {
  eng.dispatch({ type: commands.CMD.EXCHANGE_TILE, payload: { letters } });
  const rack = legacy.racks[legacy.turn];
  for (const l of letters) {
    const idx = rack.indexOf(l);
    if (idx >= 0) rack.splice(idx, 1);
  }
  legacy.bag.unshift(...letters);
  legacyShuffle(legacy.bag, legacy.exchangeRng);
  while (rack.length < 8 && legacy.bag.length) rack.push(legacy.bag.pop());
  legacy.passCount = 0;
  legacy.turn = legacy.turn === 0 ? 1 : 0;
  legacy.turnNumber += 1;
}

function replayPass(_label, legacy, eng, commands) {
  eng.dispatch({ type: commands.CMD.PASS_TURN });
  legacy.passCount += 1;
  legacy.turn = legacy.turn === 0 ? 1 : 0;
  legacy.turnNumber += 1;
}

function commitLegacyMove(legacy, placed, score) {
  const slot = legacy.turn;
  for (const p of placed) {
    if (BDEFS.some(b => b.br === p.r && b.bc === p.c)) legacy.bonusBoard[`${p.r},${p.c}`] = { letter: p.letter, val: p.val, isJoker: !!p.isJoker };
    else legacy.board[p.r][p.c] = { letter: p.letter, val: p.val, isJoker: !!p.isJoker };
    const remove = p.isJoker ? '?' : p.letter;
    const idx = legacy.racks[slot].indexOf(remove);
    if (idx >= 0) legacy.racks[slot].splice(idx, 1);
  }
  legacy.scores[slot] += score;
  while (legacy.racks[slot].length < 8 && legacy.bag.length) legacy.racks[slot].push(legacy.bag.pop());
  legacy.firstMove = false;
  legacy.passCount = 0;
  legacy.moveCount += 1;
  legacy.turn = slot === 0 ? 1 : 0;
  legacy.turnNumber += 1;
}

function compareReplayState(label, legacy, state) {
  assert.deepEqual(snapshotState(state).board, snapshotBoardObject(legacy.board), `${label}: board mismatch`);
  assert.deepEqual(state.racks[0], legacy.racks[0], `${label}: rack 0 mismatch`);
  assert.deepEqual(state.racks[1], legacy.racks[1], `${label}: rack 1 mismatch`);
  assert.deepEqual(state.scores, legacy.scores, `${label}: scores mismatch`);
  assert.equal(state.currentTurnSlot, legacy.turn, `${label}: turn mismatch`);
  assert.equal(state.firstMove, legacy.firstMove, `${label}: firstMove mismatch`);
}

function snapshotBoardObject(board2d) {
  const board = {};
  for (let r = 0; r < board2d.length; r++) {
    for (let c = 0; c < board2d[r].length; c++) {
      if (board2d[r][c]) board[`${r},${c}`] = board2d[r][c];
    }
  }
  return board;
}
