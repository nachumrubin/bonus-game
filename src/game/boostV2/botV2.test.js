// Boost 2.0 bot (Phase 6): scoring, placement, setup, information discipline,
// determinism, and a full bot-vs-bot match through the real bot session.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { createEngine, createInitialState } from '../core/gameEngine.js';
import { DICT, addWordsFromText, isValid } from '../core/hebrewDictionary.js';
import { HV } from '../core/letterDistribution.js';
import { createRng } from '../../util/rng.js';
import { DIFFICULTY } from '../sessions/botSearch.js';
import { createLocalGameSession } from '../sessions/localGameSession.js';
import { attachBotPlayer } from '../sessions/botGameSession.js';
import * as busMod from '../../events/bus.js';
import { chooseV2Turn, chooseBoostSquares, accessScore, rackLeaveValue, leaveAfter } from './botV2.js';
import { PHASE, checkBoostV2Invariants } from './matchStateV2.js';
import { legalOpeningSquares } from './engineV2.js';

const _log = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _log; });

const WORDS = ['לא', 'שב', 'אב', 'בא', 'של', 'אל', 'לב'];
beforeEach(() => { DICT.clear(); addWordsFromText(WORDS.join('\n')); });

const PLAYERS = { 0: { uid: 'a' }, 1: { uid: 'b' } };
function fresh(seed = 'bot') {
  const state = createInitialState({ mode: 'offline-solo', tileBagSeed: seed, players: PLAYERS, ruleset: 'BOOST_V2', boostQueueRng: createRng(`${seed}/q`) });
  state.exchangeRng = createRng(`${seed}/x`);
  const events = [];
  const eng = createEngine({ state, bus: { emit: (type, payload) => events.push({ type, payload }) } });
  return { state, eng, events };
}
function setRack(state, slot, letters) {
  state.bag.push(...state.racks[slot]);
  state.racks[slot] = [];
  for (const l of letters) state.racks[slot].push(state.bag.splice(state.bag.lastIndexOf(l), 1)[0]);
}
function putOnBoard(state, cells) {
  for (const [r, c, l] of cells) {
    state.bag.splice(state.bag.lastIndexOf(l), 1);
    state.board[r][c] = { letter: l, val: HV[l], isJoker: false };
  }
  state.firstMove = false;
}
function activate(state, boosts) {
  const v2 = state.boostV2;
  v2.phase = PHASE.NORMAL;
  for (const { defId, r, c } of boosts) {
    const q = v2.queue;
    const i = q.entries.findIndex((e, k) => k >= q.cursor && e.definitionId === defId);
    const [e] = q.entries.splice(i, 1);
    q.entries.splice(q.cursor, 0, e);
    q.cursor += 1;
    v2.activeBoosts.push({ instanceId: e.instanceId, definitionId: defId, effectiveDefinitionId: defId, r, c, placedOnTurn: 1, placedBySlot: 0 });
  }
}

test('rack leave: jokers good, duplicates and vowel-only / consonant-only racks bad', () => {
  assert.ok(rackLeaveValue(['?', 'ל']) > rackLeaveValue(['ל', 'ל']));
  assert.ok(rackLeaveValue(['א', 'ל', 'ת']) > rackLeaveValue(['ל', 'ת', 'ר']));
  assert.ok(rackLeaveValue(['א', 'ל', 'ת']) > rackLeaveValue(['א', 'ו', 'י']));
  assert.deepEqual(leaveAfter(['א', 'ב', '?'], [{ letter: 'ג', isJoker: true }, { letter: 'א' }]), ['ב']);
});

test('placement heuristic: defensive picks the least reachable square, favourMover the most; distinct, deterministic', () => {
  const { state } = fresh();
  putOnBoard(state, [[4, 4, 'ל']]);
  assert.equal(accessScore(state.board, { r: 4, c: 5 }), 4);
  assert.equal(accessScore(state.board, { r: 4, c: 6 }), 1);
  const legal = [{ r: 4, c: 5 }, { r: 4, c: 6 }, { r: 5, c: 4 }]; // access 4, 1, 4
  assert.deepEqual(chooseBoostSquares(state, legal, 1, { difficulty: DIFFICULTY.HARD, rng: createRng('a') }), [{ r: 4, c: 6 }]);
  const [fav] = chooseBoostSquares(state, legal, 1, { difficulty: DIFFICULTY.HARD, rng: createRng('a'), favourMover: true });
  assert.equal(accessScore(state.board, fav), 4);
  const two = chooseBoostSquares(state, legal, 2, { difficulty: DIFFICULTY.EASY, rng: createRng('e') });
  assert.equal(new Set(two.map(s => `${s.r},${s.c}`)).size, 2);
  assert.deepEqual(two, chooseBoostSquares(state, legal, 2, { difficulty: DIFFICULTY.EASY, rng: createRng('e') }));
  // The move's own tiles count: (4,6) becomes reachable once (4,5) is filled.
  assert.equal(accessScore(state.board, { r: 4, c: 6 }, [{ r: 4, c: 5 }]), 4 + 1);
});

test('opening move always covers a centre square (every difficulty)', () => {
  for (const d of [0, 1, 2]) {
    const { state } = fresh(`open${d}`);
    setRack(state, 0, ['ל', 'א', 'ב', 'ש']);
    const a = chooseV2Turn(state, 0, WORDS, isValid, { difficulty: d, rng: createRng('o') });
    assert.equal(a.type, 'move');
    assert.ok(a.placed.some(p => [[4, 4], [4, 5], [5, 4], [5, 5]].some(([r, c]) => p.r === r && p.c === c)), `difficulty ${d}`);
  }
});

test('the Boost reward is part of the score: hard finds the best move, which completes the Boost', () => {
  const { state } = fresh();
  setRack(state, 0, ['א', 'ב']);
  putOnBoard(state, [[4, 3, 'ש'], [4, 4, 'ל']]);
  // Word Edge START ל at (5,4). Best move: "בא" across row 5 — words בא (4),
  // שב (6), לא (3, starts with ל → completes the Boost +5) = 18. The best
  // plain alternative (no Boost) is "שב" down from ש = 6.
  activate(state, [{ defId: 'BST-006:EASY:START:ל', r: 5, c: 4 }, { defId: 'BST-002:EASY:4', r: 2, c: 8 }, { defId: 'BST-002:EASY:4', r: 6, c: 8 }]);
  const a = chooseV2Turn(state, 0, WORDS, isValid, { difficulty: DIFFICULTY.HARD, rng: createRng('h') });
  assert.equal(a.type, 'move');
  assert.equal(a.breakdown.boostScore, 5);
  assert.equal(a.score, 18);
  assert.equal(a.boostPlacements.length, 1, 'the consumed Boost is replaced');
});

test('the chosen move + replacements are accepted by the engine', () => {
  const { state, eng, events } = fresh();
  setRack(state, 0, ['א', 'ב']);
  putOnBoard(state, [[4, 3, 'ש'], [4, 4, 'ל']]);
  activate(state, [{ defId: 'BST-006:EASY:START:ל', r: 5, c: 4 }, { defId: 'BST-002:EASY:4', r: 2, c: 8 }, { defId: 'BST-002:EASY:4', r: 6, c: 8 }]);
  for (const d of [0, 1, 2]) {
    const a = chooseV2Turn(state, 0, WORDS, isValid, { difficulty: d, rng: createRng(`d${d}`) });
    assert.equal(a.type, 'move');
  }
  const a = chooseV2Turn(state, 0, WORDS, isValid, { difficulty: DIFFICULTY.HARD, rng: createRng('h') });
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: a.placed, boostPlacements: a.boostPlacements } });
  assert.equal(events.filter(e => e.type === EV.INVALID_MOVE_REJECTED).length, 0);
  assert.equal(state.boostV2.activeBoosts.length, 3);
  assert.deepEqual(checkBoostV2Invariants(state), []);
});

test('opening setup: the bot places on a legal square; prefers reachable squares when it moves next', () => {
  const { state, eng } = fresh();
  setRack(state, 0, ['ל', 'א']);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [{ r: 4, c: 4, letter: 'ל' }, { r: 4, c: 5, letter: 'א' }] } });
  eng.dispatch({ type: CMD.PASS_TURN });
  assert.equal(state.boostV2.phase, PHASE.OPENING_SETUP);
  const slot = state.currentTurnSlot; // second player (1); returnSlot is 0
  const a = chooseV2Turn(state, slot, WORDS, isValid, { difficulty: DIFFICULTY.HARD, rng: createRng('s') });
  assert.equal(a.type, 'setup');
  assert.ok(legalOpeningSquares(state).some(s => s.r === a.r && s.c === a.c));
  assert.equal(accessScore(state.board, a), Math.min(...legalOpeningSquares(state).map(s => accessScore(state.board, s))), 'defensive: the opponent moves first after setup');
  eng.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: a });
  const b = chooseV2Turn(state, state.currentTurnSlot, WORDS, isValid, { difficulty: DIFFICULTY.HARD, rng: createRng('s') });
  assert.equal(accessScore(state.board, b), Math.max(...legalOpeningSquares(state).map(s => accessScore(state.board, s))), 'the starting player moves first after setup → reachable');
});

test('no hidden information: opponent rack, bag contents and hidden queue cards never change the decision', () => {
  const { state } = fresh('hid');
  setRack(state, 0, ['א', 'ב']);
  putOnBoard(state, [[4, 3, 'ש'], [4, 4, 'ל']]);
  activate(state, [{ defId: 'BST-006:EASY:START:ל', r: 5, c: 4 }, { defId: 'BST-002:EASY:4', r: 2, c: 8 }, { defId: 'BST-002:EASY:4', r: 6, c: 8 }]);
  const decide = () => chooseV2Turn(state, 0, WORDS, isValid, { difficulty: DIFFICULTY.HARD, rng: createRng('same') });
  const before = decide();
  // Swap the opponent's rack with bag tiles, reverse the bag, shuffle hidden queue cards.
  const opp = state.racks[1].splice(0);
  state.racks[1] = state.bag.splice(0, opp.length);
  state.bag.push(...opp);
  state.bag.reverse();
  const q = state.boostV2.queue;
  const hiddenFrom = q.cursor + 3; // the next cards (the replacement + preview) are visible
  const hidden = q.entries.splice(hiddenFrom).reverse();
  q.entries.push(...hidden);
  assert.deepEqual(decide(), before);
});

test('deterministic under a fixed seed', () => {
  const { state } = fresh('det');
  setRack(state, 0, ['ל', 'א', 'ב', 'ש']);
  const a = chooseV2Turn(state, 0, WORDS, isValid, { difficulty: DIFFICULTY.MEDIUM, rng: createRng('k') });
  const b = chooseV2Turn(state, 0, WORDS, isValid, { difficulty: DIFFICULTY.MEDIUM, rng: createRng('k') });
  assert.deepEqual(a, b);
});

test('bot session: two V2 bots play a complete match (setup, moves, replacements) without a rejected action', () => {
  busMod._reset();
  DICT.clear();
  const vocab = ['לא', 'אב', 'בא', 'של', 'אל', 'לב', 'שם', 'מה', 'מי', 'אם', 'בית', 'יום', 'שלום', 'אמא', 'אבא', 'דג', 'גן', 'הר', 'עץ', 'תן', 'נר', 'רץ', 'כן', 'לך', 'סוס', 'עם', 'חם', 'קר', 'פה', 'זה', 'טוב', 'יד', 'ים', 'אור', 'שיר', 'דוד', 'רוח', 'חג', 'ער', 'גל'];
  addWordsFromText(vocab.join('\n'));
  const session = createLocalGameSession({
    bus: busMod, mode: 'offline-solo', tileBagSeed: 'bvb', players: PLAYERS, ruleset: 'BOOST_V2', boostQueueRng: createRng('bvb/q'),
  });
  session.state.exchangeRng = createRng('bvb/x');
  const queue = [];
  const scheduler = (fn) => { queue.push(fn); return queue.length; };
  for (const slot of [0, 1]) {
    attachBotPlayer(session, { slot, wordList: vocab, isWordValid: isValid, difficulty: slot === 0 ? DIFFICULTY.MEDIUM : DIFFICULTY.HARD, rng: createRng(`bot${slot}`), scheduler, cancelScheduler: () => {} });
  }
  let rejected = 0;
  busMod.on(EV.INVALID_MOVE_REJECTED, () => { rejected++; });
  session.start();
  let steps = 0;
  while (queue.length && steps++ < 2000) queue.shift()();
  assert.notEqual(session.state.status, 'playing', 'match finished');
  assert.equal(rejected, 0);
  assert.ok(session.state.moveHistory.length > 2);
  assert.equal(session.state.boostV2.phase, PHASE.NORMAL);
  assert.deepEqual(checkBoostV2Invariants(session.state), []);
});
