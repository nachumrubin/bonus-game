// Boost 2.0 — turn orchestrator (spec §22, §23, §25 "Turn Orchestrator").
//
// gameEngine.dispatch() routes commands here when state.ruleset ===
// 'BOOST_V2'. Legacy matches never reach this module. Pure: no DOM, no
// Firebase, no timers — same rules as src/game/core/.
//
// A PLACE_WORD turn is ONE atomic engine step:
//   validate tiles → words → dictionary → consumed Boosts → evaluate →
//   breakdown → allocate replacements (FIFO) → validate replacement
//   locations against the post-move board → commit → draw → phase/endgame.
// Every check runs before the first mutation, so a rejected or cancelled
// move leaves the state byte-for-byte unchanged (spec §23, §43).
//
// Idempotency (spec §23, §28): a payload may carry `moveId` (a duplicate of
// the last committed moveId is rejected) and `expectedRevision` (rejected
// when it does not match state.boostV2.revision — stale client state). The
// online layer adds its own version guard on top (commitTransaction).

import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { isOnGrid, getCommittedTile, setCommittedTile } from '../core/board.js';
import { validateMove } from '../core/moveValidator.js';
import { getAllWords } from '../core/scoringEngine.js';
import { isValid as defaultIsValid } from '../core/hebrewDictionary.js';
import { HV } from '../core/letterDistribution.js';
import { applyMove, applyPass, advanceTurn, isGameOver } from '../core/turnManager.js';
import { returnTilesAndShuffle } from '../core/tileBag.js';
import { evaluateMoveBoosts } from './challengeEvaluator.js';
import { buildScoreBreakdown, computeFinalScores } from './scoringV2.js';
import { peek, advance } from './challengeQueue.js';
import {
  makeBoardView, legalSquares, planReplacements, validatePlacements,
} from './boostPlacement.js';
import { PHASE, publicView } from './matchStateV2.js';

export const V2_COMMANDS = new Set([
  CMD.CONFIRM_MOVE, CMD.PASS_TURN, CMD.EXCHANGE_TILE, CMD.PLACE_LOCK,
  CMD.ACTIVATE_BOOST, CMD.FINALIZE_BOOST_AWARD, CMD.PLACE_OPENING_BOOST,
]);

// Opening-rule check (spec §5.1): the first word must cover a centre square.
export function coversCenter(placed, rules) {
  return placed.some(p => rules.centerSquares.some(([r, c]) => p.r === r && p.c === c));
}

function boardIsEmpty(state) {
  return state.board.every(row => row.every(t => !t));
}

// Replacement batch a word move must place, given the post-move board.
// Exposed for the UI / bot: they show the same plan the engine enforces.
export function planForMove(state, placed, consumedIds = []) {
  const v2 = state.boostV2;
  const remaining = v2.activeBoosts.filter(b => !consumedIds.includes(b.instanceId));
  const needed = v2.phase === PHASE.NORMAL ? Math.max(0, v2.rules.activeBoostTarget - remaining.length) : 0;
  const entries = peek(v2.queue, needed);
  const view = makeBoardView(state.board, placed);
  const legal = legalSquares({ view, blocked: remaining, rules: v2.rules });
  const plan = planReplacements({ entries, legal, size: v2.rules.boardSize });
  return { remaining, entries, legal, plan };
}

// Squares where the current opening-setup Boost may go (empty, near a tile,
// not already holding an active or setup Boost). [] outside the setup phase.
export function legalOpeningSquares(state) {
  const v2 = state.boostV2;
  if (v2?.phase !== PHASE.OPENING_SETUP || !v2.openingSetup) return [];
  const view = makeBoardView(state.board, []);
  return legalSquares({ view, blocked: [...v2.activeBoosts, ...v2.openingSetup.placements], rules: v2.rules });
}

export function applyEndgameV2(state) {
  const v2 = state.boostV2;
  // Product decision (Nov 2026, AUDIT A3/A4): rack values are deducted only
  // when the game ends naturally — a rack and the bag are both empty, or the
  // scoreless-turn limit is reached (no moves available). No deduction on a
  // stall claim (the opponent stopped playing), resign, abandon, missed-turn
  // forfeit or expiry; those keep the accumulated scores.
  const natural = state.status === 'completed' && state.endReason !== 'stall-claim';
  if (!v2 || v2.endgame || !natural) return v2?.endgame ?? null;
  const fs = computeFinalScores(state.scores, state.racks);
  state.scores[0] = fs.final[0];
  state.scores[1] = fs.final[1];
  v2.endgame = fs;
  return fs;
}

// Normalise client tiles: integer coordinates, a real letter, and the value
// taken from the letter table — a client-supplied `val` is never trusted.
// Returns null when any tile is malformed.
export function sanitizeTiles(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const t of list) {
    const r = Number(t?.r), c = Number(t?.c);
    const letter = typeof t?.letter === 'string' ? t.letter : '';
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    if (!Object.prototype.hasOwnProperty.call(HV, letter) || letter === '?') return null;
    const isJoker = !!t.isJoker;
    out.push({ r, c, letter, val: isJoker ? 0 : HV[letter], isJoker });
  }
  return out;
}

export function createBoostV2Handlers({ state, emit, isWordValid = defaultIsValid }) {
  const v2 = () => state.boostV2;
  const reject = (reason, extra = {}) => emit(EV.INVALID_MOVE_REJECTED, { reason, ruleset: 'BOOST_V2', ...extra });
  const telemetry = (type, data = {}) => emit(EV.BOOST_V2_TELEMETRY, {
    type, rulesVersion: v2().rulesVersion, deckVersion: v2().deckVersion, turnNumber: state.turnNumber, ...data,
  });
  const boostsChanged = () => emit(EV.BOOSTS_CHANGED, publicView(v2()));

  function guard(payload) {
    if (payload?.moveId != null && payload.moveId === v2().lastMoveId) return 'duplicate-move';
    if (payload?.expectedRevision != null && Number(payload.expectedRevision) !== v2().revision) return 'stale-state';
    return null;
  }
  function commitMeta(payload) {
    if (payload?.moveId != null) v2().lastMoveId = payload.moveId;
    v2().revision += 1;
  }

  // ── Phase management ────────────────────────────────────────────────────
  // Called after every turn-ending action (move / pass / exchange) has
  // advanced the turn, and BEFORE any commit-triggering event is emitted
  // (the online session snapshots state on those events).
  function afterTurnEnded() {
    const s = v2();
    if (s.phase !== PHASE.FIRST_ROUND) return;
    s.firstRoundTurns += 1;
    if (s.firstRoundTurns < 2) return;
    if (state.status !== 'playing' || isGameOver(state)) return;
    if (boardIsEmpty(state)) return; // deferred until a valid word exists (spec §22)
    startOpeningSetup();
  }

  function startOpeningSetup() {
    const s = v2();
    const next = state.currentTurnSlot;
    const other = next === 0 ? 1 : 0;
    const entries = peek(s.queue, s.rules.activeBoostTarget);
    if (entries.length === 0) { s.phase = PHASE.NORMAL; return; }
    s.openingSetup = {
      order: [other, next, other].slice(0, entries.length),
      effective: entries.map(e => ({
        instanceId: e.instanceId, definitionId: e.definitionId, effectiveDefinitionId: e.definitionId,
      })),
      placements: [],
      returnSlot: next,
    };
    s.phase = PHASE.OPENING_SETUP;
    state.currentTurnSlot = s.openingSetup.order[0];
    telemetry('opening-setup-started', { order: [...s.openingSetup.order] });
    if (setupLegal().length === 0) activateSetup();
  }

  const setupLegal = () => legalOpeningSquares(state);

  function activateSetup() {
    const s = v2();
    const setup = s.openingSetup;
    const placedCount = setup.placements.length;
    if (placedCount < setup.effective.length) {
      telemetry('replacement-placement-unavailable', { pending: setup.effective.length - placedCount, phase: 'opening' });
    }
    s.activeBoosts = setup.placements.map(p => ({ ...p, placedOnTurn: state.turnNumber }));
    advance(s.queue, placedCount);
    s.phase = PHASE.NORMAL;
    state.currentTurnSlot = setup.returnSlot;
    s.openingSetup = null;
  }

  // ── PLACE_OPENING_BOOST ─────────────────────────────────────────────────
  function handlePlaceOpeningBoost(payload = {}) {
    const s = v2();
    if (s.phase !== PHASE.OPENING_SETUP) return reject('not-in-opening-setup');
    const g = guard(payload); if (g) return reject(g);
    const setup = s.openingSetup;
    const entry = setup.effective[setup.placements.length];
    const r = Number(payload.r), c = Number(payload.c);
    if (!setupLegal().some(sq => sq.r === r && sq.c === c)) return reject('boost-placement-illegal', { r, c });

    const placedBySlot = state.currentTurnSlot;
    const placement = {
      instanceId: entry.instanceId, definitionId: entry.definitionId, effectiveDefinitionId: entry.definitionId,
      r, c, placedBySlot,
    };
    setup.placements.push(placement);
    telemetry('boost-placed', { instanceId: entry.instanceId, definitionId: entry.definitionId, phase: 'opening' });

    if (setup.placements.length === setup.effective.length) activateSetup();
    else {
      state.currentTurnSlot = setup.order[setup.placements.length];
      if (setupLegal().length === 0) activateSetup();
    }
    commitMeta(payload);
    emit(EV.BOOST_PLACED, { slot: placedBySlot, placement, phase: v2().phase });
    boostsChanged();
    emit(EV.TURN_CHANGED, { currentTurnSlot: state.currentTurnSlot, turnNumber: state.turnNumber, reason: 'boost-setup', prevSlot: placedBySlot });
  }

  // A player who passes or times out on their opening-setup step hands that
  // Boost to the opponent, who then places two in a row (product decision,
  // Nov 2026, AUDIT A6). Setup steps are not turns: passCount is untouched.
  function handleSkipOpeningStep(payload, reason) {
    const s = v2();
    const g = guard(payload); if (g) return reject(g);
    const setup = s.openingSetup;
    const step = setup.placements.length;
    const skipped = setup.order[step];
    setup.order[step] = skipped === 0 ? 1 : 0;
    state.currentTurnSlot = setup.order[step];
    commitMeta(payload);
    telemetry('opening-step-skipped', { step, skippedSlot: skipped, reason });
    boostsChanged();
    emit(EV.TURN_CHANGED, { currentTurnSlot: state.currentTurnSlot, turnNumber: state.turnNumber, reason: 'boost-setup', prevSlot: skipped, skipReason: reason });
  }

  // ── CONFIRM_MOVE (PLACE_WORD) ───────────────────────────────────────────
  // Tile swaps (product decision, rules 0.2): a swap replaces a committed
  // tile with a rack tile; the displaced tile returns to the rack and may be
  // played in the same move. As in the legacy engine, a swap needs at least
  // one regular placement, and swapped-in tiles count as newly placed tiles
  // for word extraction, scoring, Tile Master and the full-rack count.
  // Swap squares are occupied, so they can never hold a Boost.
  function handleConfirmMove(payload = {}) {
    const s = v2();
    const { lock = null, boostPlacements = [] } = payload;
    if (s.phase === PHASE.OPENING_SETUP) return reject('opening-setup-pending');
    const g = guard(payload); if (g) return reject(g);
    if (lock != null) return reject('v2-locks-disabled');
    const placed = sanitizeTiles(payload.placed);
    const swaps = sanitizeTiles(payload.swappedTiles);
    if (!placed || !swaps) return reject('invalid-tile', { placed: payload.placed });
    if (swaps.length && !s.rules.tileSwaps) return reject('v2-tile-swaps-disabled');
    if (placed.length === 0) return reject(swaps.length ? 'swap-needs-placement' : 'empty-move', { placed });
    const all = [...placed, ...swaps];
    if (all.some(p => !isOnGrid(p.r, p.c))) return reject('off-grid', { placed });
    if (new Set(all.map(p => `${p.r},${p.c}`)).size !== all.length) return reject('duplicate-placement', { placed });
    const occ = placed.find(p => getCommittedTile(state, p.r, p.c));
    if (occ) return reject('placed-on-occupied-cell', { placed, occupiedCell: { r: occ.r, c: occ.c } });
    if (swaps.some(sw => !getCommittedTile(state, sw.r, sw.c))) return reject('swap-no-tile', { placed, swappedTiles: swaps });

    const slot = state.currentTurnSlot;
    const rackCopy = [...(state.racks[slot] ?? [])];
    const take = (t) => {
      const i = rackCopy.indexOf(t.isJoker ? '?' : t.letter);
      if (i < 0) return false;
      rackCopy.splice(i, 1);
      return true;
    };
    const displaced = swaps.map(sw => getCommittedTile(state, sw.r, sw.c));
    for (let i = 0; i < swaps.length; i++) {
      if (!take(swaps[i])) return reject('placed-not-in-rack', { placed, missing: swaps[i].isJoker ? '?' : swaps[i].letter });
      rackCopy.push(displaced[i].isJoker ? '?' : displaced[i].letter);
    }
    for (const p of placed) {
      if (!take(p)) return reject('placed-not-in-rack', { placed, missing: p.isJoker ? '?' : p.letter });
    }

    // Validation and scoring see swaps as placements on their squares (the
    // placed overlay wins over the committed tile), so nothing is mutated yet.
    const validation = validateMove(state, all);
    if (!validation.ok) return reject(validation.reason, { placed });
    if (state.firstMove && !coversCenter(placed, s.rules)) return reject('opening-not-center', { placed });

    const words = getAllWords(state, all);
    if (words.length === 0 || words[0].length < s.rules.minimumWordLength) return reject('word-too-short', { placed });
    const invalidWords = words.filter(w => !isWordValid(w.map(t => t.letter).join('')));
    if (invalidWords.length) {
      return reject('word-not-in-dictionary', {
        placed,
        invalidWords: invalidWords.map(w => w.map(t => t.letter).join('')),
        invalidWordTiles: invalidWords.map(w => w.map(t => ({ r: t.r, c: t.c, letter: t.letter, val: t.val }))),
      });
    }

    const activeAtStart = s.phase === PHASE.NORMAL ? s.activeBoosts : [];
    const boostResults = evaluateMoveBoosts({ activeBoosts: activeAtStart, definitions: s.definitions, words, placed: all });
    const breakdown = buildScoreBreakdown({ words, placedCount: all.length, boostResults, rules: s.rules });
    const consumedIds = breakdown.consumedBoostIds;

    // A move that empties the rack with an empty bag ends the match — no
    // replacement placement is required for it (spec §23; AUDIT A8).
    const endsGame = state.bag.length === 0 && rackCopy.length === 0;
    const { remaining, entries, legal, plan } = planForMove(state, placed, consumedIds);
    const effectivePlan = endsGame ? { placeable: 0, effective: [], arrangement: [] } : plan;
    const submitted = endsGame ? [] : (Array.isArray(boostPlacements) ? boostPlacements : []);
    const pv = validatePlacements({ plan: effectivePlan, placements: submitted, legal });
    if (!pv.ok) {
      return reject(pv.reason, {
        placed, boostPlacements: submitted, expected: effectivePlan.placeable,
        replacements: effectivePlan.effective.map(e => ({ ...e })),
      });
    }

    // ── commit ── (nothing above mutated state)
    const moveTurn = state.turnNumber;
    const rack = state.racks[slot];
    for (let i = 0; i < swaps.length; i++) {
      const sw = swaps[i];
      setCommittedTile(state, sw.r, sw.c, { letter: sw.letter, val: sw.val, isJoker: sw.isJoker });
      rack.splice(rack.indexOf(sw.isJoker ? '?' : sw.letter), 1);
      rack.push(displaced[i].isJoker ? '?' : displaced[i].letter);
    }
    applyMove(state, placed, breakdown.totalScore);
    const newBoosts = effectivePlan.effective.map((e, i) => ({
      instanceId: e.instanceId,
      definitionId: e.definitionId,
      effectiveDefinitionId: e.effectiveDefinitionId,
      r: Number(submitted[i].r),
      c: Number(submitted[i].c),
      placedOnTurn: moveTurn,
      placedBySlot: slot,
    }));
    s.activeBoosts = [...remaining.map(b => ({ ...b })), ...newBoosts];
    s.consumedInstanceIds.push(...consumedIds);
    advance(s.queue, effectivePlan.placeable);
    const pending = endsGame ? 0 : Math.max(0, entries.length - effectivePlan.placeable);
    afterTurnEnded();
    commitMeta(payload);

    const wordsText = words.map(w => w.map(t => t.letter).join(''));
    const wordTiles = words.map(w => w.map(t => ({ r: t.r, c: t.c, letter: t.letter, val: t.val, ex: !!t.ex })));
    const swapRecord = swaps.map((sw, i) => ({
      r: sw.r, c: sw.c,
      newLetter: sw.letter, newVal: sw.val, newIsJoker: sw.isJoker,
      oldLetter: displaced[i].letter, oldVal: displaced[i].val, oldIsJoker: !!displaced[i].isJoker,
    }));
    state.moveHistory.push({
      slot,
      tiles: all.map(p => ({ r: p.r, c: p.c, letter: p.letter, val: p.val, isJoker: p.isJoker })),
      swappedTiles: swapRecord,
      words: wordsText,
      wordTiles,
      score: breakdown.totalScore,
      breakdown,
      boostPlacements: newBoosts.map(b => ({ ...b })),
      moveId: payload.moveId ?? null,
      ts: Date.now(),
    });
    state.lastTurnEffects = [];

    emit(EV.MOVE_CONFIRMED, {
      slot, placed: all, swappedTiles: swaps, words: wordsText, wordTiles,
      score: breakdown.totalScore, multiplier: 1,
      ruleset: 'BOOST_V2', breakdown, boostPlacements: newBoosts,
    });
    for (const r of breakdown.boostResults) {
      telemetry('boost-consumed', { instanceId: r.instanceId, definitionId: r.definitionId, family: r.family, difficulty: r.difficulty });
      telemetry(r.completed ? 'boost-completed' : 'boost-failed', { instanceId: r.instanceId, family: r.family, difficulty: r.difficulty, reward: r.reward });
    }
    for (const b of newBoosts) {
      telemetry('boost-placed', { instanceId: b.instanceId, definitionId: b.effectiveDefinitionId, phase: 'replacement' });
    }
    if (pending > 0) telemetry('replacement-placement-unavailable', { pending });
    if (breakdown.fullRackBonus) telemetry('full-rack-bonus', { bonus: breakdown.fullRackBonus });
    emit(EV.SCORE_CHANGED, { slot, score: state.scores[slot] });
    boostsChanged();
    return endTurn(slot, 'move');
  }

  function endTurn(prevSlot, reason) {
    if (isGameOver(state)) return 'game-over';
    emit(EV.TURN_CHANGED, {
      currentTurnSlot: state.currentTurnSlot,
      turnNumber: state.turnNumber,
      reason: v2().phase === PHASE.OPENING_SETUP ? 'boost-setup' : reason,
      prevSlot,
    });
    return null;
  }

  // ── PASS_TURN ───────────────────────────────────────────────────────────
  function handlePass(payload = {}) {
    const reason = payload.reason ?? 'pass';
    if (v2().phase === PHASE.OPENING_SETUP) {
      // AUDIT A6 (decided): pass or timeout → the opponent places this Boost.
      return handleSkipOpeningStep(payload, reason);
    }
    const g = guard(payload); if (g) return reject(g);
    const slot = state.currentTurnSlot;
    applyPass(state);
    afterTurnEnded();
    commitMeta(payload);
    boostsChanged();
    return endTurn(slot, reason);
  }

  // ── EXCHANGE_TILE ──────────────────────────────────────────────────────
  function handleExchange(payload = {}) {
    if (v2().phase === PHASE.OPENING_SETUP) return reject('opening-setup-pending', { command: CMD.EXCHANGE_TILE });
    if (payload.freeSwap) return reject('free-swap-unavailable');
    const g = guard(payload); if (g) return reject(g);
    const letters = Array.isArray(payload.letters) ? payload.letters : [];
    const slot = state.currentTurnSlot;
    const rack = state.racks[slot];
    if (state.bag.length === 0) return reject('exchange-bag-empty');
    if (letters.length < 1) return reject('exchange-invalid', { detail: 'empty letter list' });
    if (letters.length > Math.min(rack.length, state.bag.length)) return reject('exchange-too-many', { max: Math.min(rack.length, state.bag.length) });
    const probe = [...rack];
    for (const l of letters) {
      const i = probe.indexOf(l);
      if (i < 0) return reject('exchange-invalid', { detail: `rack does not contain ${l}` });
      probe.splice(i, 1);
    }
    // Draw replacements BEFORE returning (spec §7 recommended default), so a
    // player can never redraw the same physical tiles they just returned.
    const drawn = [];
    for (let i = 0; i < letters.length; i++) drawn.push(state.bag.pop());
    state.racks[slot] = [...probe, ...drawn];
    const rng = typeof state.exchangeRng === 'function'
      ? state.exchangeRng : (typeof state.rng === 'function' ? state.rng : Math.random);
    returnTilesAndShuffle(state.bag, letters, rng);
    state.passCount += 1;   // existing rule: exchanges are scoreless turns
    advanceTurn(state);
    afterTurnEnded();
    commitMeta(payload);
    emit(EV.TILES_EXCHANGED, { count: letters.length, free: false, slot });
    telemetry('tile-exchange', { count: letters.length });
    boostsChanged();
    return endTurn(slot, 'exchange');
  }

  // Returns: undefined when not a V2 command (fall through to legacy),
  // otherwise 'game-over' (caller finishes the game) or null.
  function dispatch(cmd) {
    const p = cmd.payload ?? {};
    switch (cmd.type) {
      case CMD.CONFIRM_MOVE:        return { result: handleConfirmMove(p) };
      case CMD.PASS_TURN:           return { result: handlePass(p) };
      case CMD.EXCHANGE_TILE:       return { result: handleExchange(p) };
      case CMD.PLACE_OPENING_BOOST: return { result: handlePlaceOpeningBoost(p) };
      case CMD.PLACE_LOCK:          reject('v2-locks-disabled'); return { result: null };
      case CMD.ACTIVATE_BOOST:
      case CMD.FINALIZE_BOOST_AWARD: reject('v2-legacy-bonus-disabled'); return { result: null };
      default: return undefined;
    }
  }

  return { dispatch, telemetry };
}
