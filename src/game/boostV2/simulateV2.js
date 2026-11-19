// Boost 2.0 — headless simulation harness (spec §43 property testing, §46).
//
// Plays complete Boost 2.0 matches through the REAL engine (createEngine +
// dispatch), using the existing bot search purely as a legal-word generator
// and the engine's own placement planner for Boost locations. After every
// committed command it checks the state invariants; after every rejected
// command it checks the state did not change. Pure: no DOM / Firebase /
// timers. The word list and validator are injected.
//
// This is NOT the Phase 6 bot: it does not weigh Boost rewards when picking a
// word and places Boosts randomly among legal squares. Its numbers are a
// baseline for balancing, not a prediction of skilled play.

import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { createEngine, createInitialState } from '../core/gameEngine.js';
import { searchBotMove } from '../sessions/botSearch.js';
import { createRng } from '../../util/rng.js';
import { RULESET } from './rulesConfig.js';
import { PHASE, checkBoostV2Invariants } from './matchStateV2.js';
import { planForMove, coversCenter } from './engineV2.js';
import { makeBoardView, legalSquares, preferenceOrder } from './boostPlacement.js';
import { getAllWords } from '../core/scoringEngine.js';

// Search profile: ignore legacy off-grid bonus squares entirely.
const SIM_PROFILE = Object.freeze({
  maxWordLen: 7, tries: 80, anchLimit: 14,
  includeBonusSquares: false, avoidBonusTiles: true,
  select: 'topN', topN: 3, scoreCeiling: Infinity,
  weakenFirstMove: false, blunderChance: 0,
});

function snapshot(state) {
  return JSON.stringify({ ...state, bonusBoard: [...(state.bonusBoard ?? [])] });
}

// Random distinct legal squares when the batch keeps no Bridge Builder;
// otherwise the planner's arrangement, which is guaranteed valid.
function randomArrangement(plan, legal, rng, definitions) {
  const keepsBridge = plan.effective.some(e => definitions[e.effectiveDefinitionId].family === 'BRIDGE_BUILDER');
  if (keepsBridge) return plan.arrangement;
  const pool = [...legal];
  const out = [];
  for (let i = 0; i < plan.placeable; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

/**
 * Play one match. Returns { state, metrics, violations }.
 */
export function playV2Match({ seed, wordList, isWordValid, maxCommands = 600, checkInvariants = true }) {
  const rng = createRng(`${seed}/sim`);
  const state = createInitialState({
    mode: 'offline-2p', tileBagSeed: `${seed}/bag`, players: { 0: { uid: 'p0' }, 1: { uid: 'p1' } },
    startingSlot: 0, ruleset: RULESET.BOOST_V2, boostQueueRng: createRng(`${seed}/queue`),
  });
  state.exchangeRng = createRng(`${seed}/exchange`);
  const events = [];
  const bus = { emit: (type, payload) => events.push({ type, payload }) };
  const eng = createEngine({ state, bus });
  const violations = [];
  const m = {
    commands: 0, wordMoves: 0, passes: 0, exchanges: 0, rejections: 0, rejectionReasons: {},
    baseScore: 0, boostScore: 0, fullRackBonuses: 0,
    consumed: 0, completed: 0, multiCompletions: 0,
    byFamily: {}, byDifficulty: {},
    turnsWithFewerThanTarget: 0, turnsWithThreeHard: 0,
    bridgeFallbacks: 0, placementUnavailable: 0,
  };

  function run(cmd) {
    const before = snapshot(state);
    const prevV2 = JSON.parse(JSON.stringify(state.boostV2));
    const n = events.length;
    eng.dispatch(cmd);
    m.commands++;
    const fresh = events.slice(n);
    const rejected = fresh.some(e => e.type === EV.INVALID_MOVE_REJECTED);
    if (rejected) {
      m.rejections++;
      const reason = fresh.find(e => e.type === EV.INVALID_MOVE_REJECTED).payload.reason;
      m.rejectionReasons[reason] = (m.rejectionReasons[reason] ?? 0) + 1;
      if (snapshot(state) !== before) violations.push(`rejected ${cmd.type} mutated state`);
    } else if (checkInvariants) {
      for (const v of checkBoostV2Invariants(state, prevV2)) violations.push(`${cmd.type}: ${v}`);
    }
    for (const e of fresh) {
      if (e.type === EV.MOVE_CONFIRMED && e.payload.breakdown) {
        const b = e.payload.breakdown;
        m.baseScore += b.baseScore; m.boostScore += b.boostScore;
        if (b.fullRackBonus) m.fullRackBonuses++;
        if (b.completedBoostIds.length > 1) m.multiCompletions++;
        if (b.totalScore !== b.baseScore + b.boostScore + b.fullRackBonus) violations.push('breakdown total mismatch');
        for (const r of b.boostResults) {
          m.consumed++; if (r.completed) m.completed++;
          for (const [map, k] of [[m.byFamily, r.family], [m.byDifficulty, r.difficulty]]) {
            map[k] ??= { consumed: 0, completed: 0 };
            map[k].consumed++; if (r.completed) map[k].completed++;
          }
        }
      }
      if (e.type === EV.BOOST_V2_TELEMETRY) {
        if (e.payload.type === 'bridge-fallback-activated') m.bridgeFallbacks++;
        if (e.payload.type === 'replacement-placement-unavailable') m.placementUnavailable++;
      }
    }
    return !rejected;
  }

  while (state.status === 'playing' && m.commands < maxCommands) {
    const v2 = state.boostV2;
    const slot = state.currentTurnSlot;
    if (v2.phase === PHASE.NORMAL) {
      if (v2.activeBoosts.length < v2.rules.activeBoostTarget) m.turnsWithFewerThanTarget++;
      if (v2.activeBoosts.length === 3 && v2.activeBoosts.every(b => v2.definitions[b.effectiveDefinitionId].difficulty === 'HARD')) m.turnsWithThreeHard++;
    }
    if (v2.phase === PHASE.OPENING_SETUP) {
      const view = makeBoardView(state.board, []);
      const legal = legalSquares({ view, blocked: [...v2.activeBoosts, ...v2.openingSetup.placements], rules: v2.rules });
      const sq = legal[Math.floor(rng() * legal.length)] ?? preferenceOrder(legal)[0];
      run({ type: CMD.PLACE_OPENING_BOOST, payload: sq ?? {} });
      continue;
    }
    const move = searchBotMove(state, slot, wordList, isWordValid, { profile: SIM_PROFILE, rng });
    let played = false;
    if (move && (!state.firstMove || coversCenter(move.placed, v2.rules))) {
      const placed = move.placed.map(p => ({ r: p.r, c: p.c, letter: p.letter, val: p.val, isJoker: !!p.isJoker }));
      const consumed = v2.activeBoosts.filter(b => placed.some(p => p.r === b.r && p.c === b.c)).map(b => b.instanceId);
      const { plan, legal } = planForMove(state, placed, consumed);
      const boostPlacements = randomArrangement(plan, legal, rng, v2.definitions);
      if (getAllWords(state, placed).length) played = run({ type: CMD.CONFIRM_MOVE, payload: { placed, boostPlacements, moveId: `${seed}:${m.commands}` } });
      if (played) m.wordMoves++;
    }
    if (played) continue;
    if (state.bag.length > 0) {
      const rack = state.racks[slot];
      const n = 1 + Math.floor(rng() * Math.min(rack.length, state.bag.length));
      if (run({ type: CMD.EXCHANGE_TILE, payload: { letters: rack.slice(0, n) } })) { m.exchanges++; continue; }
    }
    run({ type: CMD.PASS_TURN, payload: {} });
    m.passes++;
  }
  const done = events.find(e => e.type === EV.GAME_COMPLETED)?.payload ?? null;
  return { state, metrics: m, violations, result: done };
}
