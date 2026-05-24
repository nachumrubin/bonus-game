// Scoring.
//
// getAllWords(state, placed) returns every word formed by the move:
//   - the main word along the placement axis
//   - any cross-words created by individual placed tiles
// Each word is an array of tile objects in left-to-right or top-to-bottom
// order. Tiles include {r, c, letter, val, ex} where `ex` is true for
// existing (committed) tiles and false for tiles placed in this move.
//
// Words shorter than 2 letters are filtered out. Coordinate-based dedup
// prevents counting a word twice when a single placed tile is both the
// main word and a cross-word.
//
// scoreMove(words, placedCount) returns the integer score:
//   sum(tile.val) over all words + 50 if placedCount === 8 (bingo).

import { getTileAt } from './board.js';
import { RACK_SIZE } from './tileBag.js';

export const BINGO_BONUS = 50;

function wordKey(word) {
  return word.map(t => `${t.r},${t.c}`).join('|');
}

// Determine the axis of the move: 'H' if all in one row, 'V' if all in one
// column. For a single tile, prefer H unless only V neighbours exist
// (matches legacy getWT logic).
function moveAxis(state, placed) {
  if (placed.length > 1) {
    return new Set(placed.map(p => p.r)).size === 1 ? 'H' : 'V';
  }
  const { r, c } = placed[0];
  const hasH = !!(getTileAt(state, r, c - 1, placed) || getTileAt(state, r, c + 1, placed));
  const hasV = !!(getTileAt(state, r - 1, c, placed) || getTileAt(state, r + 1, c, placed));
  if (!hasH && hasV) return 'V';
  return 'H';
}

function buildWordAlong(state, placed, axis, fixed, varies) {
  // axis 'H' means rows are fixed; we vary cols. axis 'V' means cols are fixed; we vary rows.
  const tile = (a, b) => axis === 'H' ? getTileAt(state, a, b, placed) : getTileAt(state, b, a, placed);
  let mn = varies, mx = varies;
  while (tile(fixed, mn - 1)) mn--;
  while (tile(fixed, mx + 1)) mx++;
  const word = [];
  for (let i = mn; i <= mx; i++) {
    const t = tile(fixed, i);
    if (!t) continue;
    const r = axis === 'H' ? fixed : i;
    const c = axis === 'H' ? i : fixed;
    const isPlaced = placed.some(p => p.r === r && p.c === c);
    word.push({ r, c, val: t.val, letter: t.letter, ex: !isPlaced });
  }
  return word;
}

export function getMainWord(state, placed) {
  const axis = moveAxis(state, placed);
  if (axis === 'H') {
    const r = placed[0].r;
    const mins = Math.min(...placed.map(p => p.c));
    return buildWordAlong(state, placed, 'H', r, mins);
  } else {
    const c = placed[0].c;
    const mins = Math.min(...placed.map(p => p.r));
    return buildWordAlong(state, placed, 'V', c, mins);
  }
}

export function getAllWords(state, placed) {
  if (placed.length === 0) return [];
  const seen = new Set();
  const words = [];
  const add = (w) => {
    if (w.length < 2) return;
    const k = wordKey(w);
    if (seen.has(k)) return;
    seen.add(k);
    words.push(w);
  };

  add(getMainWord(state, placed));

  const axis = moveAxis(state, placed);
  for (const p of placed) {
    // Cross-word axis is the perpendicular of the main axis.
    if (axis === 'H') {
      // main is horizontal → cross is vertical
      add(buildWordAlong(state, placed, 'V', p.c, p.r));
    } else {
      add(buildWordAlong(state, placed, 'H', p.r, p.c));
    }
  }
  return words;
}

export function scoreWord(word) {
  let s = 0;
  for (const t of word) s += t.val || 0;
  return s;
}

export function scoreMove(words, placedCount) {
  let s = 0;
  for (const w of words) s += scoreWord(w);
  if (placedCount === RACK_SIZE) s += BINGO_BONUS;
  return s;
}
