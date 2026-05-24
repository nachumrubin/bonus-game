// Move validation.
//
// A move is the set of tiles a player has placed in their turn. validateMove()
// runs all geometric/connectivity checks. Dictionary checks live in
// scoringEngine.getAllWords() / hebrewDictionary.isValid() — they're fed the
// words this module identified.
//
// Pure: returns { ok: boolean, reason?: string }; never mutates state.

import { getTileAt, getCommittedTile, isBonusPos } from './board.js';

export function isCollinear(placed) {
  if (placed.length <= 1) return true;
  const rows = new Set(placed.map(p => p.r));
  const cols = new Set(placed.map(p => p.c));
  return rows.size === 1 || cols.size === 1;
}

export function hasGaps(state, placed) {
  if (placed.length <= 1) return false;
  const rows = new Set(placed.map(p => p.r));
  const cols = new Set(placed.map(p => p.c));
  const seenAt = (r, c) =>
    placed.some(p => p.r === r && p.c === c) || !!getCommittedTile(state, r, c);

  if (rows.size === 1) {
    const r = [...rows][0];
    const cs = placed.map(p => p.c).sort((a, b) => a - b);
    for (let c = cs[0]; c <= cs[cs.length - 1]; c++) {
      if (!seenAt(r, c)) return true;
    }
    return false;
  }
  // single column
  const c = [...cols][0];
  const rs = placed.map(p => p.r).sort((a, b) => a - b);
  for (let r = rs[0]; r <= rs[rs.length - 1]; r++) {
    if (!seenAt(r, c)) return true;
  }
  return false;
}

export function isConnected(state, placed) {
  if (state.firstMove) return true;
  // Each placed tile must have at least one orthogonal neighbour that is a
  // committed tile (not just another placed tile in the same move).
  return placed.some(p =>
    [
      [p.r - 1, p.c],
      [p.r + 1, p.c],
      [p.r, p.c - 1],
      [p.r, p.c + 1],
    ].some(([ar, ac]) => !!getCommittedTile(state, ar, ac))
  );
}

export function placedOnBonusSquare(placed) {
  return placed.find(p => isBonusPos(p.r, p.c)) ?? null;
}

// Top-level. Returns { ok, reason? }.
// Reasons match the legacy in spirit so the UI layer can map them to
// existing Hebrew error strings.
export function validateMove(state, placed) {
  if (!Array.isArray(placed) || placed.length === 0) {
    return { ok: false, reason: 'empty-move' };
  }
  if (!isCollinear(placed)) {
    return { ok: false, reason: 'not-collinear' };
  }
  if (hasGaps(state, placed)) {
    return { ok: false, reason: 'has-gaps' };
  }
  if (state.firstMove) {
    const onBonus = placedOnBonusSquare(placed);
    if (onBonus) return { ok: false, reason: 'first-move-on-bonus' };
  }
  if (!isConnected(state, placed)) {
    return { ok: false, reason: 'not-connected' };
  }
  return { ok: true };
}
