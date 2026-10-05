// Unit tests for the soak agents' pure modules: turn timing (deadline band),
// turn decisions, human behaviour (previews / lookups / reactions), mini-game
// outcome sampling, the oracle's move/agreement checks and failure dedupe.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let modulesPromise;
function load() {
  modulesPromise ??= (async () => {
    const [rng, engine, dict, timing, personas, decide, human, bonus, oracle, failures, defs, vocab] = await Promise.all([
      import('../../src/util/rng.js'),
      import('../../src/game/core/gameEngine.js'),
      import('../../src/game/core/hebrewDictionary.js'),
      import('../../scripts/simulator/agents/timing.mjs'),
      import('../../scripts/simulator/agents/personas.mjs'),
      import('../../scripts/simulator/agents/decide.mjs'),
      import('../../scripts/simulator/agents/humanBehavior.mjs'),
      import('../../scripts/simulator/agents/bonusOutcomes.mjs'),
      import('../../scripts/simulator/oracle/gameOracle.mjs'),
      import('../../scripts/simulator/oracle/failureCollector.mjs'),
      import('../../src/game/boosts/bonusTileDefs.js'),
      import('../../src/game/sessions/botVocabulary.js'),
    ]);
    if (!globalThis.__SIM_DICT_LOADED__) {
      dict.addWordsFromText(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'dictionary.txt'), 'utf8'));
      globalThis.__SIM_DICT_LOADED__ = true;
    }
    const botWords = vocab.parseBotWordsText
      ? vocab.parseBotWordsText(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'bot-words.txt'), 'utf8'))
      : [];
    const wordList = vocab.createBotWordList({ sourceWords: botWords, maxWordLen: 6, cap: 5000, isWordValid: (w) => dict.isValid(w) });
    return { rng, engine, dict, timing, personas, decide, human, bonus, oracle, failures, defs, wordList };
  })();
  return modulesPromise;
}

const PLAYERS = {
  0: { uid: 'a', displayName: 'A', joinedAt: 1 },
  1: { uid: 'b', displayName: 'B', joinedAt: 2 },
};

// ── timing ─────────────────────────────────────────────────────────────────

test('timing: phase shares follow persona weights and deadline turns cluster at the deadline', async () => {
  const { rng: R, timing, personas } = await load();
  const rng = R.createRng('timing-1');
  const persona = personas.PERSONAS.fastChatty;
  const limitMs = 20_000;
  const counts = {};
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const nowMs = 1_000_000;
    const deadlineMs = nowMs + limitMs;
    const plan = timing.planCommitTime({ rng, persona, nowMs, deadlineMs, limitMs, graceMs: 1000 });
    counts[plan.phase] = (counts[plan.phase] ?? 0) + 1;
    assert.ok(plan.atMs >= nowMs + 250, 'never schedules into the past');
    if (plan.phase === 'deadline') {
      assert.ok(Math.abs(plan.offsetFromDeadlineMs) <= 1500 + 1000, `deadline offset in band: ${plan.offsetFromDeadlineMs}`);
      assert.ok(timing.DEADLINE_EDGES.includes(plan.edge));
    }
    if (plan.phase === 'early') assert.ok(plan.atMs <= nowMs + limitMs * 0.3 + 1);
  }
  for (const [phase, w] of Object.entries(persona.timing)) {
    const share = (counts[phase] ?? 0) / N;
    assert.ok(Math.abs(share - w) < 0.04, `${phase} share ${share.toFixed(3)} ≈ ${w}`);
  }
});

test('timing: after-grace edge lands past the watchdog grace; untimed uses think range', async () => {
  const { rng: R, timing } = await load();
  const rng = R.createRng('timing-2');
  const persona = { timing: { deadline: 1 }, untimedThinkMs: [1000, 5000] };
  let sawAfter = false;
  for (let i = 0; i < 500; i++) {
    const p = timing.planCommitTime({ rng, persona, nowMs: 0, deadlineMs: 40_000, limitMs: 40_000, graceMs: 1000 });
    if (p.edge === 'afterGrace') { sawAfter = true; assert.ok(p.offsetFromDeadlineMs >= 1000 && p.offsetFromDeadlineMs <= 1500); }
    if (p.edge === 'before') assert.ok(p.offsetFromDeadlineMs < 0);
  }
  assert.ok(sawAfter);
  const u = timing.planCommitTime({ rng, persona, nowMs: 0, deadlineMs: null, limitMs: 0 });
  assert.equal(u.phase, 'untimed');
  assert.ok(u.atMs >= 1000 && u.atMs <= 5000);
  assert.equal(timing.offsetBucket(null), 'untimed');
  assert.equal(timing.offsetBucket(-100), '[-200,0)');
  assert.equal(timing.offsetBucket(1200), '[1000,1500)');
});

test('timing: spreadActions stays between now and the commit', async () => {
  const { rng: R, timing } = await load();
  const rng = R.createRng('spread');
  const t = timing.spreadActions({ rng, nowMs: 100, commitAtMs: 10_000, n: 6 });
  assert.equal(t.length, 6);
  for (let i = 0; i < t.length; i++) {
    assert.ok(t[i] >= 100 && t[i] < 10_000);
    if (i) assert.ok(t[i] >= t[i - 1]);
  }
});

// ── decide ─────────────────────────────────────────────────────────────────

test('decide: rack quality flags vowel-starved and duplicate-heavy racks', async () => {
  const { decide } = await load();
  assert.equal(decide.rackQuality(['ב', 'ג', 'ד', 'כ', 'ל', 'מ', 'נ', 'ס']).poor, true);
  assert.equal(decide.rackQuality(['ש', 'ש', 'ש', 'א', 'ל', 'מ', 'ו', 'ר']).poor, true);
  assert.equal(decide.rackQuality(['ש', 'ל', 'ו', 'מ', 'א', 'ר', 'ת', 'י']).poor, false);
  const rng = () => 0.3;
  const letters = decide.chooseExchangeLetters(['ש', 'ש', 'ש', 'א', 'ל', 'מ', 'ו', '?'], rng, 50);
  assert.ok(letters.length >= 1 && letters.length <= 7);
  assert.ok(!letters.includes('?'), 'never throws back a joker');
  assert.ok(decide.chooseExchangeLetters(['ש', 'ש', 'ש'], rng, 1).length <= 1, 'respects bag size');
});

test('decide: plays a real word when one exists, deterministic for a seed', async () => {
  const { rng: R, engine, decide, personas, dict, wordList } = await load();
  const state = engine.createInitialState({ mode: 'friend-live', tileBagSeed: 'decide-1', players: PLAYERS, settings: {} });
  const persona = { ...personas.PERSONAS.slowCareful, resignChance: 0, illegalWordChance: 0, walkAwayChance: 0, lockChance: 0, exchangeWhenPoorRack: 0 };
  const ctx = { wordList, isWordValid: (w) => dict.isValid(w), timed: true };
  const a = decide.decideTurn(state, state.currentTurnSlot, persona, R.createRng('d'), ctx);
  const b = decide.decideTurn(state, state.currentTurnSlot, persona, R.createRng('d'), ctx);
  assert.deepEqual(a, b);
  assert.ok(['move', 'exchange'].includes(a.kind));
  if (a.kind === 'move') assert.ok(dict.isValid(a.word));
});

test('decide: allow-list blocks resign / walk-away / illegal / lock', async () => {
  const { rng: R, engine, decide, dict, wordList } = await load();
  const state = engine.createInitialState({ mode: 'friend-live', tileBagSeed: 'decide-2', players: PLAYERS, settings: {} });
  state.scores = { 0: 100, 1: 100 };
  const persona = { difficulty: 1, resignChance: 1, walkAwayChance: 1, illegalWordChance: 1, lockChance: 1, exchangeWhenPoorRack: 0 };
  const ctx = { wordList, isWordValid: (w) => dict.isValid(w), timed: true, allow: { resign: false, walkAway: false, illegal: false, lock: false } };
  for (let i = 0; i < 20; i++) {
    const p = decide.decideTurn(state, state.currentTurnSlot, persona, R.createRng(`a${i}`), ctx);
    assert.ok(!['resign', 'walkAway', 'illegal', 'lockOnly'].includes(p.kind), p.kind);
    assert.ok(!p.lock);
  }
});

test('decide: never plans a free swap without owning the boost', async () => {
  const { rng: R, engine, decide, dict, wordList } = await load();
  const state = engine.createInitialState({ mode: 'friend-live', tileBagSeed: 'decide-3', players: PLAYERS, settings: {} });
  const persona = { difficulty: 1, resignChance: 0, walkAwayChance: 0, illegalWordChance: 0, lockChance: 0, exchangeWhenPoorRack: 1 };
  const ctx = { wordList, isWordValid: (w) => dict.isValid(w), timed: false };
  for (let i = 0; i < 20; i++) {
    const p = decide.decideTurn(state, state.currentTurnSlot, persona, R.createRng(`f${i}`), ctx);
    assert.equal(p.freeSwapLetters ?? null, null);
  }
  state.activeBoosts = [{ boostId: 'free_tile_swap', slot: state.currentTurnSlot }];
  const withSwap = Array.from({ length: 20 }, (_, i) => decide.decideTurn(state, state.currentTurnSlot, persona, R.createRng(`g${i}`), ctx));
  assert.ok(withSwap.some(p => p.freeSwapLetters?.length));
});

test('decide: pickLock respects the point cost and picks an empty cell', async () => {
  const { engine, decide } = await load();
  const state = engine.createInitialState({ mode: 'friend-live', tileBagSeed: 'lock', players: PLAYERS, settings: {} });
  const slot = state.currentTurnSlot;
  state.scores = { 0: 5, 1: 5 };
  assert.equal(decide.pickLock(state, slot, () => 0.5), null, 'below LOCK_POINT_COST');
  state.scores = { 0: 50, 1: 50 };
  state.board[5][5] = { letter: 'א', val: 1 };
  const lock = decide.pickLock(state, slot, () => 0.5);
  assert.ok(lock);
  assert.ok(!state.board[lock.r][lock.c]);
  assert.ok(state.lockInventory[slot].map(Number).includes(lock.duration));
});

// ── human behaviour ───────────────────────────────────────────────────────

test('human: every reaction id used by the agents exists in reactionsConfig', async () => {
  const { human, rng: R } = await load();
  assert.ok(human._allReactionIdsValid());
  const rng = R.createRng('react');
  for (const ctx of human.REACTION_CONTEXTS) assert.ok(human.chooseReaction(ctx, rng));
  assert.equal(human.chooseReaction('no-such-context', rng), null);
});

test('human: preview drafts build toward the final word; lookups include it', async () => {
  const { human, engine, rng: R } = await load();
  const state = engine.createInitialState({ mode: 'friend-live', tileBagSeed: 'prev', players: PLAYERS, settings: {} });
  const finalPlaced = [{ r: 4, c: 4, letter: 'ש', val: 1 }, { r: 4, c: 5, letter: 'ל', val: 1 }];
  const drafts = human.buildPreviewDrafts(state, finalPlaced, R.createRng('p'), [5, 5]);
  assert.equal(drafts.length, 5);
  for (const d of drafts) assert.ok(d.length >= 1);
  const lookups = human.buildLookups(['ש', 'ל', 'ו', 'ם'], 'שלום', () => 0.1, [3, 3]);
  assert.equal(lookups.length, 3);
  assert.ok(lookups.includes('שלום'));
});

// ── bonus outcomes ────────────────────────────────────────────────────────

test('bonus: mini-game outcomes stay within each game\'s real scoring; wheel ids are real', async () => {
  const { bonus, defs, rng: R } = await load();
  const rng = R.createRng('bonus');
  for (const key of Object.keys(bonus.MINIGAME_SPECS)) {
    for (let i = 0; i < 200; i++) {
      const o = bonus.sampleMiniGameOutcome(key, rng);
      assert.equal(typeof o.success, 'boolean');
      assert.ok(o.earnedPts >= 0 && o.earnedPts <= 100, `${key} ${o.earnedPts}`);
      if (!o.success) assert.equal(o.earnedPts, 0);
    }
  }
  const ids = new Set(defs.WHEEL_OUTCOMES.map(o => o.id));
  for (let i = 0; i < 100; i++) assert.ok(ids.has(bonus.sampleWheelOutcome(rng)));
  // Every minigame key the board can produce has a spec.
  for (const d of Object.values(defs.BONUS_TILE_DEFS)) {
    if (d.category === 'minigame') assert.ok(bonus.MINIGAME_SPECS[d.miniGameKey], d.miniGameKey);
  }
  const dwell = bonus.sampleMiniGameDwell('minigame', 'b8_crossword_60s', rng, { timeScale: 0.5 });
  assert.ok(dwell.playMs <= 30_000 && dwell.resultDwellMs > 0);
});

// ── oracle ────────────────────────────────────────────────────────────────

test('oracle: checkMoveEntries flags invalid words and score mismatches, accepts multipliers', async () => {
  const { oracle, dict } = await load();
  const isValid = (w) => dict.isValid(w);
  const wt = [[{ r: 4, c: 4, letter: 'ש', val: 1 }, { r: 4, c: 5, letter: 'ל', val: 2 }, { r: 4, c: 6, letter: 'ו', val: 1 }, { r: 4, c: 7, letter: 'ם', val: 3 }]];
  const good = { slot: 0, tiles: wt[0], words: ['שלום'], wordTiles: wt, score: 7 };
  assert.deepEqual(oracle.checkMoveEntries([good], isValid), []);
  assert.deepEqual(oracle.checkMoveEntries([{ ...good, score: 28 }], isValid), [], '×4 multiplier ok');
  const bad = oracle.checkMoveEntries([{ ...good, score: 9 }], isValid);
  assert.equal(bad[0].class, 'move-base-score-mismatch');
  const finalized = { ...good, baseScore: 7, bonusExtra: 40, score: 50 };
  assert.equal(oracle.checkMoveEntries([finalized], isValid)[0].class, 'move-total-mismatch');
  const word = oracle.checkMoveEntries([{ ...good, words: ['שלוםםםם'] }], isValid);
  assert.equal(word[0].class, 'move-invalid-word');
  assert.deepEqual(oracle.checkMoveEntries([{ ...good, score: 9 }], isValid, { fromIndex: 1 }), [], 'fromIndex skips old entries');
});

test('oracle: diffAgainstServer agrees with its own room and detects a score desync', async () => {
  const { oracle, engine } = await load();
  const { buildRoomDoc } = await import('../../src/game/online/schema.js');
  const { engineStateFromRoom } = await import('../../src/game/online/roomService.js');
  const st = engine.createInitialState({ mode: 'friend-live', tileBagSeed: 'diff', players: PLAYERS, settings: {} });
  const room = buildRoomDoc({ roomId: 'r1', mode: 'friend-live', players: PLAYERS, settings: {}, engineState: st, createdAt: 1 });
  const local = engineStateFromRoom(room);
  assert.deepEqual(oracle.diffAgainstServer(local, room, 0).diffs, []);
  local.scores[0] += 7;
  const { diffs } = oracle.diffAgainstServer(local, room, 0);
  assert.ok(diffs.some(d => d.startsWith('hostScore')));
});

test('failureCollector: signatures dedupe across games and bundles are capped', async () => {
  const { failures } = await load();
  const os = require('node:os');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-fail-'));
  const fc = failures.createFailureCollector({ outDir, runId: 'r', maxBundles: 2 });
  let built = 0;
  for (let g = 0; g < 5; g++) {
    fc.report({ gameId: `g${g}` }, [{ class: 'desync-hostScore', detail: `agent A (slot 0) v${40 + g}: hostScore: agent=${100 + g} server=${107 + g}` }], () => { built++; return { g }; });
  }
  const s = fc.summary();
  assert.equal(s.length, 1);
  assert.equal(s[0].games, 5);
  assert.equal(s[0].bundles.length, 2);
  assert.equal(built, 2);
  assert.equal(failures.normalizeDetail('room fc_179_abc agent B slot 1 שלום 42'), 'room <room> agent ? slot ? <heb> #');
  fs.rmSync(outDir, { recursive: true, force: true });
});

// ── network latency wrapper ───────────────────────────────────────────────

test('latency: writes and listener deliveries are delayed, FIFO, and off() detaches via a new ref', async () => {
  const { withLatency, sampleDelay, NETWORK_PROFILES } = await import('../../scripts/simulator/net/latency.mjs');
  const { makeMockDb } = await import('../../src/game/online/mockFirebase.js');
  const raw = makeMockDb();
  const db = withLatency(raw, { profile: 'wifi', rng: () => 0.5 });
  for (const p of Object.keys(NETWORK_PROFILES)) {
    const d = sampleDelay(p, () => 0.99);
    assert.ok(d > 0 && d <= 3500);
  }
  const seen = [];
  const h = (snap) => seen.push(snap.val());
  db.ref('rooms/x').on('value', h);
  const t0 = Date.now();
  await db.ref('rooms/x').set(1);
  assert.ok(Date.now() - t0 >= 15, 'uplink delayed');
  await db.ref('rooms/x').set(2);
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(seen.filter(v => v != null), [1, 2], 'delivered in order');
  db.ref('rooms/x').off('value', h); // a NEW ref object, like real callers
  await db.ref('rooms/x').set(3);
  await new Promise(r => setTimeout(r, 200));
  assert.ok(!seen.includes(3), 'listener detached');
  assert.equal(db.ref('.info/serverTimeOffset')._path, '.info/serverTimeOffset', '.info passes through unwrapped');
});
