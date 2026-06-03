// randomBot.mjs
//
// Picks a command from the current engine state. Pure function: same state +
// same rng = same command. Uses only the canonical engine utilities for
// validation (validateMove + isValid) so we never re-implement gameplay rules
// and can't accidentally drift from them.
//
// Tries up to MAX_PLACEMENT_ATTEMPTS to find a legal move. If none, exchanges
// 1–2 tiles. If the bag is too small, passes. Occasionally claims stall-end
// when ahead and the scoreless counter permits, to exercise that path.

import { validateMove } from '../../../src/game/core/moveValidator.js';
import { getAllWords } from '../../../src/game/core/scoringEngine.js';
import { isValid as isWordValid } from '../../../src/game/core/hebrewDictionary.js';
import { canClaimStallEnd, STALL_CLAIM_THRESHOLD } from '../../../src/game/core/turnManager.js';
import { HV, ALL_LETTERS } from '../../../src/game/core/letterDistribution.js';
import { CMD } from '../../../src/events/commands.js';
import { BOARD_SIZE, getCommittedTile, isBonusPos } from '../../../src/game/core/board.js';

const MAX_PLACEMENT_ATTEMPTS = 50;
const STALL_CLAIM_CHANCE = 0.25; // when eligible

/**
 * Pick a command for the given engine state. Returns { type, payload } shaped
 * like the engine expects, or null if even passing isn't possible (game over).
 */
export function pickCommand(state, mySlot, rng) {
  if (state.status !== 'playing') return null;
  if (state.currentTurnSlot !== mySlot) return null;

  // Occasionally try the stall-claim path when allowed.
  if ((state.passCount ?? 0) >= STALL_CLAIM_THRESHOLD && rng() < STALL_CLAIM_CHANCE) {
    if (canClaimStallEnd(state, mySlot)) {
      return { type: CMD.CLAIM_STALL_END, payload: { slot: mySlot } };
    }
  }

  const placement = findLegalPlacement(state, mySlot, rng);
  if (placement) {
    return { type: CMD.CONFIRM_MOVE, payload: { placed: placement, swappedTiles: [] } };
  }

  // Fall back to an exchange if the bag has enough tiles. Engine requires
  // bag.length >= letters.length.
  const rack = state.racks?.[mySlot] ?? [];
  if (rack.length > 0 && (state.bag?.length ?? 0) >= 1) {
    const count = Math.min(rack.length, (state.bag?.length ?? 0), pickInt(rng, 1, 2));
    const letters = pickRackLetters(rack, count, rng);
    if (letters.length > 0) {
      return { type: CMD.EXCHANGE_TILE, payload: { letters, freeSwap: false } };
    }
  }

  return { type: CMD.PASS_TURN, payload: { reason: 'pass' } };
}

function findLegalPlacement(state, mySlot, rng) {
  const rack = [...(state.racks?.[mySlot] ?? [])];
  if (rack.length === 0) return null;

  const anchors = collectAnchors(state);
  const isFirstMove = !!state.firstMove;

  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
    const tileCount = pickInt(rng, 1, Math.min(3, rack.length));
    const orientation = rng() < 0.5 ? 'h' : 'v';
    const startCell = isFirstMove
      ? pickFirstMoveStart(rng, tileCount, orientation)
      : pickAnchorStart(anchors, rng, tileCount, orientation, state);
    if (!startCell) continue;

    const chosenRackIdx = sampleIndices(rack.length, tileCount, rng);
    if (chosenRackIdx.length < tileCount) continue;
    const placed = buildPlacement(state, startCell, orientation, chosenRackIdx.map(i => rack[i]), rng);
    if (!placed) continue;

    // Engine refuses first-move-on-bonus, so filter early.
    if (isFirstMove && placed.some(p => isBonusPos(p.r, p.c))) continue;

    const validation = validateMove(state, placed);
    if (!validation.ok) continue;

    const words = getAllWords(state, placed);
    if (!words.length || words[0].length < 2) continue;
    const allWordsValid = words.every(w => isWordValid(w.map(t => t.letter).join('')));
    if (!allWordsValid) continue;

    return placed;
  }
  return null;
}

function collectAnchors(state) {
  const out = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (getCommittedTile(state, r, c)) out.push({ r, c });
    }
  }
  return out;
}

function pickFirstMoveStart(rng, tileCount, orientation) {
  // Anywhere on-grid, leaving room for tileCount tiles in the chosen direction.
  // Cap to a centerish region to bias toward the middle of the board.
  const minStart = 2;
  const maxR = orientation === 'v' ? BOARD_SIZE - tileCount - 2 : BOARD_SIZE - 3;
  const maxC = orientation === 'h' ? BOARD_SIZE - tileCount - 2 : BOARD_SIZE - 3;
  if (maxR < minStart || maxC < minStart) return null;
  return { r: pickInt(rng, minStart, maxR), c: pickInt(rng, minStart, maxC) };
}

function pickAnchorStart(anchors, rng, tileCount, orientation, state) {
  if (anchors.length === 0) return null;
  // Pick an anchor; offset by a random adjacent empty cell to start placing.
  const anchor = anchors[pickInt(rng, 0, anchors.length - 1)];
  const dr = orientation === 'v' ? 1 : 0;
  const dc = orientation === 'h' ? 1 : 0;
  // Try a small set of offsets around the anchor.
  const offsets = [-2, -1, 1, 2];
  shuffleInPlace(offsets, rng);
  for (const off of offsets) {
    const startR = anchor.r + (orientation === 'v' ? off : 0);
    const startC = anchor.c + (orientation === 'h' ? off : 0);
    const endR = startR + dr * (tileCount - 1);
    const endC = startC + dc * (tileCount - 1);
    if (startR < 0 || startC < 0 || endR >= BOARD_SIZE || endC >= BOARD_SIZE) continue;
    // The starting cell itself must be empty (we're placing there).
    if (getCommittedTile(state, startR, startC)) continue;
    return { r: startR, c: startC };
  }
  return null;
}

function buildPlacement(state, start, orientation, tiles, rng) {
  const placed = [];
  const dr = orientation === 'v' ? 1 : 0;
  const dc = orientation === 'h' ? 1 : 0;
  let r = start.r;
  let c = start.c;
  let tileIdx = 0;
  // Walk along the line; skip over committed cells; place at empty ones.
  let safety = 0;
  while (tileIdx < tiles.length && safety++ < 12) {
    if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) return null;
    if (!getCommittedTile(state, r, c)) {
      const letter = tiles[tileIdx];
      const tile = makePlacedTile(r, c, letter, rng);
      placed.push(tile);
      tileIdx++;
    }
    r += dr;
    c += dc;
  }
  if (placed.length !== tiles.length) return null;
  return placed;
}

function makePlacedTile(r, c, letter, rng) {
  if (letter === '?') {
    const assigned = ALL_LETTERS[pickInt(rng, 0, ALL_LETTERS.length - 1)];
    return { r, c, letter: assigned, val: 0, isJoker: true };
  }
  return { r, c, letter, val: HV[letter] ?? 0, isJoker: false };
}

function pickRackLetters(rack, count, rng) {
  const idxs = sampleIndices(rack.length, count, rng);
  return idxs.map(i => rack[i]);
}

function sampleIndices(n, k, rng) {
  const pool = Array.from({ length: n }, (_, i) => i);
  shuffleInPlace(pool, rng);
  return pool.slice(0, k);
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function pickInt(rng, lo, hi) {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}
