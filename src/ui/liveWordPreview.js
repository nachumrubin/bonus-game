// liveWordPreview — the "האור +8" counter in the game-screen status pill.
//
// Pure view helper: given the committed board and the tiles the player has
// placed (plus pending board swaps), it answers "what would שבץ score right
// now?" using the ENGINE's own validateMove / getAllWords / scoreMove, so the
// number can't drift from the real commit. Nothing here touches state — the
// board is only read through a { board, bonusBoard, firstMove } shim.
//
// The figure is the base move score (letters of every formed word + bingo).
// Boost multipliers / extras are applied by the engine on commit and are
// already advertised by the multiplier banner, so they are not folded in.

import { validateMove } from '../game/core/moveValidator.js';
import { getAllWords, scoreMove } from '../game/core/scoringEngine.js';

/**
 * @returns {null | { word: string, words: string[], score: number, valid: boolean|null }}
 *   null  → nothing meaningful to show (no tiles, not in one line, gaps, not connected,
 *           or no word of 2+ letters yet).
 *   valid → true/false from `isWordValid` on every formed word; null when no checker
 *           was supplied (dictionary not loaded).
 */
export function computeLiveWordPreview({ board, bonusBoard = null, firstMove = false, placed = [], swappedTiles = [], isWordValid = null } = {}) {
  if (!Array.isArray(board)) return null;
  const tiles = [
    ...(placed ?? []),
    ...(swappedTiles ?? []).map(s => ({ r: s.r, c: s.c, letter: s.letter, val: s.val, isJoker: !!s.isJoker })),
  ].filter(t => t && t.letter);
  if (!tiles.length) return null;

  const state = { board, bonusBoard: bonusBoard ?? new Map(), firstMove: !!firstMove };
  if (!validateMove(state, tiles).ok) return null;

  const formed = getAllWords(state, tiles);
  if (!formed.length || formed[0].length < 2) return null;

  const words = formed.map(w => w.map(t => t.letter).join(''));
  const valid = typeof isWordValid === 'function' ? words.every(w => !!isWordValid(w)) : null;
  return { word: words[0], words, score: scoreMove(formed, tiles.length), valid };
}
