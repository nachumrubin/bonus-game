// gameEngine — orchestrates pure game logic. Pure means:
//   - no DOM
//   - no Firebase
//   - no push SDK
//   - no setTimeout for game pacing (timers live in sessions/UI)
//
// State lives inside an engine instance; commands come in via dispatch(),
// events come out via the bus passed to createEngine(). The same engine
// runs offline solo, offline 2-player, bot mode, and all online modes —
// only the session adapter differs.
//
// Concurrent play (e.g. both online clients submit a move at the "same time")
// is handled outside this engine, in roomService transactions. The engine
// itself trusts its caller's ordering.

import { createEmptyBoard, setCommittedTile, getCommittedTile, isOnGrid } from './board.js';
import { createBag, drawInto, RACK_SIZE } from './tileBag.js';
import { validateMove } from './moveValidator.js';
import { getAllWords, scoreMove } from './scoringEngine.js';
import { isValid as isWordValid } from './hebrewDictionary.js';
import {
  applyMove, applyPass, applyExchange, applyFreeExchange, applyResign, applyLock,
  advanceTurn, ensureLockState, isCellLocked, isGameOver, winnerSlot,
  canClaimStallEnd,
} from './turnManager.js';
import { runHook, TRIGGERS } from './boostEngine.js';
import { BDEFS, BONUS_TYPES } from '../boosts/data.js';
import { createRng, shuffle as shuffleRng } from '../../util/rng.js';
import { resolveBonusActivation } from '../boosts/bonusResolver.js';
import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';

const LEGACY_LOCK_INVENTORY = Object.freeze([3, 3, 5]);

/**
 * @typedef {{ uid?: string, displayName?: string, [key: string]: any }} SpinePlayer
 * @typedef {{ r: number, c: number, letter: string, val: number, isJoker?: boolean }} PlacedTile
 * @typedef {{
 *   schemaVersion: 2,
 *   mode: string,
 *   status: 'playing' | 'completed' | 'abandoned',
 *   players: Record<0 | 1, SpinePlayer>,
 *   settings: Record<string, any>,
 *   tileBagSeed: string,
 *   bag: Array<any>,
 *   racks: Record<0 | 1, Array<any>>,
 *   scores: Record<0 | 1, number>,
 *   board: any,
 *   bonusBoard: Map<any, any>,
 *   bonusAssignment: Array<any>,
 *   bonusSqUsed: Record<string, boolean>,
 *   pendingBonuses: Array<any>,
 *   lockedCells: Array<{ id: string, r: number, c: number, ownerSlot: 0 | 1, remainingTurns: number }>,
 *   lockInventory: Record<0 | 1, number[]>,
 *   moveHistory: Array<any>,
 *   activeBoosts: Array<any>,
 *   currentTurnSlot: 0 | 1,
 *   turnNumber: number,
 *   moveCount: number,
 *   passCount: number,
 *   firstMove: boolean,
 *   abandonedBy: 0 | 1 | null
 * }} GameState
 * @typedef {{ type: string, payload?: any }} SpineCommand
 * @typedef {{ emit(type: string, payload?: any): void }} SpineBusWriter
 * @typedef {{ state: GameState, dispatch(cmd: SpineCommand): void, start(): void }} SpineEngine
 */

/**
 * Create a fresh game state with two filled racks and an empty board.
 * @param {{ mode?: string, tileBagSeed: string, players: Record<0 | 1, SpinePlayer>, startingSlot?: 0 | 1, settings?: Record<string, any> }} [options]
 * @returns {GameState}
 */
export function createInitialState({ mode, tileBagSeed, players, startingSlot = 0, settings = {} } = {}) {
  if (!tileBagSeed) throw new Error('tileBagSeed is required');
  if (!players || !players[0] || !players[1]) throw new Error('players[0] and players[1] are required');

  const bag = createBag(tileBagSeed);
  const racks = { 0: [], 1: [] };
  drawInto(bag, racks[0]);
  drawInto(bag, racks[1]);

  return {
    schemaVersion: 2,
    mode: mode ?? 'offline-solo',
    status: 'playing',
    players,
    settings,
    tileBagSeed,
    bag,
    racks,
    scores: { 0: 0, 1: 0 },
    board: createEmptyBoard(),
    bonusBoard: new Map(),
    // Each bonus type appears at most once per game (legacy behaviour at
    // index.html:4815). After dedup we shuffle with a seed derived from
    // the tile-bag seed, take 12 (BDEFS.length), and pad with B9 if we
    // ran out — this ensures B11 / B12 / B13 (word search, honeycomb,
    // wheel of fortune) actually appear instead of always falling through
    // to the deterministic `BONUS_TYPES[idx % length]` fallback that only
    // ever produced B1–B10.
    bonusAssignment: buildBonusAssignment(tileBagSeed),
    bonusSqUsed: {},
    pendingBonuses: [],
    lockedCells: [],
    lockInventory: { 0: [...LEGACY_LOCK_INVENTORY], 1: [...LEGACY_LOCK_INVENTORY] },
    moveHistory: [],
    activeBoosts: [],
    currentTurnSlot: startingSlot,
    turnNumber: 1,
    moveCount: 0,
    passCount: 0,
    firstMove: true,
    abandonedBy: null,
  };
}

/**
 * Create the command-driven game engine for a mutable state object.
 * @param {{ state: GameState, bus: SpineBusWriter }} options
 * @returns {SpineEngine}
 */
export function createEngine({ state, bus }) {
  if (!state) throw new Error('createEngine: state is required');
  if (!bus) throw new Error('createEngine: bus is required');

  function emit(type, payload) { bus.emit(type, payload); }

  function dispatch(cmd) {
    if (!cmd || typeof cmd.type !== 'string') return;
    if (state.status !== 'playing' && cmd.type !== CMD.RESIGN_GAME) return;

    switch (cmd.type) {
      case CMD.CONFIRM_MOVE: return handleConfirmMove(cmd.payload ?? {});
      case CMD.PASS_TURN:    return handlePass(cmd.payload ?? {});
      case CMD.EXCHANGE_TILE:return handleExchange(cmd.payload ?? {});
      case CMD.PLACE_LOCK:   return handlePlaceLock(cmd.payload ?? {});
      case CMD.RESIGN_GAME:  return handleResign(cmd.payload ?? {});
      case CMD.CLAIM_STALL_END: return handleClaimStallEnd(cmd.payload ?? {});
      case CMD.ACTIVATE_BOOST: return handleActivateBoost(cmd.payload ?? {});
      case CMD.FINALIZE_BOOST_AWARD: return handleFinalizeBoostAward(cmd.payload ?? {});
      // PLACE_TILES is purely UI — engine doesn't track in-progress placements
      case CMD.PLACE_TILES: return;
      // QUERY_DICT is read-only and answered by hebrewDictionary directly; UI handles it
      case CMD.QUERY_DICT: return;
      default: return;
    }
  }

  function handleConfirmMove({ placed = [], swappedTiles = [] }) {
    const lockedPlacement = placed.find(p => isCellLocked(state, p.r, p.c));
    if (lockedPlacement) {
      emit(EV.INVALID_MOVE_REJECTED, { reason: 'cell-locked', placed, lockedCell: lockedPlacement });
      return;
    }

    // Reject placement on a cell that already holds a committed tile.
    // setCommittedTile in applyMove would silently overwrite, vanishing
    // the old tile (not on board, not in any rack, not in the bag) —
    // breaking tile-bag conservation. Production UI doesn't let users
    // drop on occupied cells, but the engine must defend regardless;
    // surfaced by the simulator's fuzz bot. Swap targets are EXPECTED
    // to be occupied — they go through the swappedTiles path which has
    // its own swap-no-tile / swap-on-locked checks below.
    const occupiedPlacement = placed.find(p => getCommittedTile(state, p.r, p.c));
    if (occupiedPlacement) {
      emit(EV.INVALID_MOVE_REJECTED, {
        reason: 'placed-on-occupied-cell',
        placed,
        occupiedCell: { r: occupiedPlacement.r, c: occupiedPlacement.c },
      });
      return;
    }

    // Tile-swap support. A swap replaces a committed tile with one from the
    // rack; the displaced tile returns to the rack. A swap is only allowed
    // ALONGSIDE at least one regular placement (the user's rule), and the
    // resulting words must be legal. We pre-mutate the board so validation
    // and scoring run against the post-swap state, then roll back if the
    // move is rejected.
    const swaps = Array.isArray(swappedTiles) ? swappedTiles : [];
    if (swaps.length > 0 && placed.length === 0) {
      emit(EV.INVALID_MOVE_REJECTED, { reason: 'swap-needs-placement', placed, swappedTiles: swaps });
      return;
    }
    for (const s of swaps) {
      if (isCellLocked(state, s.r, s.c)) {
        emit(EV.INVALID_MOVE_REJECTED, { reason: 'swap-on-locked', placed, swappedTiles: swaps });
        return;
      }
      if (!getCommittedTile(state, s.r, s.c)) {
        emit(EV.INVALID_MOVE_REJECTED, { reason: 'swap-no-tile', placed, swappedTiles: swaps });
        return;
      }
    }

    // Defensive: every placed / swapped-in tile must correspond to a real
    // letter in the active player's rack. Production UI only ever drags
    // tiles from the rack, but a malicious or buggy client could send a
    // CONFIRM_MOVE whose letters aren't in the rack. Without this guard,
    // setCommittedTile would add a tile to the board while the rack stays
    // unchanged (applyMove only removes-from-rack if found) — net +1 tile,
    // breaking the bag-parity invariant. Surfaced by the simulator's fuzz
    // bot. Joker tiles are stored in the rack as '?' regardless of the
    // assigned letter, so map isJoker → '?' for the lookup.
    const _activeRack = state.racks[state.currentTurnSlot] ?? [];
    const _rackCopy = [..._activeRack];
    // Process swaps first: each swap consumes the swap-in letter from the
    // rack and releases the displaced board letter back to the rack, making
    // it available for use as a placement in this same move. This mirrors
    // the UI's `displayRackTile` behavior (legacy parity: swapped-in slot
    // immediately shows the displaced letter, playable on the same turn).
    for (const s of swaps) {
      const wanted = s.isJoker ? '?' : s.letter;
      const idx = _rackCopy.indexOf(wanted);
      if (idx < 0) {
        emit(EV.INVALID_MOVE_REJECTED, {
          reason: 'placed-not-in-rack',
          placed, swappedTiles: swaps,
          missing: wanted,
        });
        return;
      }
      _rackCopy.splice(idx, 1);
      const displaced = getCommittedTile(state, s.r, s.c);
      if (displaced) _rackCopy.push(displaced.isJoker ? '?' : displaced.letter);
    }
    for (const p of placed) {
      const wanted = p.isJoker ? '?' : p.letter;
      const idx = _rackCopy.indexOf(wanted);
      if (idx < 0) {
        emit(EV.INVALID_MOVE_REJECTED, {
          reason: 'placed-not-in-rack',
          placed, swappedTiles: swaps,
          missing: wanted,
        });
        return;
      }
      _rackCopy.splice(idx, 1);
    }

    // Snapshot for rollback and capture the displaced letters (they go back
    // to the rack on commit).
    const swapSnapshot = swaps.map(s => ({
      r: s.r, c: s.c,
      old: getCommittedTile(state, s.r, s.c),
    }));
    function rollbackSwaps() {
      for (const snap of swapSnapshot) setCommittedTile(state, snap.r, snap.c, snap.old);
    }
    // Apply swaps in place.
    for (const s of swaps) {
      setCommittedTile(state, s.r, s.c, { letter: s.letter, val: s.val, isJoker: !!s.isJoker });
    }
    // The validation/scoring layer treats swaps as new placements at those
    // coordinates so isCollinear / hasGaps / getAllWords cover them.
    const placedWithSwaps = [...placed, ...swaps.map(s => ({ r: s.r, c: s.c, letter: s.letter, val: s.val, isJoker: !!s.isJoker }))];

    let ctx = { state, placed: placedWithSwaps, words: null, score: 0, activeBoosts: state.activeBoosts, swaps, swapSnapshot };
    ctx = runHook(TRIGGERS.BEFORE_MOVE_VALIDATE, ctx) ?? ctx;

    const validation = validateMove(state, ctx.placed);
    if (!validation.ok) {
      rollbackSwaps();
      emit(EV.INVALID_MOVE_REJECTED, { reason: validation.reason, placed: ctx.placed, swappedTiles: swaps });
      return;
    }

    const words = getAllWords(state, ctx.placed);
    if (words.length === 0 || words[0].length < 2) {
      rollbackSwaps();
      emit(EV.INVALID_MOVE_REJECTED, { reason: 'word-too-short', placed: ctx.placed, swappedTiles: swaps });
      return;
    }

    const invalidWords = words.filter(w => !isWordValid(w.map(t => t.letter).join('')));
    if (invalidWords.length > 0) {
      rollbackSwaps();
      emit(EV.INVALID_MOVE_REJECTED, {
        reason: 'word-not-in-dictionary',
        placed: ctx.placed,
        swappedTiles: swaps,
        invalidWords: invalidWords.map(w => w.map(t => t.letter).join('')),
        // Positional tiles for each invalid word so the UI can paint the red
        // pulse on the whole word (placed letters + already-committed ones).
        invalidWordTiles: invalidWords.map(w => w.map(t => ({ r: t.r, c: t.c, letter: t.letter, val: t.val }))),
      });
      return;
    }

    ctx.words = words;
    ctx.score = scoreMove(words, ctx.placed.length);
    ctx = runHook(TRIGGERS.BEFORE_SCORE_COMMIT, ctx) ?? ctx;

    const slot = state.currentTurnSlot;
    // Process swap rack substitutions BEFORE applyMove so the rack length
    // is correct when applyMove's drawInto refill runs. Each swap exchanges
    // one rack tile for one board tile: remove the swap-in letter (it's
    // now on the board) and put the displaced board letter back on the
    // rack. Net change per swap = 0 tiles. Jokers come back as '?' and
    // forget their previous assignment.
    const rack = state.racks[slot];
    for (let i = 0; i < swaps.length; i++) {
      const s = swaps[i];
      const old = swapSnapshot[i].old;
      const removeLetter = s.isJoker ? '?' : s.letter;
      const returnLetter = old?.isJoker ? '?' : old?.letter;
      const idx = rack.indexOf(removeLetter);
      if (idx >= 0) rack.splice(idx, 1);
      if (returnLetter) rack.push(returnLetter);
    }
    // applyMove only knows about regular `placed` tiles — it sets them on
    // the board (already done by the swap loop above, no-op for those) and
    // removes the played letters from the rack.
    const hasBonusAwardFlow = findBonusActivationIdxs(state, ctx.placed).length > 0;
    applyMove(state, placed, hasBonusAwardFlow ? 0 : ctx.score, {
      commitScore: !hasBonusAwardFlow,
      advance: !hasBonusAwardFlow,
    });

    state.moveHistory.push({
      slot,
      tiles: ctx.placed.map(p => ({ r: p.r, c: p.c, letter: p.letter, val: p.val, isJoker: !!p.isJoker })),
      swappedTiles: swaps.map((s, i) => ({
        r: s.r, c: s.c,
        newLetter: s.letter, newVal: s.val, newIsJoker: !!s.isJoker,
        oldLetter: swapSnapshot[i].old?.letter ?? null,
        oldVal:    swapSnapshot[i].old?.val ?? null,
        oldIsJoker: !!swapSnapshot[i].old?.isJoker,
      })),
      words: words.map(w => w.map(t => t.letter).join('')),
      wordTiles: words.map(w => w.map(t => ({ r: t.r, c: t.c, letter: t.letter, val: t.val, ex: !!t.ex }))),
      score: ctx.score,
      ts: Date.now(),
    });

    if (hasBonusAwardFlow) {
      replaceActiveBoosts(state, ctx.activeBoosts);
      const bonusActivations = collectBonusActivations(state, ctx.placed, slot);
      const movePayload = {
        slot,
        placed: ctx.placed,
        swappedTiles: swaps,
        words: words.map(w => w.map(t => t.letter).join('')),
        wordTiles: words.map(w => w.map(t => ({ r: t.r, c: t.c, letter: t.letter, val: t.val, ex: !!t.ex }))),
      };
      state.pendingScoreCommit = {
        slot,
        baseScore: ctx.score,
        historyIndex: state.moveHistory.length - 1,
        movePayload,
      };
      emit(EV.MOVE_CONFIRMED, { ...movePayload, score: ctx.score, scoringDeferred: true });
      emitBonusActivations(bonusActivations, emit);
      emit(EV.LOCKS_CHANGED, { lockedCells: [...state.lockedCells], lockInventory: cloneLockInventory(state) });
      return;
    }

    ctx = runHook(TRIGGERS.AFTER_SCORE_COMMIT, ctx) ?? ctx;

    const bonusActivations = collectBonusActivations(state, ctx.placed, slot);

    // ON_TURN_END: future-effect boosts like extra_turn fire here. The
    // booster's own turn just ended (applyMove already called advanceTurn),
    // so endingSlot is the slot that played. If a plugin sets repeatTurn,
    // revert the advanceTurn so the same player goes again.
    ctx.endingSlot = slot;
    ctx = runHook(TRIGGERS.ON_TURN_END, ctx) ?? ctx;

    // runHook returns a fresh activeBoosts array (entries whose plugin's
    // consume() returned null are dropped). Persist the result so consumed
    // boosts don't re-fire on every subsequent turn.
    replaceActiveBoosts(state, ctx.activeBoosts);

    if (ctx.repeatTurn) {
      state.currentTurnSlot = slot;
      state.turnNumber = Math.max(1, (state.turnNumber ?? 1) - 1);
    }

    const turnStartEffects = applyTurnStartEffects(state);

    emit(EV.MOVE_CONFIRMED, {
      slot,
      placed: ctx.placed,
      swappedTiles: swaps,
      words: words.map(w => w.map(t => t.letter).join('')),
      wordTiles: words.map(w => w.map(t => ({ r: t.r, c: t.c, letter: t.letter, val: t.val, ex: !!t.ex }))),
      score: ctx.score,
    });
    emitBonusActivations(bonusActivations, emit);
    emitTurnStartEffects(turnStartEffects, emit);
    emit(EV.SCORE_CHANGED, { slot, score: state.scores[slot] });
    emit(EV.LOCKS_CHANGED, { lockedCells: [...state.lockedCells], lockInventory: cloneLockInventory(state) });

    if (isGameOver(state)) finishGame();
    else emit(EV.TURN_CHANGED, { currentTurnSlot: state.currentTurnSlot, turnNumber: state.turnNumber });
  }

  function handlePass({ reason = 'pass' } = {}) {
    const slot = state.currentTurnSlot;
    // All scoreless turns (explicit pass, timeout, illegal-word forfeit)
    // count toward the game-over threshold so a player can't stall by
    // alternating bad-word attempts and exchanges (May 2026 rule update).
    const forfeitedBoosts = (reason === 'timeout' || reason === 'illegal-word')
      ? forfeitTimeoutBoosts(state, slot)
      : [];
    applyPass(state);
    for (const boost of forfeitedBoosts) {
      emit(EV.BOOST_ACTIVATED, { ...boost, slot, consumed: true, reason });
    }
    emit(EV.LOCKS_CHANGED, { lockedCells: [...state.lockedCells], lockInventory: cloneLockInventory(state) });
    const turnStartEffects = applyTurnStartEffects(state);
    emitTurnStartEffects(turnStartEffects, emit);
    if (isGameOver(state)) { finishGame(); return; }
    emit(EV.TURN_CHANGED, {
      currentTurnSlot: state.currentTurnSlot,
      turnNumber: state.turnNumber,
      reason,
      prevSlot: slot,
    });
  }

  function handleExchange({ letters = [], freeSwap = false } = {}) {
    if (state.bag.length < letters.length) {
      emit(EV.INVALID_MOVE_REJECTED, { reason: 'exchange-bag-empty' });
      return;
    }
    const slot = state.currentTurnSlot;
    let consumedBoostIdx = -1;
    if (freeSwap) {
      consumedBoostIdx = (state.activeBoosts ?? []).findIndex(
        b => b && b.slot === slot && b.boostId === 'free_tile_swap',
      );
      if (consumedBoostIdx < 0) {
        emit(EV.INVALID_MOVE_REJECTED, { reason: 'free-swap-unavailable' });
        return;
      }
    }
    try {
      if (freeSwap) applyFreeExchange(state, letters);
      else applyExchange(state, letters);
    } catch (e) {
      emit(EV.INVALID_MOVE_REJECTED, { reason: 'exchange-invalid', detail: e.message });
      return;
    }
    if (freeSwap && consumedBoostIdx >= 0) {
      state.activeBoosts.splice(consumedBoostIdx, 1);
      emit(EV.BOOST_ACTIVATED, { slot, boostId: 'free_tile_swap', consumed: true });
    }
    emit(EV.TILES_EXCHANGED, { count: letters.length, free: !!freeSwap, slot });
    emit(EV.LOCKS_CHANGED, { lockedCells: [...state.lockedCells], lockInventory: cloneLockInventory(state) });
    if (!freeSwap) {
      const turnStartEffects = applyTurnStartEffects(state);
      emitTurnStartEffects(turnStartEffects, emit);
      // applyExchange bumped passCount (May 2026 rule: exchanges are
      // scoreless turns toward game-over). Mirror handlePass / handleConfirmMove
      // and finishGame here if the threshold was hit, otherwise emit TURN_CHANGED.
      if (isGameOver(state)) { finishGame(); return; }
      emit(EV.TURN_CHANGED, { currentTurnSlot: state.currentTurnSlot, turnNumber: state.turnNumber, reason: 'exchange' });
    }
  }

  function handlePlaceLock({ r, c, duration } = {}) {
    ensureLockState(state);
    const slot = state.currentTurnSlot;
    const rr = Number(r);
    const cc = Number(c);
    const d = Number(duration);
    if (!Number.isInteger(rr) || !Number.isInteger(cc) || !isOnGrid(rr, cc)) {
      emit(EV.INVALID_MOVE_REJECTED, { reason: 'lock-out-of-bounds', r, c, duration });
      return;
    }
    if (!Number.isInteger(d) || d <= 0) {
      emit(EV.INVALID_MOVE_REJECTED, { reason: 'lock-invalid-duration', r: rr, c: cc, duration });
      return;
    }
    if (getCommittedTile(state, rr, cc)) {
      emit(EV.INVALID_MOVE_REJECTED, { reason: 'lock-cell-occupied', r: rr, c: cc, duration: d });
      return;
    }
    if (isCellLocked(state, rr, cc)) {
      emit(EV.INVALID_MOVE_REJECTED, { reason: 'lock-cell-already-locked', r: rr, c: cc, duration: d });
      return;
    }
    if (!(state.lockInventory?.[slot] ?? []).includes(d)) {
      emit(EV.INVALID_MOVE_REJECTED, { reason: 'lock-unavailable', r: rr, c: cc, duration: d });
      return;
    }

    try {
      applyLock(state, { r: rr, c: cc, duration: d, slot });
    } catch (e) {
      emit(EV.INVALID_MOVE_REJECTED, { reason: 'lock-invalid', detail: e.message });
      return;
    }
    const lock = state.lockedCells.find(l => l.r === rr && l.c === cc);
    const turnStartEffects = applyTurnStartEffects(state);
    emit(EV.LOCK_PLACED, { slot, lock });
    emit(EV.LOCKS_CHANGED, { lockedCells: [...state.lockedCells], lockInventory: cloneLockInventory(state) });
    emitTurnStartEffects(turnStartEffects, emit);
    emit(EV.TURN_CHANGED, { currentTurnSlot: state.currentTurnSlot, turnNumber: state.turnNumber, reason: 'lock', prevSlot: slot });
  }

  function handleResign({ slot, reason } = {}) {
    const s = (slot === 0 || slot === 1) ? slot : state.currentTurnSlot;
    applyResign(state, s);
    if (reason) state.abandonReason = reason;
    finishGame();
  }

  function handleClaimStallEnd({ slot } = {}) {
    const s = (slot === 0 || slot === 1) ? slot : state.currentTurnSlot;
    if (!canClaimStallEnd(state, s)) {
      emit(EV.INVALID_MOVE_REJECTED, { reason: 'claim-stall-end-not-allowed' });
      return;
    }
    state.endReason = 'stall-claim';
    state.claimedBy = s;
    finishGame();
  }

  function handleActivateBoost({ boostId, payload, slot, bonusIdx = null } = {}) {
    const s = (slot === 0 || slot === 1) ? slot : state.currentTurnSlot;
    markBonusUsed(state, bonusIdx);
    clearPendingBonus(state, bonusIdx);
    // `auto_extra_score` is a one-shot points boost that the player just
    // earned (mini-game success, wheel pts_*, B2/B4/B9 auto). The points
    // aren't applied here — the UI shows a +N overlay with an אישור button
    // and dispatches FINALIZE_BOOST_AWARD on click. That keeps "the bonus
    // arrives when the player acknowledges it" as a single rule across
    // both auto and mini-game outcomes.
    if (boostId === 'auto_extra_score') {
      emit(EV.BOOST_ACTIVATED, { slot: s, boostId, payload, turnNumber: state.turnNumber, bonusIdx });
      return;
    }
    state.activeBoosts.push({ slot: s, boostId, payload, turnNumber: state.turnNumber, bonusIdx });
    emit(EV.BOOST_ACTIVATED, { slot: s, boostId, payload, turnNumber: state.turnNumber, bonusIdx });
  }

  function handleFinalizeBoostAward({ slot, extra = 0, bonusIdx = null } = {}) {
    const s = (slot === 0 || slot === 1) ? slot : state.currentTurnSlot;
    markBonusUsed(state, bonusIdx);
    clearPendingBonus(state, bonusIdx);
    const n = Number(extra) || 0;
    const pending = state.pendingScoreCommit;
    if (pending && pending.slot === s) {
      const baseScore = Number(pending.baseScore) || 0;
      const total = baseScore + n;
      if (total) state.scores[s] = (state.scores[s] ?? 0) + total;
      const history = state.moveHistory?.[pending.historyIndex];
      if (history) {
        history.score = total;
        history.baseScore = baseScore;
        history.bonusExtra = n;
      }
      state.pendingScoreCommit = null;

      let ctx = {
        state,
        placed: pending.movePayload?.placed ?? [],
        words: pending.movePayload?.wordTiles ?? null,
        score: total,
        activeBoosts: state.activeBoosts,
      };
      ctx = runHook(TRIGGERS.AFTER_SCORE_COMMIT, ctx) ?? ctx;
      advanceTurn(state);
      ctx.endingSlot = s;
      ctx = runHook(TRIGGERS.ON_TURN_END, ctx) ?? ctx;
      replaceActiveBoosts(state, ctx.activeBoosts);

      if (ctx.repeatTurn) {
        state.currentTurnSlot = s;
        state.turnNumber = Math.max(1, (state.turnNumber ?? 1) - 1);
      }

      const turnStartEffects = applyTurnStartEffects(state);
      emit(EV.MOVE_SCORE_COMMITTED, {
        ...(pending.movePayload ?? {}),
        score: total,
        baseScore,
        bonusExtra: n,
      });
      emitTurnStartEffects(turnStartEffects, emit);
      emit(EV.SCORE_CHANGED, { slot: s, score: state.scores[s] });
      emit(EV.LOCKS_CHANGED, { lockedCells: [...state.lockedCells], lockInventory: cloneLockInventory(state) });
      if (isGameOver(state)) finishGame();
      else emit(EV.TURN_CHANGED, { currentTurnSlot: state.currentTurnSlot, turnNumber: state.turnNumber, prevSlot: s, reason: 'move' });
      return;
    }
    if (n) {
      state.scores[s] = (state.scores[s] ?? 0) + n;
      emit(EV.SCORE_CHANGED, { slot: s, score: state.scores[s] });
    }
  }

  function finishGame() {
    state.status = state.status === 'abandoned' ? 'abandoned' : 'completed';
    emit(EV.GAME_COMPLETED, {
      status: state.status,
      winnerSlot: winnerSlot(state),
      scores: { ...state.scores },
      abandonedBy: state.abandonedBy,
      abandonReason: state.abandonReason ?? null,
    });
  }

  function start() {
    emit(EV.GAME_STARTED, {
      mode: state.mode,
      players: state.players,
      currentTurnSlot: state.currentTurnSlot,
    });
  }

  return {
    state,            // exposed read-only by convention; do not mutate from outside
    dispatch,
    start,
  };
}

function cloneLockInventory(state) {
  ensureLockState(state);
  return { 0: [...state.lockInventory[0]], 1: [...state.lockInventory[1]] };
}

function replaceActiveBoosts(state, activeBoosts) {
  if (!Array.isArray(activeBoosts)) return;
  state.activeBoosts.length = 0;
  state.activeBoosts.push(...activeBoosts);
}

function findBonusActivationIdxs(state, placed) {
  const used = state.bonusSqUsed ?? (state.bonusSqUsed = {});
  const out = [];
  const seen = new Set();
  for (let idx = 0; idx < BDEFS.length; idx++) {
    if (used[idx]) continue;
    const bonus = BDEFS[idx];
    if (!placed.some(p => p.r === bonus.br && p.c === bonus.bc)) continue;
    if (seen.has(idx)) continue;
    seen.add(idx);
    out.push(idx);
  }
  return out;
}

function collectBonusActivations(state, placed, slot) {
  const out = [];
  for (const idx of findBonusActivationIdxs(state, placed)) {
    markBonusUsed(state, idx);

    const bonusType = bonusTypeForIdx(state, idx);
    const result = resolveBonusActivation({ bonusType, slot, turnNumber: state.turnNumber });
    if (result.error) {
      out.push({ kind: 'error', idx, bonusType, error: result.error, slot, turnNumber: state.turnNumber });
      continue;
    }
    for (const entry of result.entries ?? []) {
      const withIdx = { ...entry, bonusIdx: idx };
      if (entry.boostId === 'auto_extra_score') {
        out.push({ kind: 'boost', entry: withIdx });
      } else {
        state.activeBoosts.push(withIdx);
        out.push({ kind: 'boost', entry: withIdx });
      }
    }
    if (result.miniGamePending || result.wheelPending) {
      const pending = {
        idx,
        bonusType,
        slot,
        turnNumber: state.turnNumber,
        miniGameKey: result.miniGameKey,
        kind: result.wheelPending ? 'wheel' : 'minigame',
      };
      if (!Array.isArray(state.pendingBonuses)) state.pendingBonuses = [];
      state.pendingBonuses.push(pending);
      out.push({ kind: 'pending', pending });
    }
  }
  return out;
}

function emitBonusActivations(activations, emit) {
  for (const activation of activations ?? []) {
    if (activation.kind === 'boost') {
      emit(EV.BOOST_ACTIVATED, activation.entry);
    } else if (activation.kind === 'pending') {
      emit(EV.BONUS_PENDING, activation.pending);
    } else if (activation.kind === 'error') {
      emit(EV.INVALID_MOVE_REJECTED, {
        reason: 'bonus-activation-error',
        bonusIdx: activation.idx,
        bonusType: activation.bonusType,
        detail: activation.error,
      });
    }
  }
}

function applyTurnStartEffects(state) {
  if (state.status !== 'playing') return [];
  const effects = [];
  const startingSlot = state.currentTurnSlot;
  let ctx = {
    state,
    startingSlot,
    activeBoosts: state.activeBoosts,
  };
  ctx = runHook(TRIGGERS.ON_TURN_START, ctx) ?? ctx;
  if (Array.isArray(ctx.activeBoosts)) {
    state.activeBoosts.length = 0;
    state.activeBoosts.push(...ctx.activeBoosts);
  }
  if (ctx.skipTurn) {
    effects.push({ type: 'skip-turn', slot: startingSlot });
    state.currentTurnSlot = startingSlot === 0 ? 1 : 0;
    state.turnNumber = (state.turnNumber ?? 1) + 1;
  }

  const tileSwap = (state.activeBoosts ?? []).find(
    b => b && b.slot === state.currentTurnSlot && b.boostId === 'free_tile_swap',
  );
  if (tileSwap) {
    state.pendingTurnEffect = { type: 'tileSwap', player: state.currentTurnSlot };
    effects.push({ type: 'tile-swap', slot: state.currentTurnSlot });
  } else if (state.pendingTurnEffect?.type === 'tileSwap') {
    state.pendingTurnEffect = null;
  }
  return effects;
}

function emitTurnStartEffects(effects, emit) {
  for (const effect of effects ?? []) {
    if (effect.type === 'skip-turn') {
      emit(EV.BOOST_ACTIVATED, { slot: effect.slot === 0 ? 1 : 0, boostId: 'skip_opponent_turn', consumed: true, skippedSlot: effect.slot });
    } else if (effect.type === 'tile-swap') {
      emit(EV.BOOST_ACTIVATED, { slot: effect.slot, boostId: 'free_tile_swap', pending: true });
    }
  }
}

function bonusTypeForIdx(state, idx) {
  const assignment = state.bonusAssignment?.[idx];
  return assignment?.type ?? assignment ?? BONUS_TYPES[idx % BONUS_TYPES.length].type;
}

function markBonusUsed(state, bonusIdx) {
  if (bonusIdx === null || bonusIdx === undefined) return;
  const idx = Number(bonusIdx);
  if (!Number.isInteger(idx)) return;
  if (!state.bonusSqUsed) state.bonusSqUsed = {};
  state.bonusSqUsed[idx] = true;
}

function clearPendingBonus(state, bonusIdx) {
  if (bonusIdx === null || bonusIdx === undefined || !Array.isArray(state.pendingBonuses)) return;
  const idx = Number(bonusIdx);
  state.pendingBonuses = state.pendingBonuses.filter(p => Number(p?.idx) !== idx);
}

function forfeitTimeoutBoosts(state, slot) {
  const forfeited = [];
  const active = Array.isArray(state.activeBoosts) ? state.activeBoosts : [];
  state.activeBoosts = active.filter(boost => {
    if (boost?.slot === slot && boost.boostId === 'multiply_next_turns') {
      forfeited.push(boost);
      return false;
    }
    return true;
  });
  return forfeited;
}

// Legacy bonus-assignment shuffle. Deduplicates BONUS_TYPES by `type` so
// each bonus appears at most once per game, shuffles deterministically from
// `${seed}/bonus`, pads to BDEFS.length with B9 (free 25 pts), and returns
// the first BDEFS.length entries.
function buildBonusAssignment(seed) {
  const seen = new Set();
  const unique = [];
  for (const b of BONUS_TYPES) {
    if (seen.has(b.type)) continue;
    seen.add(b.type);
    unique.push({ ...b });
  }
  const rng = createRng(`${seed}/bonus`);
  shuffleRng(unique, rng);
  while (unique.length < BDEFS.length) {
    unique.push({ type: 'B9', pts: 25, ic: '⚡' });
  }
  return unique.slice(0, BDEFS.length);
}
