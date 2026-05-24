// Board state helpers.
//
// The playing field has two regions:
//   - the main 10x10 grid (board[r][c] for 0 ≤ r,c < 10)
//   - 12 off-grid bonus square positions at r ∈ {-1, 10} or c ∈ {-1, 10},
//     defined by BDEFS in src/game/boosts/data.js, stored in bonusBoard
//     (a Map keyed "r,c").
//
// Tiles can be committed to either region. getCommittedTile() consults both
// transparently. Pure functions only — no game-state mutation.

import { BDEFS } from '../boosts/data.js';

export const BOARD_SIZE = 10;

export function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

export function isOnGrid(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

export function isBonusPos(r, c) {
  return BDEFS.some(b => b.br === r && b.bc === c);
}

export function getCommittedTile(state, r, c) {
  if (isOnGrid(r, c)) return state.board[r][c];
  const k = `${r},${c}`;
  return state.bonusBoard.get(k) ?? null;
}

// Look up a tile considering both committed tiles and the move's pending placements.
// Used during validation/word-scanning.
export function getTileAt(state, r, c, placed = []) {
  for (const p of placed) {
    if (p.r === r && p.c === c) return p;
  }
  return getCommittedTile(state, r, c);
}

export function setCommittedTile(state, r, c, tile) {
  if (isOnGrid(r, c)) {
    state.board[r][c] = tile;
  } else {
    state.bonusBoard.set(`${r},${c}`, tile);
  }
}
