// Game Debug Timeline — pure state snapshot + hashing helpers.
//
// `compactSnapshot` reduces a game state (either the engine's in-memory state
// with a 2D board, OR a Firebase room doc with a flat board) to a small,
// renderable, comparable summary. `hashState` produces a stable signature over
// the substantive fields (board/scores/turn/tiles) so a client's local view can
// be compared against the server's stored state to detect divergence.
//
// Pure: no DOM, no Firebase, no clocks. Deterministic for identical input.

import { hashStringToU32 } from '../../util/rng.js';

// Read a slot value tolerant of numeric keys (engine) or string keys (Firebase).
function slotVal(obj, slot) {
  if (obj == null) return undefined;
  return obj[slot] ?? obj[String(slot)];
}

function countTiles(racks, slot) {
  const r = slotVal(racks, slot);
  return Array.isArray(r) ? r.length : 0;
}

// Canonical, representation-independent string of occupied board cells.
// Accepts a 2D array (board[r][c]) or a flat 100-cell array (index r*10+c).
export function boardCellsString(board) {
  if (!board) return '';
  const is2d = Array.isArray(board) && Array.isArray(board[0]);
  const cellAt = (i) => (is2d ? board[Math.floor(i / 10)]?.[i % 10] : board[i]);
  const out = [];
  for (let i = 0; i < 100; i++) {
    const t = cellAt(i);
    if (t && t.letter != null) out.push(`${i}:${t.letter}${t.isJoker ? '*' : ''}`);
  }
  return out.join('|');
}

// 32-bit board signature as a short hex string.
export function boardHash(board) {
  return hashStringToU32(boardCellsString(board)).toString(16);
}

// Number of occupied cells on the board (either representation).
export function boardTileCount(board) {
  const s = boardCellsString(board);
  return s === '' ? 0 : s.split('|').length;
}

// Reduce any game-state-like object to the compact, renderable summary.
export function compactSnapshot(state = {}) {
  const players = state.players ?? {};
  const scores = state.scores ?? {};
  const racks = state.racks ?? {};
  const currentTurnSlot = state.currentTurnSlot ?? null;
  const currentPlayer = currentTurnSlot != null ? slotVal(players, currentTurnSlot) : null;
  const bag = state.bag;
  return {
    status:           state.status ?? null,
    currentTurnSlot,
    currentTurnUserId: currentPlayer?.uid ?? null,
    turnNumber:       state.turnNumber ?? null,
    hostScore:        Number(slotVal(scores, 0) ?? 0),
    guestScore:       Number(slotVal(scores, 1) ?? 0),
    hostTilesCount:   countTiles(racks, 0),
    guestTilesCount:  countTiles(racks, 1),
    boardHash:        boardHash(state.board),
    boardTileCount:   boardTileCount(state.board),
    tileBagCount:     Array.isArray(bag) ? bag.length : (Number.isFinite(state.tileBagCount) ? state.tileBagCount : null),
    lastMove:         state.lastMove ?? null,
  };
}

// Stable signature over the SUBSTANTIVE fields only (excludes lastMove and any
// timestamps) so two views of "the same game position" hash equal even if their
// last-move metadata differs. Accepts a compact snapshot or a raw state.
export function hashState(snapshotOrState = {}) {
  const c = ('boardHash' in snapshotOrState && 'hostScore' in snapshotOrState)
    ? snapshotOrState
    : compactSnapshot(snapshotOrState);
  const canonical = [
    c.status,
    c.currentTurnSlot,
    c.turnNumber,
    c.hostScore,
    c.guestScore,
    c.hostTilesCount,
    c.guestTilesCount,
    c.boardHash,
    c.tileBagCount,
  ].join('~');
  return hashStringToU32(canonical).toString(16);
}
