// invariants.mjs
//
// Per-tick assertions over a Firebase room snapshot. Each invariant returns
// either null (passed) or `{ class, detail }` (violated). The runner calls
// checkInvariants(prev, next, ctx) after every commitTransaction round-trip
// and reports any returned violations to the crash collector.
//
// We intentionally read raw room fields rather than going through
// engineStateFromRoom — these checks are about the bytes that actually live
// in Firebase, which is what other clients will see. If serialization quietly
// strips a field, that's a bug we want to catch.

import { HD } from '../../src/game/core/letterDistribution.js';
import { LEGACY_PASS_GAME_OVER_THRESHOLD } from '../../src/game/core/turnManager.js';

const TOTAL_TILES = Object.values(HD).reduce((s, n) => s + n, 0);

/**
 * @typedef {{ class: string, detail: string }} Violation
 */

/** @returns {Violation[]} */
export function checkInvariants(prev, next, ctx = {}) {
  const out = [];
  if (!next) return out; // room was deleted; not our concern here

  push(out, checkSchemaVersion(next));
  push(out, checkVersionMonotonic(prev, next));
  push(out, checkBagParity(next));
  push(out, checkTurnSlotBounds(next));
  push(out, checkLiveBonusGate(prev, next));
  push(out, checkMissedTurns(next));
  push(out, checkPassCount(next));
  push(out, checkTerminalShape(next));
  return out;
}

function push(arr, v) { if (v) arr.push(v); }

function checkSchemaVersion(room) {
  if (room.schemaVersion !== 2) {
    return v('schema-version-wrong', `schemaVersion=${room.schemaVersion}, expected 2`);
  }
  return null;
}

function checkVersionMonotonic(prev, next) {
  if (!prev) return null;
  const a = Number(prev.version);
  const b = Number(next.version);
  if (!Number.isFinite(b)) return v('version-missing', `next.version=${next.version}`);
  if (b < a) return v('version-non-monotonic', `version went ${a} -> ${b}`);
  // Skipping versions is suspicious (could be legitimate if multiple txns ran
  // between observations, but our runner observes after every commit).
  if (b > a + 5) return v('version-jump', `version jumped from ${a} to ${b}`);
  return null;
}

function checkBagParity(room) {
  const bagN = countArrayOrObject(room.bag);
  const r0 = countArrayOrObject(room.racks?.[0] ?? room.racks?.['0']);
  const r1 = countArrayOrObject(room.racks?.[1] ?? room.racks?.['1']);
  const onBoard = countBoardTiles(room.board);
  // Off-grid placements (the 12 BDEFS bonus squares at r/c ∈ {-1, 10}) are
  // stored in bonusBoard as { "r,c": {letter,...} }, NOT in board. They're
  // real tiles drawn from the bag and must be counted toward parity.
  const onBonusBoard = countBonusBoardTiles(room.bonusBoard);
  const total = bagN + r0 + r1 + onBoard + onBonusBoard;
  if (total !== TOTAL_TILES) {
    return v('bag-parity',
      `bag=${bagN} r0=${r0} r1=${r1} board=${onBoard} bonusBoard=${onBonusBoard} total=${total} expected=${TOTAL_TILES}`);
  }
  return null;
}

function checkTurnSlotBounds(room) {
  if (room.status !== 'playing') return null;
  const slot = Number(room.currentTurnSlot);
  if (slot !== 0 && slot !== 1) {
    return v('turn-slot-out-of-range', `currentTurnSlot=${room.currentTurnSlot} status=playing`);
  }
  return null;
}

function checkLiveBonusGate(prev, next) {
  if (!prev || !next) return null;
  // If liveBonus was active in the prev snapshot and the turn flipped in the
  // next snapshot, the watchdog gate was violated. (A legitimate turn flip
  // requires the mini-game to resolve first, which clears liveBonus.)
  const prevActive = !!prev.liveBonus?.active;
  if (!prevActive) return null;
  const nextActive = !!next.liveBonus?.active;
  if (!nextActive) return null; // mini-game cleared, turn flip would be fine
  if (Number(prev.currentTurnSlot) !== Number(next.currentTurnSlot)) {
    return v('live-bonus-gate-violation',
      `turn flipped ${prev.currentTurnSlot} -> ${next.currentTurnSlot} while liveBonus.active=true`);
  }
  return null;
}

function checkMissedTurns(room) {
  const a = Number(room.missedTurns?.[0] ?? room.missedTurns?.['0'] ?? 0);
  const b = Number(room.missedTurns?.[1] ?? room.missedTurns?.['1'] ?? 0);
  if (a > 2 || b > 2) {
    return v('missed-turns-exceeded', `missedTurns=[${a}, ${b}], forfeit threshold is 2`);
  }
  return null;
}

function checkPassCount(room) {
  // passCount is mirrored in `_passCount` on the room doc.
  const pc = Number(room._passCount ?? 0);
  if (pc > LEGACY_PASS_GAME_OVER_THRESHOLD + 1) {
    // +1 tolerance: the commit that triggers game-over may briefly have
    // passCount === threshold before status flips to completed on next tick.
    return v('pass-count-exceeded',
      `_passCount=${pc} exceeds threshold ${LEGACY_PASS_GAME_OVER_THRESHOLD}`);
  }
  return null;
}

function checkTerminalShape(room) {
  if (room.status !== 'completed' && room.status !== 'abandoned' && room.status !== 'expired') return null;
  // Once terminal, scores must be present and integer.
  const s0 = room.scores?.[0] ?? room.scores?.['0'];
  const s1 = room.scores?.[1] ?? room.scores?.['1'];
  if (s0 == null || s1 == null || !Number.isFinite(Number(s0)) || !Number.isFinite(Number(s1))) {
    return v('terminal-scores-missing', `status=${room.status} scores=${JSON.stringify(room.scores)}`);
  }
  return null;
}

function v(klass, detail) { return { class: klass, detail }; }

// Bag/rack may serialize as either a plain array or a sparse object depending
// on Firebase's compaction. Count both ways.
function countArrayOrObject(value) {
  if (Array.isArray(value)) return value.filter(x => x != null).length;
  if (value && typeof value === 'object') return Object.values(value).filter(x => x != null).length;
  return 0;
}

// board is a 100-cell flat (array or object) of {letter,val,isJoker} or null.
function countBoardTiles(board) {
  if (!board) return 0;
  const cells = Array.isArray(board) ? board : Object.values(board);
  let n = 0;
  for (const cell of cells) {
    if (cell && cell.letter) n++;
  }
  return n;
}

// bonusBoard is stored as { "r,c": {letter,...} } — only entries with a
// letter count (the map may also hold metadata for un-triggered squares).
function countBonusBoardTiles(bonusBoard) {
  if (!bonusBoard || typeof bonusBoard !== 'object') return 0;
  let n = 0;
  for (const v of Object.values(bonusBoard)) {
    if (v && v.letter) n++;
  }
  return n;
}

export const _internal = { TOTAL_TILES };
