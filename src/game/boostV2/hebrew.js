// Boost 2.0 — Hebrew letter normalisation for challenge evaluation (spec §5.3).
//
// Reuses the dictionary's canonical final-form fold (hebrewDictionary.norm):
// ך→כ ם→מ ן→נ ף→פ ץ→צ. Tiles in the bag are always medial forms, but final
// forms can arrive from external input (dictionary text, tests, a joker
// assigned a final glyph), so every logical comparison goes through here.
// Pure — no DOM, no state.

import { norm } from '../core/hebrewDictionary.js';

export function normalizeLetter(ch) {
  return typeof ch === 'string' ? norm(ch) : ch;
}

export function normalizeWord(w) {
  return typeof w === 'string' ? norm(w) : '';
}

// Logical letter sequence of a word given as board tiles. Board words are
// already in logical reading order: horizontal words in increasing column
// (column 0 is the rightmost cell — #game-grid inherits RTL), vertical words
// top-to-bottom. A joker contributes the letter it represents.
export function wordLetters(tiles) {
  return tiles.map(t => normalizeLetter(t.letter));
}

export function letterCounts(letters) {
  const m = new Map();
  for (const l of letters) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
}
