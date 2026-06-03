// Turn lifecycle: pass / exchange / resign / game-end detection.
//
// Pure functions over engine state. Each returns a new event description that
// the gameEngine consumes; this module never mutates state directly. (The
// engine itself updates state; we keep transitions describable so they can
// be tested in isolation and replayed from history.)

import { drawInto, returnTilesAndShuffle, RACK_SIZE } from './tileBag.js';
import { setCommittedTile } from './board.js';

export const LEGACY_LOCK_INVENTORY = Object.freeze([3, 3, 5]);
// Number of consecutive scoreless turns (pass, exchange, or illegal-word
// forfeit) that ends the game. 4 = two full scoreless rounds (one each side).
// Lowered from 6 pre-launch (May 2026) so a trailing player can't drag a
// winning opponent forever via repeated exchanges/passes.
export const LEGACY_PASS_GAME_OVER_THRESHOLD = 4;

// Number of consecutive scoreless turns after which the LEADING player may
// claim the win via CMD.CLAIM_STALL_END (rather than waiting out the full
// threshold). 2 = one full scoreless round.
export const STALL_CLAIM_THRESHOLD = 2;

export const TURN_END_REASON = Object.freeze({
  MOVE: 'move',
  PASS: 'pass',
  EXCHANGE: 'exchange',
  TIMEOUT: 'timeout',
  ILLEGAL: 'illegal',
  RESIGN: 'resign',
});

// Game-end heuristics:
//   1. `passCount` reached the threshold — any combination of pass, exchange,
//      or illegal-word forfeit counts as a scoreless turn.
//   2. Bag is empty AND at least one rack is empty.
//   3. State explicitly marked completed / abandoned / expired (resign etc.).
export function isGameOver(state) {
  if (state.passCount >= LEGACY_PASS_GAME_OVER_THRESHOLD) return true;
  if ((state.bag?.length ?? 0) === 0 && (
    (state.racks?.[0]?.length ?? 0) === 0 ||
    (state.racks?.[1]?.length ?? 0) === 0
  )) return true;
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

// Whether `slot` may claim the win under the stalling rule. True when the
// scoreless-turn counter has reached STALL_CLAIM_THRESHOLD, the game is
// still in progress, and `slot` is strictly ahead in score (ties don't
// confer a claim — neither side has a unilateral right to end).
export function canClaimStallEnd(state, slot) {
  if (slot !== 0 && slot !== 1) return false;
  if (isGameOver(state)) return false;
  if ((state.passCount ?? 0) < STALL_CLAIM_THRESHOLD) return false;
  const mine  = state.scores?.[slot] ?? 0;
  const their = state.scores?.[slot === 0 ? 1 : 0] ?? 0;
  return mine > their;
}

export function nextSlot(slot) {
  return slot === 0 ? 1 : 0;
}

// Apply a pass. Mutates the state in place (engine owns mutation; this is
// called from inside the engine's command handler).
//
// All callers — explicit pass, timeout, illegal-word forfeit — count toward
// the scoreless-turn game-over threshold. The legacy `resetPassCount` knob
// was removed when illegal-word forfeits were brought under the same rule
// (May 2026) so a player can't stall indefinitely with bad-word attempts.
export function applyPass(state) {
  state.passCount += 1;
  advanceTurn(state);
}

// Exchange tiles from the rack back into the bag, draw replacements.
// `letters` is an array of letter strings (must each be present in the
// current player's rack). Returns the new tiles drawn (so the engine can
// emit a SCORE_CHANGED / TURN_CHANGED event with diagnostics).
//
// As of May 2026, exchanges count as scoreless turns toward the game-over
// threshold — otherwise a trailing player could exchange forever to drag
// out a lost game.
export function applyExchange(state, letters) {
  exchangeTilesInPlace(state, letters);
  state.passCount += 1;
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
  // Pre-validate ALL letters are in the rack before mutating. Without this,
  // a multi-letter exchange where letter[N] isn't in the rack leaves the
  // letters before it partially removed (the throw stops the loop but the
  // splices that already ran stay). The exception bubbles to handleExchange
  // which emits INVALID_MOVE_REJECTED, but the rack is now short by however
  // many splices completed — tiles disappear, breaking bag-parity. Surfaced
  // by the simulator's fuzz bot.
  const rackProbe = [...rack];
  for (const l of letters) {
    const i = rackProbe.indexOf(l);
    if (i < 0) throw new Error(`exchange: rack does not contain ${l}`);
    rackProbe.splice(i, 1);
  }
  // Validated — now apply the real mutation.
  for (const l of letters) {
    const i = rack.indexOf(l);
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
