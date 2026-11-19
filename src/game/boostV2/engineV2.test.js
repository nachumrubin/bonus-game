// Boost 2.0 — engine integration tests (spec §39–41): complete turn
// transactions through createEngine().dispatch() with a tiny dictionary.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { createEngine, createInitialState } from '../core/gameEngine.js';
import { DICT, addWordsFromText } from '../core/hebrewDictionary.js';
import { HV } from '../core/letterDistribution.js';
import { createRng } from '../../util/rng.js';
import { RULESET } from './rulesConfig.js';
import { PHASE, publicView, checkBoostV2Invariants, normalizeBoostV2State } from './matchStateV2.js';
import { planForMove } from './engineV2.js';

const _log = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _log; });

const WORDS = ['שלומ', 'של', 'לא', 'אב', 'אבא', 'בא', 'לאו', 'וו', 'אל', 'מא', 'למ', 'ומ', 'שלאמב', 'שלאמו'];
beforeEach(() => { DICT.clear(); addWordsFromText(WORDS.join('\n')); });

const PLAYERS = { 0: { uid: 'a' }, 1: { uid: 'b' } };

function makeBus() {
  const events = [];
  return { events, emit: (type, payload) => events.push({ type, payload }), of: (t) => events.filter(e => e.type === t).map(e => e.payload) };
}

function fresh({ seed = 'v2-seed', queueSeed = 'q-seed', startingSlot = 0 } = {}) {
  const state = createInitialState({
    mode: 'offline-2p', tileBagSeed: seed, players: PLAYERS, startingSlot,
    ruleset: RULESET.BOOST_V2, boostQueueRng: createRng(queueSeed),
  });
  state.exchangeRng = createRng('exchange');
  const bus = makeBus();
  const eng = createEngine({ state, bus });
  return { state, eng, bus };
}

// Move `letters` into `slot`'s rack (rest of the rack goes back to the bag).
// Keeps tile conservation intact.
function setRack(state, slot, letters) {
  state.bag.push(...state.racks[slot]);
  state.racks[slot] = [];
  for (const l of letters) {
    const i = state.bag.lastIndexOf(l);
    if (i < 0) throw new Error(`bag has no ${l}`);
    state.racks[slot].push(state.bag.splice(i, 1)[0]);
  }
}
// Commit tiles to the board straight from the bag (scenario setup only).
function putOnBoard(state, cells) {
  for (const [r, c, l] of cells) {
    const i = state.bag.lastIndexOf(l);
    if (i < 0) throw new Error(`bag has no ${l}`);
    state.bag.splice(i, 1);
    state.board[r][c] = { letter: l, val: HV[l], isJoker: false };
  }
  state.firstMove = false;
}
// Activate Boosts with chosen definitions, drawing their instances FIFO-style
// from the queue (keeps queue/active accounting valid).
function activate(state, boosts) {
  const v2 = state.boostV2;
  v2.phase = PHASE.NORMAL;
  for (const { defId, r, c } of boosts) {
    const q = v2.queue;
    const i = q.entries.findIndex((e, k) => k >= q.cursor && e.definitionId === defId);
    if (i < 0) throw new Error(`no ${defId} left in queue`);
    const [e] = q.entries.splice(i, 1);
    q.entries.splice(q.cursor, 0, e);
    q.cursor += 1;
    v2.activeBoosts.push({ instanceId: e.instanceId, definitionId: defId, effectiveDefinitionId: defId, fallbackApplied: false, r, c, placedOnTurn: 1, placedBySlot: 0 });
  }
}
const tile = (r, c, letter, extra = {}) => ({ r, c, letter, val: extra.isJoker ? 0 : HV[letter], ...extra });
const snapshot = (state) => JSON.stringify({ ...state, bonusBoard: [...state.bonusBoard] });

// Scenario: 'שלומ' across row 4 (cols 3–6); NORMAL phase; three Boosts.
const WE_L = 'BST-006:EASY:START:ל';
const LW_E = 'BST-002:EASY:4';
const LH_E_L = 'BST-001:EASY:ל';
const BRIDGE = 'BST-007:HARD';
function midGame(boosts, rack0 = ['א', 'ל', 'ו', 'ב', 'א', 'נ', 'ר', 'ת']) {
  const f = fresh();
  setRack(f.state, 0, rack0);
  putOnBoard(f.state, [[4, 3, 'ש'], [4, 4, 'ל'], [4, 5, 'ו'], [4, 6, 'מ']]);
  activate(f.state, boosts);
  f.state.currentTurnSlot = 0;
  return f;
}

// ── creation / legacy isolation ─────────────────────────────────────────────
test('V2 state: ruleset + versions persisted, legacy bonus/locks off, no Boosts in round 1', () => {
  const { state } = fresh();
  assert.equal(state.ruleset, 'BOOST_V2');
  assert.equal(state.boostV2.rulesVersion, 'boost-v2.rules.0.3-proto');
  assert.equal(state.boostV2.deckVersion, 'boost-v2.deck.0.3-candidate');
  assert.equal(state.boostV2.phase, PHASE.FIRST_ROUND);
  assert.deepEqual(state.bonusAssignment, []);
  assert.deepEqual(state.lockInventory, { 0: [], 1: [] });
  assert.equal(state.boostV2.queue.entries.length, 95);
  assert.deepEqual(checkBoostV2Invariants(state), []);
});

test('legacy createInitialState output is unchanged (no ruleset / boostV2 keys)', () => {
  const s = createInitialState({ mode: 'offline-2p', tileBagSeed: 'x', players: PLAYERS });
  assert.equal('ruleset' in s, false);
  assert.equal('boostV2' in s, false);
  assert.equal(s.bonusAssignment.length, 12);
  assert.throws(() => createInitialState({ mode: 'x', tileBagSeed: 'x', players: PLAYERS, ruleset: 'NOPE' }));
});

// ── opening rule ────────────────────────────────────────────────────────────
test('opening word must cover a central square', () => {
  const { state, eng, bus } = fresh();
  setRack(state, 0, ['ל', 'א']);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(0, 0, 'ל'), tile(0, 1, 'א')] } });
  assert.equal(bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason, 'opening-not-center');
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 5, 'ל'), tile(5, 6, 'א')] } });
  assert.equal(bus.of(EV.MOVE_CONFIRMED).length, 1);
  assert.equal(state.scores[0], 3);
});

test('rejections: off-grid, swap without a tile, locks, duplicate coordinates', () => {
  const { state, eng, bus } = fresh();
  setRack(state, 0, ['ל', 'א']);
  const reason = () => bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason;
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(-1, 5, 'ל'), tile(0, 5, 'א')] } });
  assert.equal(reason(), 'off-grid');
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(4, 4, 'ל')], swappedTiles: [tile(4, 5, 'א')] } });
  assert.equal(reason(), 'swap-no-tile');
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(4, 4, 'ל')], lock: { r: 0, c: 0, duration: 3 } } });
  assert.equal(reason(), 'v2-locks-disabled');
  eng.dispatch({ type: CMD.PLACE_LOCK, payload: { r: 0, c: 0, duration: 3 } });
  assert.equal(reason(), 'v2-locks-disabled');
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(4, 4, 'ל'), tile(4, 4, 'א')] } });
  assert.equal(reason(), 'duplicate-placement');
});

// ── 41.1 / 41.2 first round + opening setup ────────────────────────────────
test('first round → opening setup (second, first, second) → three Boosts activate together', () => {
  const { state, eng, bus } = fresh();
  setRack(state, 0, ['ל', 'א']);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(4, 4, 'ל'), tile(4, 5, 'א')] } });
  assert.equal(state.boostV2.phase, PHASE.FIRST_ROUND, 'no Boosts after only one turn');
  eng.dispatch({ type: CMD.PASS_TURN, payload: {} });
  assert.equal(state.boostV2.phase, PHASE.OPENING_SETUP);
  assert.deepEqual(state.boostV2.openingSetup.order, [1, 0, 1]);
  assert.equal(state.currentTurnSlot, 1);
  const queueHead = state.boostV2.queue.entries.slice(0, 3).map(e => e.instanceId);
  assert.deepEqual(publicView(state.boostV2).upcoming.map(u => u.instanceId), state.boostV2.queue.entries.slice(0, 2).map(e => e.instanceId),
    'before initial activation the preview is the first two queue entries (spec §15)');
  assert.equal(publicView(state.boostV2).openingSetup.current.instanceId, queueHead[0], 'card to place now is shown');

  const reason = () => bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason;
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 4, 'א')] } });
  assert.equal(reason(), 'opening-setup-pending');
  eng.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: [state.racks[1][0]] } });
  assert.equal(reason(), 'opening-setup-pending');
  eng.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: { r: 0, c: 0 } });
  assert.equal(reason(), 'boost-placement-illegal', 'too far from any tile');

  eng.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: { r: 3, c: 4 } });
  assert.equal(state.currentTurnSlot, 0);
  assert.equal(state.boostV2.activeBoosts.length, 0, 'not active until all three are placed');
  eng.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: { r: 3, c: 4 } });
  assert.equal(reason(), 'boost-placement-illegal', 'square already holds a setup Boost');
  eng.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: { r: 5, c: 4 } });
  assert.equal(state.currentTurnSlot, 1);
  eng.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: { r: 4, c: 6 } });

  assert.equal(state.boostV2.phase, PHASE.NORMAL);
  assert.equal(state.currentTurnSlot, 0, 'starting player gets the next normal turn');
  assert.deepEqual(state.boostV2.activeBoosts.map(b => b.instanceId), queueHead);
  assert.deepEqual(state.boostV2.activeBoosts.map(b => b.placedBySlot), [1, 0, 1]);
  assert.equal(state.boostV2.queue.cursor, 3);
  assert.deepEqual(publicView(state.boostV2).upcoming.map(u => u.instanceId), state.boostV2.queue.entries.slice(3, 5).map(e => e.instanceId));
  assert.deepEqual(checkBoostV2Invariants(state), []);
});

test('opening setup deferred while the board is empty, then starts after the first valid word', () => {
  const { state, eng } = fresh();
  eng.dispatch({ type: CMD.PASS_TURN, payload: {} });
  eng.dispatch({ type: CMD.PASS_TURN, payload: {} });
  assert.equal(state.boostV2.phase, PHASE.FIRST_ROUND);
  setRack(state, 0, ['ל', 'א']);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(4, 4, 'ל'), tile(4, 5, 'א')] } });
  assert.equal(state.boostV2.phase, PHASE.OPENING_SETUP);
  assert.equal(state.boostV2.openingSetup.returnSlot, 1);
  assert.deepEqual(state.boostV2.openingSetup.order, [0, 1, 0]);
});

test('opening setup: a pass or timeout hands the step to the opponent, who places two in a row (AUDIT A6)', () => {
  const { state, eng, bus } = fresh();
  setRack(state, 0, ['ל', 'א']);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(4, 4, 'ל'), tile(4, 5, 'א')] } });
  eng.dispatch({ type: CMD.PASS_TURN, payload: {} });
  assert.deepEqual(state.boostV2.openingSetup.order, [1, 0, 1]);
  // Player 1 times out on step 1 → player 0 places it, then their own step 2.
  eng.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'timeout' } });
  assert.equal(state.currentTurnSlot, 0);
  assert.deepEqual(state.boostV2.openingSetup.order, [0, 0, 1]);
  assert.equal(state.boostV2.openingSetup.placements.length, 0, 'nothing auto-placed');
  assert.equal(bus.of(EV.TURN_CHANGED).at(-1).skipReason, 'timeout');
  eng.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: { r: 3, c: 4 } });
  assert.equal(state.currentTurnSlot, 0, 'two in a row');
  eng.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: { r: 5, c: 4 } });
  // Player 1 passes step 3 voluntarily → player 0 places it too.
  eng.dispatch({ type: CMD.PASS_TURN, payload: {} });
  assert.equal(state.currentTurnSlot, 0);
  eng.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: { r: 4, c: 6 } });
  assert.equal(state.boostV2.phase, PHASE.NORMAL);
  assert.deepEqual(state.boostV2.activeBoosts.map(b => b.placedBySlot), [0, 0, 0]);
  assert.equal(state.currentTurnSlot, 0, 'starting player still moves next');
  assert.equal(state.passCount, 1, 'setup skips are not scoreless turns');
  assert.deepEqual(checkBoostV2Invariants(state), []);
});

// ── 41.3 normal move without consumption ───────────────────────────────────
test('move that consumes no Boost: queue untouched, no placement required', () => {
  const { state, eng, bus } = midGame([{ defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }, { defId: LW_E, r: 6, c: 6 }]);
  const cursor = state.boostV2.queue.cursor;
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 4, 'א')] } });
  const m = bus.of(EV.MOVE_CONFIRMED).at(-1);
  assert.equal(m.score, 3);
  assert.deepEqual(m.breakdown.boostResults, []);
  assert.equal(state.boostV2.queue.cursor, cursor);
});

// ── 41.4 / 41.5 single consumption, success and failure ────────────────────
test('successful single Boost: +reward, consumed, FIFO replacement placed by the mover', () => {
  const { state, eng, bus } = midGame([{ defId: WE_L, r: 5, c: 4 }, { defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }]);
  const consumedId = state.boostV2.activeBoosts[0].instanceId;
  const nextEntry = state.boostV2.queue.entries[state.boostV2.queue.cursor];
  const before = JSON.parse(JSON.stringify(state.boostV2));
  // Missing replacement → whole move rejected, nothing changed.
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 4, 'א')] } });
  assert.equal(bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason, 'boost-placement-count');
  assert.deepEqual(JSON.parse(JSON.stringify(state.boostV2)), before);
  // Replacement on the newly occupied square → rejected.
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 4, 'א')], boostPlacements: [{ r: 5, c: 4 }] } });
  assert.equal(bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason, 'boost-placement-illegal');

  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 4, 'א')], boostPlacements: [{ r: 6, c: 4, instanceId: nextEntry.instanceId }] } });
  const m = bus.of(EV.MOVE_CONFIRMED).at(-1);
  assert.equal(m.breakdown.baseScore, 3);
  assert.equal(m.breakdown.boostScore, 5);
  assert.equal(m.score, 8);
  assert.deepEqual(m.breakdown.completedBoostIds, [consumedId]);
  assert.equal(state.scores[0], 8);
  assert.deepEqual(state.boostV2.consumedInstanceIds, [consumedId]);
  assert.equal(state.boostV2.activeBoosts.length, 3);
  const placed = state.boostV2.activeBoosts.find(b => b.instanceId === nextEntry.instanceId);
  assert.deepEqual([placed.r, placed.c, placed.placedBySlot], [6, 4, 0]);
  assert.equal(state.boostV2.queue.cursor, before.queue.cursor + 1);
  assert.equal(state.currentTurnSlot, 1, 'opponent gets first opportunity on the new Boost');
  assert.equal(state.moveHistory.at(-1).breakdown.totalScore, 8);
  assert.deepEqual(checkBoostV2Invariants(state, before), []);
});

test('failed single Boost: consumed, zero reward, replacement still required', () => {
  const { state, eng, bus } = midGame([{ defId: LW_E, r: 5, c: 4 }, { defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }]);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 4, 'א')], boostPlacements: [{ r: 6, c: 4 }] } });
  const m = bus.of(EV.MOVE_CONFIRMED).at(-1);
  assert.equal(m.breakdown.failedBoostIds.length, 1);
  assert.equal(m.score, 3);
  assert.equal(state.boostV2.consumedInstanceIds.length, 1);
});

// ── 41.6 / 41.7 two and three Boosts in one move ───────────────────────────
test('two Boosts in one move incl. Bridge Builder over a shared word', () => {
  const { state, eng, bus } = midGame([{ defId: BRIDGE, r: 5, c: 3 }, { defId: LH_E_L, r: 5, c: 4 }, { defId: LW_E, r: 2, c: 6 }]);
  // Row 5: ל(5,3) א(5,4) → words 'לא' (row), 'של' (col 3), 'לא' (col 4)
  const plan = planForMove(state, [tile(5, 3, 'ל'), tile(5, 4, 'א')], state.boostV2.activeBoosts.slice(0, 2).map(b => b.instanceId)).plan;
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 3, 'ל'), tile(5, 4, 'א')], boostPlacements: plan.arrangement } });
  const m = bus.of(EV.MOVE_CONFIRMED).at(-1);
  assert.ok(m, JSON.stringify(bus.of(EV.INVALID_MOVE_REJECTED).at(-1)));
  assert.equal(m.breakdown.words.length, 3);
  assert.equal(m.breakdown.baseScore, 3 + 5 + 3);
  const byFam = Object.fromEntries(m.breakdown.boostResults.map(r => [r.family, r]));
  assert.equal(byFam.BRIDGE_BUILDER.completed, true);
  assert.equal(byFam.LETTER_HUNT.completed, false, 'tile on its square is א, not ל');
  assert.equal(m.score, 11 + 20);
  assert.equal(m.boostPlacements.length, 2);
  assert.equal(state.boostV2.activeBoosts.length, 3);
});

test('three Boosts in one move', () => {
  const { state, eng, bus } = midGame([{ defId: LH_E_L, r: 5, c: 3 }, { defId: LW_E, r: 5, c: 4 }, { defId: LW_E, r: 5, c: 5 }]);
  const placed = [tile(5, 3, 'ל'), tile(5, 4, 'א'), tile(5, 5, 'ו')];
  const ids = state.boostV2.activeBoosts.map(b => b.instanceId);
  const { plan } = planForMove(state, placed, ids);
  assert.equal(plan.placeable, 3);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed, boostPlacements: plan.arrangement } });
  const m = bus.of(EV.MOVE_CONFIRMED).at(-1);
  assert.ok(m, JSON.stringify(bus.of(EV.INVALID_MOVE_REJECTED).at(-1)));
  assert.equal(m.breakdown.consumedBoostIds.length, 3);
  assert.deepEqual(m.breakdown.completedBoostIds, [ids[0]]);
  assert.equal(state.boostV2.queue.cursor, 6);
  assert.deepEqual(state.boostV2.activeBoosts.map(b => b.instanceId), state.boostV2.queue.entries.slice(3, 6).map(e => e.instanceId));
  assert.deepEqual(checkBoostV2Invariants(state), []);
});

// ── 41.8 invalid replacement / 41.9 cancel / invalid move ──────────────────
test('invalid moves never touch committed state (bad word, gaps, not in rack, bad placement)', () => {
  const { state, eng, bus } = midGame([{ defId: WE_L, r: 5, c: 4 }, { defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }]);
  const snap = snapshot(state);
  const tries = [
    { placed: [tile(5, 4, 'ב')], boostPlacements: [{ r: 6, c: 4 }] },             // 'לב' not in test dict
    { placed: [tile(5, 4, 'א'), tile(7, 4, 'א')], boostPlacements: [{ r: 6, c: 6 }] }, // gap
    { placed: [tile(5, 4, 'צ')] },                                                 // not in rack
    { placed: [tile(5, 4, 'א')], boostPlacements: [{ r: 9, c: 9 }] },               // too far
    { placed: [tile(5, 4, 'א')], boostPlacements: [{ r: 2, c: 3 }] },               // on an active Boost
    { placed: [tile(8, 8, 'א'), tile(8, 9, 'ב')] },                                // disconnected
  ];
  for (const payload of tries) eng.dispatch({ type: CMD.CONFIRM_MOVE, payload });
  assert.equal(bus.of(EV.INVALID_MOVE_REJECTED).length, tries.length);
  assert.equal(bus.of(EV.MOVE_CONFIRMED).length, 0);
  assert.equal(snapshot(state), snap);
});

// ── 41.13 idempotency ──────────────────────────────────────────────────────
test('duplicate submission (same moveId) and stale revision are rejected', () => {
  const { state, eng, bus } = midGame([{ defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }, { defId: LW_E, r: 6, c: 6 }]);
  const rev = state.boostV2.revision;
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 4, 'א')], moveId: 'm1', expectedRevision: rev } });
  assert.equal(state.boostV2.revision, rev + 1);
  const snap = snapshot(state);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 3, 'ל')], moveId: 'm1' } });
  assert.equal(bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason, 'duplicate-move');
  eng.dispatch({ type: CMD.PASS_TURN, payload: { expectedRevision: rev } });
  assert.equal(bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason, 'stale-state');
  assert.equal(snapshot(state), snap);
});

// ── §21 no legal placement → pending FIFO entry, retried after word moves ──
test('no legal replacement square: entry stays pending; retried after the next valid word move, not after a pass', () => {
  const { state, eng, bus } = midGame([{ defId: WE_L, r: 5, c: 4 }, { defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }]);
  const pendingEntry = state.boostV2.queue.entries[3];
  state.boostV2.rules.boostPlacementDistance = 0; // test hook: nothing is legal
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 4, 'א')] } });
  assert.ok(bus.of(EV.MOVE_CONFIRMED).at(-1), 'turn completes without placement');
  assert.equal(state.boostV2.activeBoosts.length, 2);
  assert.equal(state.boostV2.queue.cursor, 3, 'pending entry not skipped');
  assert.ok(bus.of(EV.BOOST_V2_TELEMETRY).some(t => t.type === 'replacement-placement-unavailable'));
  state.boostV2.rules.boostPlacementDistance = 2;
  eng.dispatch({ type: CMD.PASS_TURN, payload: {} });
  assert.equal(state.boostV2.activeBoosts.length, 2, 'passes do not retry');
  // Player 0 plays a word that consumes nothing — the pending entry must now be placed.
  setRack(state, 0, ['מ', 'א']);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 6, 'א')] } });
  assert.equal(bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason, 'boost-placement-count', 'voluntary deferral not allowed');
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 6, 'א')], boostPlacements: [{ r: 6, c: 6 }] } });
  assert.equal(state.boostV2.activeBoosts.length, 3);
  assert.equal(state.boostV2.activeBoosts.at(-1).instanceId, pendingEntry.instanceId);
  assert.equal(state.boostV2.queue.cursor, 4);
});

// ── §7 exchange ─────────────────────────────────────────────────────────────
test('exchange: 1 tile, consumes the turn, scores 0, no Boost/queue change, conservation kept', () => {
  const { state, eng, bus } = midGame([{ defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }, { defId: LW_E, r: 6, c: 6 }]);
  const before = JSON.parse(JSON.stringify(state.boostV2));
  const bagLen = state.bag.length;
  eng.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: ['ת'] } });
  assert.equal(bus.of(EV.TILES_EXCHANGED).at(-1).count, 1);
  assert.equal(state.racks[0].length, 8);
  assert.equal(state.bag.length, bagLen);
  assert.equal(state.scores[0], 0);
  assert.equal(state.passCount, 1);
  assert.equal(state.currentTurnSlot, 1);
  assert.deepEqual(state.boostV2.activeBoosts, before.activeBoosts);
  assert.equal(state.boostV2.queue.cursor, before.queue.cursor);
  assert.deepEqual(checkBoostV2Invariants(state, before), []);
});

test('exchange: draw happens before return (no tile can come straight back)', () => {
  const { state, eng } = midGame([{ defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }, { defId: LW_E, r: 6, c: 6 }]);
  const top = state.bag.slice(-8).reverse();
  const rack = [...state.racks[0]];
  eng.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: rack } });
  assert.deepEqual(state.racks[0], top, 'eight replacements are exactly the eight drawn before the return');
});

test('exchange limits: > bag rejected, empty bag rejected, 0 rejected', () => {
  const { state, eng, bus } = midGame([{ defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }, { defId: LW_E, r: 6, c: 6 }]);
  const reason = () => bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason;
  const spare = state.bag.splice(3);              // leave 3 in the bag
  state.racks[1].push(...spare);                  // keep conservation
  eng.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: state.racks[0].slice(0, 5) } });
  assert.equal(reason(), 'exchange-too-many');
  eng.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: [] } });
  assert.equal(reason(), 'exchange-invalid');
  eng.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: state.racks[0].slice(0, 3) } });
  assert.equal(bus.of(EV.TILES_EXCHANGED).length, 1, 'exactly the bag size is allowed');
  state.racks[0].push(...state.bag.splice(0));
  eng.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: [state.racks[1][0]] } });
  assert.equal(reason(), 'exchange-bag-empty');
});

// ── 41.10 endgame-triggering move ──────────────────────────────────────────
test('endgame move consuming a Boost: no replacement needed; opponent rack deducted; winner by final score', () => {
  const { state, eng, bus } = midGame([{ defId: WE_L, r: 5, c: 4 }, { defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }], ['א']);
  state.racks[1].push(...state.bag.splice(0));     // empty the bag (conservation kept)
  const oppPenalty = state.racks[1].reduce((s, l) => s + (HV[l] ?? 0), 0);
  state.scores[1] = 8 + oppPenalty;                // accumulated lead that the deduction erases
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 4, 'א')], boostPlacements: [{ r: 6, c: 4 }] } });
  const done = bus.of(EV.GAME_COMPLETED).at(-1);
  assert.ok(done, JSON.stringify(bus.of(EV.INVALID_MOVE_REJECTED).at(-1)));
  assert.equal(state.boostV2.activeBoosts.length, 2, 'placements ignored on the final move');
  assert.deepEqual(done.boostV2Endgame.deductions, { 0: 0, 1: oppPenalty });
  assert.deepEqual(done.scores, { 0: 8, 1: 8 });
  assert.equal(done.winnerSlot, null, 'equal final scores → draw');
  // Deduction is applied exactly once.
  eng.dispatch({ type: CMD.RESIGN_GAME, payload: { slot: 0 } });
  assert.equal(state.scores[1], 8);
});

test('resign: no rack deduction; the resigning player loses', () => {
  const { state, eng, bus } = midGame([{ defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }, { defId: LW_E, r: 6, c: 6 }]);
  state.scores = { 0: 10, 1: 200 };
  eng.dispatch({ type: CMD.RESIGN_GAME, payload: { slot: 1 } });
  const done = bus.of(EV.GAME_COMPLETED).at(-1);
  assert.equal(done.boostV2Endgame, undefined);
  assert.deepEqual(done.scores, { 0: 10, 1: 200 });
  assert.equal(done.winnerSlot, 0);
});

test('stall claim: no rack deduction (the opponent stopped playing)', () => {
  const { state, eng, bus } = midGame([{ defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }, { defId: LW_E, r: 6, c: 6 }]);
  state.scores = { 0: 50, 1: 20 };
  eng.dispatch({ type: CMD.PASS_TURN, payload: {} });
  eng.dispatch({ type: CMD.PASS_TURN, payload: {} });
  eng.dispatch({ type: CMD.CLAIM_STALL_END, payload: { slot: 0 } });
  const done = bus.of(EV.GAME_COMPLETED).at(-1);
  assert.ok(done, JSON.stringify(bus.of(EV.INVALID_MOVE_REJECTED).at(-1)));
  assert.equal(done.boostV2Endgame, undefined);
  assert.deepEqual(done.scores, { 0: 50, 1: 20 });
  assert.equal(done.winnerSlot, 0);
});

test('scoreless-turn limit (no moves available) is a natural end: both racks deducted', () => {
  const { state, eng, bus } = midGame([{ defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }, { defId: LW_E, r: 6, c: 6 }]);
  const pen = (slot) => state.racks[slot].reduce((sum, l) => sum + (HV[l] ?? 0), 0);
  const p0 = pen(0), p1 = pen(1);
  state.scores = { 0: 100, 1: 100 };
  for (let i = 0; i < 4; i++) eng.dispatch({ type: CMD.PASS_TURN, payload: {} });
  const done = bus.of(EV.GAME_COMPLETED).at(-1);
  assert.ok(done);
  assert.deepEqual(done.boostV2Endgame.deductions, { 0: p0, 1: p1 });
  assert.deepEqual(done.scores, { 0: 100 - p0, 1: 100 - p1 });
});

// ── tile swaps (rules 0.2) ──────────────────────────────────────────────────
test('tile swap: replaces a board tile, displaced tile returns to the rack, scores as a new tile', () => {
  const { state, eng, bus } = midGame([{ defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }, { defId: LW_E, r: 6, c: 6 }]);
  const before = JSON.parse(JSON.stringify(state.boostV2));
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(4, 7, 'ב')], swappedTiles: [tile(4, 5, 'א')] } });
  const m = bus.of(EV.MOVE_CONFIRMED).at(-1);
  assert.ok(m, JSON.stringify(bus.of(EV.INVALID_MOVE_REJECTED).at(-1)));
  assert.deepEqual(m.words, ['שלאמב']);
  assert.equal(m.score, 3 + 2 + 1 + 2 + 3);
  assert.equal(state.board[4][5].letter, 'א');
  assert.equal(state.racks[0].filter(l => l === 'ו').length >= 2, true, 'displaced ו is back on the rack');
  assert.equal(state.racks[0].length, 8);
  assert.equal(state.moveHistory.at(-1).swappedTiles[0].oldLetter, 'ו');
  assert.deepEqual(checkBoostV2Invariants(state, before), []);
});

test('tile swap: the displaced tile can be played in the same move', () => {
  const { state, eng, bus } = midGame(
    [{ defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }, { defId: LW_E, r: 6, c: 6 }],
    ['א', 'ב', 'נ', 'ר', 'ת', 'ש', 'ל', 'מ'],
  );
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(4, 7, 'ו')], swappedTiles: [tile(4, 5, 'א')] } });
  const m = bus.of(EV.MOVE_CONFIRMED).at(-1);
  assert.ok(m, JSON.stringify(bus.of(EV.INVALID_MOVE_REJECTED).at(-1)));
  assert.deepEqual(m.words, ['שלאמו']);
});

test('tile swap: needs a regular placement; a rejected swap changes nothing', () => {
  const { state, eng, bus } = midGame([{ defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }, { defId: LW_E, r: 6, c: 6 }]);
  const snap = snapshot(state);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [], swappedTiles: [tile(4, 5, 'א')] } });
  assert.equal(bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason, 'swap-needs-placement');
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(4, 7, 'נ')], swappedTiles: [tile(4, 5, 'א')] } });
  assert.equal(bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason, 'word-not-in-dictionary');
  assert.equal(snapshot(state), snap);
});

test('client-supplied tile values are ignored; malformed tiles rejected', () => {
  const { eng, bus } = midGame([{ defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }, { defId: LW_E, r: 6, c: 6 }]);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [{ r: 5, c: 4, letter: 'א', val: 500 }] } });
  assert.equal(bus.of(EV.MOVE_CONFIRMED).at(-1).score, 3);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [{ r: 5, c: 5, letter: 'x' }] } });
  assert.equal(bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason, 'invalid-tile');
});

test('an injected word validator replaces the dictionary for V2 moves', () => {
  const f = fresh();
  const eng = createEngine({ state: f.state, bus: f.bus, isWordValid: () => false });
  setRack(f.state, 0, ['ל', 'א']);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(4, 4, 'ל'), tile(4, 5, 'א')] } });
  assert.equal(f.bus.of(EV.INVALID_MOVE_REJECTED).at(-1).reason, 'word-not-in-dictionary');
});

test('full rack: eight new tiles → +25 in the breakdown', () => {
  DICT.clear();
  addWordsFromText(['אבגדהוזח', 'שא'].join('\n'));
  const f = fresh();
  setRack(f.state, 0, [...'אבגדהוזח']);
  f.eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [...'אבגדהוזח'].map((l, i) => tile(4, 1 + i, l)) } });
  const m = f.bus.of(EV.MOVE_CONFIRMED).at(-1);
  assert.equal(m.breakdown.fullRackBonus, 25);
  assert.equal(m.score, m.breakdown.baseScore + 25);
});

// ── 41.14 / 41.15 resume ───────────────────────────────────────────────────
test('resume: Firebase-style round trip (empty arrays dropped) restores state without regenerating the queue', () => {
  const { state, eng } = fresh();
  setRack(state, 0, ['ל', 'א']);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(4, 4, 'ל'), tile(4, 5, 'א')] } });
  eng.dispatch({ type: CMD.PASS_TURN, payload: {} });
  eng.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: { r: 3, c: 4 } });
  const stored = JSON.parse(JSON.stringify(state.boostV2, (k, v) => (Array.isArray(v) && v.length === 0 ? undefined : v)));
  const restored = normalizeBoostV2State(stored);
  assert.deepEqual(restored.queue, state.boostV2.queue);
  assert.deepEqual(restored.openingSetup, state.boostV2.openingSetup);
  assert.deepEqual(restored.activeBoosts, []);
  assert.deepEqual(restored.consumedInstanceIds, []);
  // A new engine on the restored state continues the setup where it stopped.
  const state2 = { ...state, boostV2: restored };
  const bus2 = makeBus();
  const eng2 = createEngine({ state: state2, bus: bus2 });
  eng2.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: { r: 5, c: 4 } });
  eng2.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: { r: 4, c: 6 } });
  assert.equal(state2.boostV2.phase, PHASE.NORMAL);
  assert.deepEqual(checkBoostV2Invariants(state2), []);
});

// ── 41.17 configuration version isolation ──────────────────────────────────
test('each match keeps its own rules snapshot; mutating one never affects another or the registry', () => {
  const a = fresh().state, b = fresh().state;
  a.boostV2.rules.rewards.EASY = 999;
  assert.equal(b.boostV2.rules.rewards.EASY, 5);
  assert.equal(fresh().state.boostV2.rules.rewards.EASY, 5);
  assert.equal(a.boostV2.definitions[LW_E].reward, 5, 'definitions are frozen per match, not re-derived');
});

test('telemetry carries rules and deck versions', () => {
  const { eng, bus } = midGame([{ defId: WE_L, r: 5, c: 4 }, { defId: LW_E, r: 2, c: 3 }, { defId: LW_E, r: 2, c: 6 }]);
  eng.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [tile(5, 4, 'א')], boostPlacements: [{ r: 6, c: 4 }] } });
  const t = bus.of(EV.BOOST_V2_TELEMETRY);
  assert.ok(t.some(e => e.type === 'boost-completed'));
  for (const e of t) {
    assert.equal(e.rulesVersion, 'boost-v2.rules.0.3-proto');
    assert.equal(e.deckVersion, 'boost-v2.deck.0.3-candidate');
    assert.equal('racks' in e, false, 'no private rack data in telemetry');
  }
});
