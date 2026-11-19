// Shared fixtures for Boost 2.0 unit tests (not a test file itself).
import { HV } from '../core/letterDistribution.js';
import { getRules } from './rulesConfig.js';
import { normalizeLetter } from './hebrew.js';

export const RULES = getRules();

// Word tiles in logical order. `newIdx` = indices of newly placed tiles
// (default: all new). A '*' prefix on a letter marks a joker (value 0).
function tiles(r0, c0, dr, dc, spec, newIdx) {
  const out = [];
  let i = 0;
  for (let k = 0; k < spec.length; k++) {
    let ch = spec[k];
    let joker = false;
    if (ch === '*') { joker = true; ch = spec[++k]; }
    const isNew = newIdx ? newIdx.includes(i) : true;
    out.push({ r: r0 + dr * i, c: c0 + dc * i, letter: ch, val: joker ? 0 : (HV[normalizeLetter(ch)] ?? 0), ex: !isNew, isJoker: joker });
    i++;
  }
  return out;
}
export const hw = (r, c, letters, newIdx) => tiles(r, c, 0, 1, letters, newIdx);
export const vw = (r, c, letters, newIdx) => tiles(r, c, 1, 0, letters, newIdx);

// Newly placed tiles of a set of words (deduplicated by coordinate).
export function placedOf(...words) {
  const m = new Map();
  for (const w of words) for (const t of w) if (!t.ex) m.set(`${t.r},${t.c}`, { r: t.r, c: t.c, letter: t.letter, val: t.val, isJoker: t.isJoker });
  return [...m.values()];
}
