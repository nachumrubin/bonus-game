// Pure bot-move search.
//
// Given:
//   - the engine state (board + rack + firstMove flag),
//   - a slot (which player the bot is — 0 or 1),
//   - a list of candidate Hebrew words (already validated against the dictionary),
//   - difficulty level (0=easy, 1=medium, 2=hard),
//
// Returns either { placed, word, score, rankScore? } or null if no move can
// be found. `rankScore` is present on medium/hard non-opening moves — it's
// the value pickMove() actually ranks by (real score + expected bonus-square
// value); callers should still use `score` for the real, awarded points.
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
import { isCellLocked } from '../core/turnManager.js';
import { HV } from '../core/letterDistribution.js';
import { getAllWords, scoreMove } from '../core/scoringEngine.js';
import { BDEFS } from '../boosts/data.js';
import { BONUS_ESTIMATED_VALUE } from '../boosts/bonusTileDefs.js';

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
    weighBonusSquares: true,
  }),
  [DIFFICULTY.HARD]: Object.freeze({
    maxWordLen: 6, tries: 120, anchLimit: 20,
    includeBonusSquares: true, avoidBonusTiles: false,
    select: 'best', scoreCeiling: Infinity,
    weakenFirstMove: false, blunderChance: 0,
    weighBonusSquares: true,
  }),
});

export function resolveProfile(difficulty) {
  return DIFFICULTY_PROFILES[difficulty] ?? DIFFICULTY_PROFILES[DIFFICULTY.MEDIUM];
}

// The key pickMove ranks by. `rankScore` (when present) is the bot's internal
// search-time ranking value — real `score` plus an expected-bonus-square
// weight (see `remainingBonusEstimate`) — never the actual awarded score.
// Falls back to `score` for callers/tests that don't set rankScore.
function rankKey(m) {
  return m.rankScore ?? m.score;
}

// Choose one move from the candidates found, per the profile's strategy.
// Never returns null when `found` is non-empty.
//   - 'best'        → highest score (hard)
//   - 'topN'        → random among the topN highest (medium)
//   - 'percentile'  → random among the lowest `percentile` slice (easy);
//                     with `blunderChance`, sometimes the single worst move.
// A finite `scoreCeiling` first restricts to moves at/below it (falling back
// to the single lowest move if every option exceeds the ceiling), so the easy
// bot can't accidentally drop a monster word. The ceiling is checked against
// the real `score`, not `rankScore` — it's a cap on actual points awarded.
export function pickMove(found, profile, rng = Math.random) {
  if (!found || found.length === 0) return null;

  let pool = found;
  if (Number.isFinite(profile.scoreCeiling)) {
    const under = found.filter(m => m.score <= profile.scoreCeiling);
    pool = under.length > 0 ? under : [found.reduce((a, b) => b.score < a.score ? b : a)];
  }

  if (profile.select === 'best') {
    return pool.reduce((a, b) => rankKey(b) > rankKey(a) ? b : a);
  }
  if (profile.select === 'topN') {
    const sorted = [...pool].sort((a, b) => rankKey(b) - rankKey(a));
    return sorted[Math.floor(rng() * Math.min(profile.topN ?? 3, sorted.length))];
  }
  // 'percentile' — lowest slice, with an occasional all-out blunder.
  const sorted = [...pool].sort((a, b) => rankKey(a) - rankKey(b));
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

// Longest word length the play-through fallback will consider. Play-through
// moves on a crowded board are almost always short (they hang 1–2 rack tiles
// off committed letters), and keeping this small bounds the fallback's cost.
export const PLAYTHROUGH_MAX_LEN = 4;

// Looser variant of canMakeWord for the play-through fallback: a word is
// viable if the rack can supply the letters that aren't already sitting on the
// board — letters present in `boardLetters` are assumed reusable and the exact
// placement is still validated by tryPlaceWord. Requires at least one rack
// tile to be spent (a move must place something new).
//
// This is what lets the bot keep finding moves once the board fills up:
// canMakeWord requires the WHOLE word to come from the rack, so it blinds the
// bot to every "play through an existing letter" move — the bread-and-butter
// of a late-game board.
export function canFormWithBoard(word, rack, boardLetters) {
  const a = [...rack];
  let usedRack = 0;
  for (const ch of word) {
    const i = a.indexOf(ch);
    if (i >= 0) { a.splice(i, 1); usedRack++; continue; }
    const j = a.indexOf('?');
    if (j >= 0) { a.splice(j, 1); usedRack++; continue; }
    if (boardLetters && boardLetters.has(ch)) continue; // may come from a committed tile
    return false;
  }
  return usedRack >= 1;
}

// Every distinct letter currently committed to the board (main grid + off-grid
// bonus squares). Used to gate the play-through candidate set.
export function collectBoardLetters(state) {
  const set = new Set();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const t = getCommittedTile(state, r, c);
      if (t) set.add(t.letter);
    }
  }
  for (const b of BDEFS) {
    const t = getCommittedTile(state, b.br, b.bc);
    if (t) set.add(t.letter);
  }
  return set;
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
      // A locked cell is empty but off-limits: the engine rejects any move
      // that drops a tile on it (INVALID_MOVE_REJECTED / 'cell-locked'). The
      // bot must treat it as blocked here, otherwise it keeps proposing a
      // word that lands on the lock, gets refused, and wastes the turn.
      if (isCellLocked(state, r, c)) return null;
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
      if (isCellLocked(state, r, c)) continue; // can't build off a locked cell
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

// Expected point value of landing on a not-yet-played bonus square, given
// what has already been revealed. Bonus types are assigned to the 12 board
// slots once at game start (state.bonusAssignment) and never repeat within
// a game, but which type sits on any UNPLAYED square is hidden from human
// players until a tile actually lands there (see docs-md/docs/ui-rules.md —
// every unplayed bonus square renders the same generic icon). The bot must
// not read `state.bonusAssignment` for an unplayed slot — that would be
// information no human opponent has. Instead it tracks the same thing an
// attentive human could: the set of already-revealed types (via
// `state.bonusSqUsed`), and estimates an unplayed square as the average
// value over whichever types haven't shown up yet. This average tightens
// over the course of the game as more squares get revealed and can be
// crossed off the list.
export function remainingBonusEstimate(state) {
  const revealed = new Set();
  const used = state.bonusSqUsed ?? {};
  const assignment = state.bonusAssignment ?? [];
  for (const idx of Object.keys(used)) {
    if (!used[idx]) continue;
    const type = assignment[idx]?.type;
    if (type) revealed.add(type);
  }
  const remaining = Object.keys(BONUS_ESTIMATED_VALUE).filter(t => !revealed.has(t));
  if (remaining.length === 0) return 0;
  const sum = remaining.reduce((s, t) => s + BONUS_ESTIMATED_VALUE[t], 0);
  return sum / remaining.length;
}

// Adds the bonus-square ranking weight to a candidate's real score, if the
// profile opts in (medium/hard only — easy already avoids bonus tiles via
// `avoidBonusTiles`). `placed` entries on a bonus square are always
// not-yet-played ones: `tryPlaceWord` only adds a cell to `placed` when it's
// currently empty, so an already-used bonus square would instead show up as
// a committed-tile walk-through and never reach this count.
export function rankScoreFor(profile, state, score, placed) {
  if (!profile.weighBonusSquares) return score;
  const touched = placed.filter(p => isBonusPos(p.r, p.c)).length;
  if (touched === 0) return score;
  return score + touched * remainingBonusEstimate(state);
}

// True when an on-grid cell sits orthogonally next to a bonus square. Used to
// keep the opener from parking its last tile immediately beside a bonus square,
// which boxes the square in and reads as the bot "hugging" the perimeter.
export function adjacentToBonusSquare(r, c) {
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .some(([ar, ac]) => isBonusPos(ar, ac));
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
    // `clean` openers keep clear of the bonus squares; `nearBonus` openers are
    // otherwise legal but drop a tile right beside one — only used as a
    // fallback when nothing cleaner fits.
    const clean = [];
    const nearBonus = [];
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
        const crowdsBonus = placed.some(p => adjacentToBonusSquare(p.r, p.c));
        // Medium/hard keep the legacy "first valid wins" opener; only easy
        // collects all openers so it can deliberately pick a weak one. Either
        // way, prefer an opener that doesn't box in a bonus square.
        if (!profile.weakenFirstMove) {
          if (!crowdsBonus) return move;
          nearBonus.push(move);
          continue;
        }
        (crowdsBonus ? nearBonus : clean).push(move);
      }
    }
    const pool = clean.length > 0 ? clean : nearBonus;
    if (pool.length === 0) return null;
    return pickMove(pool, profile, rng);
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
          const rankScore = rankScoreFor(profile, state, score, placed);
          found.push({ placed, word: w, score, rankScore });
        }
      }
    }
  }

  if (found.length > 0) return pickMove(found, profile, rng);

  // Play-through fallback. The strict candidates (words the rack can spell in
  // full) produced no legal placement — the usual late-game situation, where
  // every open cell is boxed in and the only moves reuse committed letters.
  // Widen the candidate set to short play-through words and try them across
  // ALL anchors (bonus squares included, and bonus-tile placements allowed):
  // any legal move beats passing with a stuck rack. Difficulty still shapes
  // the final pick via pickMove.
  return searchPlayThrough(state, slot, wordList, isWordValid, profile, rng);
}

// Fallback search used when the primary (rack-spellable) search finds nothing.
// Considers words the rack can COMPLETE using letters already on the board.
function searchPlayThrough(state, slot, wordList, isWordValid, profile, rng) {
  const rack = state.racks[slot];
  const boardLetters = collectBoardLetters(state);
  const maxLen = Math.min(profile.maxWordLen, PLAYTHROUGH_MAX_LEN);
  // Short words first — likelier to fit a tight board and cheaper to try.
  const candidates = wordList
    .filter(w => w.length >= 2 && w.length <= maxLen && canFormWithBoard(w, rack, boardLetters))
    .sort((a, b) => a.length - b.length);
  if (candidates.length === 0) return null;

  // Recompute anchors with bonus squares included regardless of difficulty:
  // on a locked board the perimeter bonus squares are often the only openings.
  const anchors = findAnchors(state, { includeBonusSquares: true });
  const found = [];
  for (const w of candidates) {
    for (const { r, c } of anchors) {
      const isBonus = isBonusPos(r, c);
      const dirs = isBonus ? (r === -1 || r === BOARD_SIZE ? ['V'] : ['H']) : ['H', 'V'];
      for (const dir of dirs) {
        const offsets = isBonus ? [0] : Array.from({ length: w.length }, (_, k) => k);
        for (const offset of offsets) {
          const sr = dir === 'H' ? r : r - offset;
          const sc = dir === 'H' ? c - offset : c;
          const placed = tryPlaceWord(state, w, sr, sc, dir, slot);
          if (!placed) continue;
          const words = getAllWords(state, placed);
          if (words.some(ww => !isWordValid(ww.map(t => t.letter).join('')))) continue;
          const score = scoreMove(words, placed.length);
          const rankScore = rankScoreFor(profile, state, score, placed);
          found.push({ placed, word: w, score, rankScore });
        }
      }
    }
  }
  return pickMove(found, profile, rng);
}
