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

// Per-difficulty behaviour, data-driven so levels stay tunable + testable.
// Levers:
//   maxWordLen          – longest word the bot will even consider (easy = short)
//   tries / anchLimit   – search breadth (candidates tried, anchors per word)
//   includeBonusSquares – whether off-grid bonus squares are valid anchors
//   avoidBonusTiles     – reject any placement that lands on a bonus square
//   select              – 'best' | 'topN' | 'percentile' (see pickMove)
//   topN / percentile   – parameters for the selection strategy
//   scoreCeiling        – soft cap: prefer moves at/below this score (easy)
//   weakenFirstMove     – run the opener through pickMove instead of "first valid"
//   blunderChance       – probability the easy bot takes its single worst move
export const DIFFICULTY_PROFILES = Object.freeze({
  [DIFFICULTY.EASY]: Object.freeze({
    maxWordLen: 3, tries: 14, anchLimit: 6,
    includeBonusSquares: false, avoidBonusTiles: true,
    select: 'percentile', percentile: 0.25, scoreCeiling: 12,
    weakenFirstMove: true, blunderChance: 0.20,
  }),
  [DIFFICULTY.MEDIUM]: Object.freeze({
    maxWordLen: 5, tries: 60, anchLimit: 14,
    includeBonusSquares: true, avoidBonusTiles: false,
    select: 'topN', topN: 3, scoreCeiling: 25,
    weakenFirstMove: false, blunderChance: 0.05,
  }),
  [DIFFICULTY.HARD]: Object.freeze({
    maxWordLen: 6, tries: 120, anchLimit: 20,
    includeBonusSquares: true, avoidBonusTiles: false,
    select: 'best', scoreCeiling: Infinity,
    weakenFirstMove: false, blunderChance: 0,
  }),
});

export function resolveProfile(difficulty) {
  return DIFFICULTY_PROFILES[difficulty] ?? DIFFICULTY_PROFILES[DIFFICULTY.MEDIUM];
}

// Choose one move from the candidates found, per the profile's strategy.
// Never returns null when `found` is non-empty.
//   - 'best'        → highest score (hard)
//   - 'topN'        → random among the topN highest (medium)
//   - 'percentile'  → random among the lowest `percentile` slice (easy);
//                     with `blunderChance`, sometimes the single worst move.
// A finite `scoreCeiling` first restricts to moves at/below it (falling back
// to the single lowest move if every option exceeds the ceiling), so the easy
// bot can't accidentally drop a monster word.
export function pickMove(found, profile, rng = Math.random) {
  if (!found || found.length === 0) return null;

  let pool = found;
  if (Number.isFinite(profile.scoreCeiling)) {
    const under = found.filter(m => m.score <= profile.scoreCeiling);
    pool = under.length > 0 ? under : [found.reduce((a, b) => b.score < a.score ? b : a)];
  }

  if (profile.select === 'best') {
    return pool.reduce((a, b) => b.score > a.score ? b : a);
  }
  if (profile.select === 'topN') {
    const sorted = [...pool].sort((a, b) => b.score - a.score);
    return sorted[Math.floor(rng() * Math.min(profile.topN ?? 3, sorted.length))];
  }
  // 'percentile' — lowest slice, with an occasional all-out blunder.
  const sorted = [...pool].sort((a, b) => a.score - b.score);
  if (profile.blunderChance > 0 && rng() < profile.blunderChance) return sorted[0];
  const cut = Math.max(1, Math.ceil(sorted.length * (profile.percentile ?? 0.5)));
  const weak = sorted.slice(0, cut);
  return weak[Math.floor(rng() * weak.length)];
}

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
  // Production resolves the profile from `difficulty`; tests may inject one
  // directly via opts.profile to exercise a lever without a real level.
  const profile = opts.profile ?? resolveProfile(difficulty);
  const rack = state.racks[slot];

  const candidates = wordList
    .filter(w => w.length <= profile.maxWordLen)
    .filter(w => canMakeWord(w, rack))
    .sort((a, b) => b.length - a.length);

  if (state.firstMove) {
    const mid = Math.floor(BOARD_SIZE / 2);
    const firstMoves = [];
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
        const move = { placed, word: w, score };
        // Medium/hard keep the legacy "first valid wins" opener; only easy
        // collects all openers so it can deliberately pick a weak one.
        if (!profile.weakenFirstMove) return move;
        firstMoves.push(move);
      }
    }
    if (firstMoves.length === 0) return null;
    return pickMove(firstMoves, profile, rng);
  }

  const anchors = findAnchors(state, { includeBonusSquares: profile.includeBonusSquares });

  const found = [];
  const tries = Math.min(candidates.length, profile.tries);
  for (let i = 0; i < tries; i++) {
    const w = candidates[i];
    const anchorOrder = shuffleInPlace([...anchors], rng).slice(0, profile.anchLimit);
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
          if (profile.avoidBonusTiles && placed.some(p => isBonusPos(p.r, p.c))) continue;
          const words = getAllWords(state, placed);
          if (words.some(ww => !isWordValid(ww.map(t => t.letter).join('')))) continue;
          const score = scoreMove(words, placed.length);
          found.push({ placed, word: w, score });
        }
      }
    }
  }

  return pickMove(found, profile, rng);
}
