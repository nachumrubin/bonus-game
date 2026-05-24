// Pure bot-move search.
//
// Given:
//   - the engine state (board + rack + firstMove flag),
//   - a slot (which player the bot is — 0 or 1),
//   - a list of candidate Hebrew words (already validated against the dictionary),
//   - difficulty level (0=easy, 1=medium, 2=hard),
//
// Returns either { placed, word, score } or null if no move can be found.
//
// Algorithm (ported from index.html:3979 doBotSearch):
//   1. Filter words the rack can spell.
//   2. On first move, try short candidates around the centre.
//   3. Otherwise, find anchors (empty cells adjacent to existing tiles, plus
//      bonus squares for medium/hard).
//   4. For each candidate × anchor × direction × offset, attempt placement;
//      keep moves that produce only valid cross-words.
//   5. Pick best score (hard), top-3 random (medium), bottom-half random (easy).
//
// Cross-word validation is delegated to the caller via `isWordValid(text)`,
// which lets tests inject a tiny dictionary and lets production wire the
// real isValid from hebrewDictionary.js.

import { BOARD_SIZE, isOnGrid, isBonusPos, getCommittedTile } from '../core/board.js';
import { HV } from '../core/letterDistribution.js';
import { getAllWords, scoreMove } from '../core/scoringEngine.js';
import { BDEFS } from '../boosts/data.js';

export const DIFFICULTY = Object.freeze({ EASY: 0, MEDIUM: 1, HARD: 2 });

export function canMakeWord(word, rack) {
  const a = [...rack];
  for (const ch of word) {
    const i = a.indexOf(ch);
    if (i >= 0) { a.splice(i, 1); continue; }
    const j = a.indexOf('?');
    if (j >= 0) { a.splice(j, 1); continue; }
    return false;
  }
  return true;
}

// Try to lay `word` starting at (sr, sc) going in direction `dir` ('H' or 'V').
// Returns the array of placements [{r,c,letter,val,isJoker}] or null if it
// doesn't fit (off-board, conflicting committed tile, no rack tile available,
// fully spans nothing new, or breaks first-move/connectivity rules).
export function tryPlaceWord(state, word, sr, sc, dir, slot) {
  const rack = [...state.racks[slot]];
  const placed = [];
  let r = sr, c = sc;
  for (let i = 0; i < word.length; i++) {
    const onGrid = isOnGrid(r, c);
    const onBonus = isBonusPos(r, c);
    if (!onGrid && !onBonus) return null;

    const existing = getCommittedTile(state, r, c);
    if (existing) {
      if (existing.letter !== word[i]) return null;
    } else {
      const idx = rack.indexOf(word[i]);
      if (idx >= 0) {
        rack.splice(idx, 1);
        placed.push({ r, c, letter: word[i], val: HV[word[i]] ?? 0 });
      } else {
        const jokerIdx = rack.indexOf('?');
        if (jokerIdx < 0) return null;
        rack.splice(jokerIdx, 1);
        placed.push({ r, c, letter: word[i], val: 0, isJoker: true });
      }
    }
    if (dir === 'H') c++; else r++;
  }
  if (placed.length === 0) return null;
  // Connectivity: if not first move, at least one placed tile must touch a committed tile
  if (!state.firstMove) {
    const touches = placed.some(p =>
      [[p.r - 1, p.c], [p.r + 1, p.c], [p.r, p.c - 1], [p.r, p.c + 1]]
        .some(([ar, ac]) => !!getCommittedTile(state, ar, ac))
    );
    if (!touches) return null;
  }
  // Must be collinear (placed tiles must share a row or a column)
  const rows = new Set(placed.map(p => p.r));
  const cols = new Set(placed.map(p => p.c));
  if (rows.size > 1 && cols.size > 1) return null;
  return placed;
}

export function findAnchors(state, { includeBonusSquares = false } = {}) {
  const anchors = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (getCommittedTile(state, r, c)) continue;
      const adj = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
      if (adj.some(([ar, ac]) => !!getCommittedTile(state, ar, ac))) {
        anchors.push({ r, c });
      }
    }
  }
  if (includeBonusSquares) {
    for (const b of BDEFS) {
      if (getCommittedTile(state, b.br, b.bc)) continue;
      const adj = [[b.br - 1, b.bc], [b.br + 1, b.bc], [b.br, b.bc - 1], [b.br, b.bc + 1]];
      if (adj.some(([ar, ac]) => !!getCommittedTile(state, ar, ac))) {
        anchors.push({ r: b.br, c: b.bc });
      }
    }
  }
  return anchors;
}

function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Main entry. `wordList` is an array of valid Hebrew words sorted however
// the caller wants; this function will further filter and try them.
export function searchBotMove(state, slot, wordList, isWordValid, opts = {}) {
  const { difficulty = DIFFICULTY.MEDIUM, rng = Math.random } = opts;
  const rack = state.racks[slot];

  const candidates = wordList
    .filter(w => canMakeWord(w, rack))
    .sort((a, b) => b.length - a.length);

  if (state.firstMove) {
    const mid = Math.floor(BOARD_SIZE / 2);
    for (const w of candidates.slice(0, 30)) {
      const tries = [
        [mid, mid, 'H'],
        [mid, mid - 2, 'H'],
        [mid, mid, 'V'],
      ];
      for (const [sr, sc, dir] of tries) {
        const placed = tryPlaceWord(state, w, sr, sc, dir, slot);
        if (!placed) continue;
        if (placed.some(p => isBonusPos(p.r, p.c))) continue; // first move can't use bonus square
        const words = getAllWords(state, placed);
        if (words.some(ww => !isWordValid(ww.map(t => t.letter).join('')))) continue;
        const score = scoreMove(words, placed.length);
        return { placed, word: w, score };
      }
    }
    return null;
  }

  const anchors = findAnchors(state, { includeBonusSquares: difficulty >= DIFFICULTY.MEDIUM });

  const found = [];
  const tries = Math.min(candidates.length, difficulty === DIFFICULTY.HARD ? 120 : difficulty === DIFFICULTY.MEDIUM ? 60 : 20);
  for (let i = 0; i < tries; i++) {
    const w = candidates[i];
    const anchLimit = difficulty === DIFFICULTY.HARD ? 20 : difficulty === DIFFICULTY.MEDIUM ? 14 : 9;
    const anchorOrder = shuffleInPlace([...anchors], rng).slice(0, anchLimit);
    for (const { r, c } of anchorOrder) {
      const isBonus = isBonusPos(r, c);
      const dirs = isBonus ? (r === -1 || r === BOARD_SIZE ? ['V'] : ['H']) : ['H', 'V'];
      for (const dir of dirs) {
        const offsets = isBonus ? [0] : Array.from({ length: w.length }, (_, k) => k);
        for (const offset of offsets) {
          const sr = dir === 'H' ? r : r - offset;
          const sc = dir === 'H' ? c - offset : c;
          const placed = tryPlaceWord(state, w, sr, sc, dir, slot);
          if (!placed) continue;
          if (difficulty === DIFFICULTY.EASY && placed.some(p => isBonusPos(p.r, p.c))) continue;
          const words = getAllWords(state, placed);
          if (words.some(ww => !isWordValid(ww.map(t => t.letter).join('')))) continue;
          const score = scoreMove(words, placed.length);
          found.push({ placed, word: w, score });
        }
      }
    }
  }

  if (found.length === 0) return null;
  if (difficulty === DIFFICULTY.HARD) {
    return found.reduce((a, b) => b.score > a.score ? b : a);
  }
  if (difficulty === DIFFICULTY.MEDIUM) {
    found.sort((a, b) => b.score - a.score);
    return found[Math.floor(rng() * Math.min(3, found.length))];
  }
  // Easy: bottom half
  found.sort((a, b) => a.score - b.score);
  const pool = found.slice(0, Math.max(1, Math.ceil(found.length / 2)));
  return pool[Math.floor(rng() * pool.length)];
}
