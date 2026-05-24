// Turn lifecycle: pass / exchange / resign / game-end detection.
//
// Pure functions over engine state. Each returns a new event description that
// the gameEngine consumes; this module never mutates state directly. (The
// engine itself updates state; we keep transitions describable so they can
// be tested in isolation and replayed from history.)

import { drawInto, returnTilesAndShuffle, RACK_SIZE } from './tileBag.js';
import { setCommittedTile } from './board.js';

export const LEGACY_LOCK_INVENTORY = Object.freeze([3, 3, 5]);
export const LEGACY_PASS_GAME_OVER_THRESHOLD = 6;

export const TURN_END_REASON = Object.freeze({
  MOVE: 'move',
  PASS: 'pass',
  EXCHANGE: 'exchange',
  TIMEOUT: 'timeout',
  ILLEGAL: 'illegal',
  RESIGN: 'resign',
});

// Both players passing twice in a row, OR bag empty + a player can't play and
// passes — legacy game-end heuristic. We use the simpler "two consecutive
// passes" rule, which covers both cases (if bag empty and a player can't move,
// they pass; opponent then either moves or also passes).
export function isGameOver(state) {
  if (state.passCount >= LEGACY_PASS_GAME_OVER_THRESHOLD) return true;
  if ((state.bag?.length ?? 0) === 0 && (
    (state.racks?.[0]?.length ?? 0) === 0 ||
    (state.racks?.[1]?.length ?? 0) === 0
  )) return true;
  const settings = state.settings ?? {};
  const legacyLimit = settings.moveLimitOn && Number(settings.moveLimit) > 0
    ? Number(settings.moveLimit)
    : null;
  const modularLimit = settings.movelimit && Number(settings.maxMoves) > 0
    ? Number(settings.maxMoves)
    : null;
  const moveLimit = legacyLimit ?? modularLimit;
  if (moveLimit && (state.moveCount ?? 0) >= moveLimit) return true;
  if (state.status === 'completed' || state.status === 'abandoned' || state.status === 'expired') {
    return true;
  }
  return false;
}

export function winnerSlot(state) {
  if (state.status === 'abandoned' && state.abandonedBy != null) {
    return state.abandonedBy === 0 ? 1 : 0;
  }
  const a = state.scores[0] ?? 0;
  const b = state.scores[1] ?? 0;
  if (a > b) return 0;
  if (b > a) return 1;
  return null; // tie
}

export function nextSlot(slot) {
  return slot === 0 ? 1 : 0;
}

// Apply a pass. Mutates the state in place (engine owns mutation; this is
// called from inside the engine's command handler).
//
// `resetPassCount: true` skips the increment AND clears the counter — used
// when the engine treats the "pass" as a forfeit-after-illegal-word, which
// shouldn't count toward the two-consecutive-passes game-over heuristic.
export function applyPass(state, { resetPassCount = false } = {}) {
  if (resetPassCount) state.passCount = 0;
  else state.passCount += 1;
  advanceTurn(state);
}

// Exchange tiles from the rack back into the bag, draw replacements.
// `letters` is an array of letter strings (must each be present in the
// current player's rack). Returns the new tiles drawn (so the engine can
// emit a SCORE_CHANGED / TURN_CHANGED event with diagnostics).
export function applyExchange(state, letters) {
  exchangeTilesInPlace(state, letters);
  state.passCount = 0;
  advanceTurn(state);
}

// Free-swap variant used by the B13 wheel's free_tile_swap boost. Same rack/
// bag mechanics, but turn does not advance and passCount is left untouched.
export function applyFreeExchange(state, letters) {
  exchangeTilesInPlace(state, letters);
}

function exchangeTilesInPlace(state, letters) {
  if (letters.length === 0) throw new Error('exchange: empty letter list');
  if (state.bag.length < letters.length) throw new Error('exchange: not enough tiles in bag');
  const slot = state.currentTurnSlot;
  const rack = state.racks[slot];
  for (const l of letters) {
    const i = rack.indexOf(l);
    if (i < 0) throw new Error(`exchange: rack does not contain ${l}`);
    rack.splice(i, 1);
  }
  const rng = typeof state.exchangeRng === 'function'
    ? state.exchangeRng
    : (typeof state.rng === 'function' ? state.rng : Math.random);
  returnTilesAndShuffle(state.bag, letters, rng);
  drawInto(state.bag, rack, RACK_SIZE);
}

// Resign immediately. Status flips to 'abandoned'; the engine emits
// GAME_COMPLETED.
export function applyResign(state, slot) {
  state.status = 'abandoned';
  state.abandonedBy = slot;
}

// Apply a successful move: commits tiles to the board, updates score,
// refills rack, advances turn.
//
// `placed` is the list of placements; `score` is the integer awarded.
// Returns nothing — mutates state.
export function applyMove(state, placed, score, { commitScore = true, advance = true } = {}) {
  const slot = state.currentTurnSlot;
  for (const p of placed) {
    setCommittedTile(state, p.r, p.c, { letter: p.letter, val: p.val, isJoker: !!p.isJoker });
    // Remove the played tile from the rack
    const rack = state.racks[slot];
    const removeLetter = p.isJoker ? '?' : p.letter;
    const idx = rack.indexOf(removeLetter);
    if (idx >= 0) rack.splice(idx, 1);
  }
  if (commitScore) state.scores[slot] = (state.scores[slot] ?? 0) + score;
  drawInto(state.bag, state.racks[slot], RACK_SIZE);
  state.passCount = 0;
  state.firstMove = false;
  state.moveCount = (state.moveCount ?? 0) + 1;
  if (advance) advanceTurn(state);
}

export function applyLock(state, { r, c, duration, slot = state.currentTurnSlot } = {}) {
  ensureLockState(state);
  const inventory = state.lockInventory?.[slot] ?? [];
  const idx = inventory.indexOf(duration);
  if (idx < 0) throw new Error('lock: duration not available');
  inventory.splice(idx, 1);
  state.lockedCells.push({
    id: `${state.turnNumber}:${slot}:${r}:${c}:${duration}`,
    r,
    c,
    ownerSlot: slot,
    remainingTurns: duration,
  });
  state.passCount = 0;
  advanceTurn(state, { tickLocks: false });
}

export function isCellLocked(state, r, c) {
  ensureLockState(state);
  return state.lockedCells.some(lock =>
    lock.r === r &&
    lock.c === c &&
    Number(lock.remainingTurns) > 0
  );
}

export function ensureLockState(state) {
  if (!state.lockInventory) state.lockInventory = { 0: [...LEGACY_LOCK_INVENTORY], 1: [...LEGACY_LOCK_INVENTORY] };
  state.lockInventory[0] = Array.isArray(state.lockInventory[0]) ? state.lockInventory[0] : [];
  state.lockInventory[1] = Array.isArray(state.lockInventory[1]) ? state.lockInventory[1] : [];
  if (!Array.isArray(state.lockedCells)) state.lockedCells = [];
  state.lockedCells = state.lockedCells
    .map(lock => ({
      id: lock.id ?? `${lock.ownerSlot ?? 'x'}:${lock.r}:${lock.c}:${lock.remainingTurns}`,
      r: Number(lock.r),
      c: Number(lock.c),
      ownerSlot: lock.ownerSlot === 1 ? 1 : 0,
      remainingTurns: Number(lock.remainingTurns ?? lock.turns ?? 0),
    }))
    .filter(lock =>
      Number.isInteger(lock.r) &&
      Number.isInteger(lock.c) &&
      Number.isFinite(lock.remainingTurns) &&
      lock.remainingTurns > 0
    );
}

export function tickLocks(state) {
  ensureLockState(state);
  state.lockedCells = state.lockedCells
    .map(lock => ({ ...lock, remainingTurns: lock.remainingTurns - 1 }))
    .filter(lock => lock.remainingTurns > 0);
}

export function advanceTurn(state, { tickLocks: shouldTickLocks = true } = {}) {
  if (shouldTickLocks) tickLocks(state);
  state.turnNumber += 1;
  state.currentTurnSlot = nextSlot(state.currentTurnSlot);
}
