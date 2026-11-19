// Boost 2.0 — dictionary validator for the authoritative Worker.
//
// The Worker cannot afford to parse 255k words into a Set on every cold
// start (Workers have tight CPU budgets). data/dictionary.txt is sorted in
// code-unit order with one word per LF-terminated line, so a word can be
// found by binary search directly on the raw text: O(log n) per lookup and
// no index to build.
//
// createWordValidator() applies the SAME policy as hebrewDictionary.isValid:
//   1. keep Hebrew letters only; empty → invalid
//   2. blocked overlay (/dictionaryRejected), folded across final forms → invalid
//   3. word or its terminal-final variant in the text or the approved overlay
//      (/dictionaryApproved) → valid
//   4. otherwise invalid
// Parity with isValid is unit-tested. Pure — no I/O.

import { norm, terminalFinalVariants } from '../core/hebrewDictionary.js';

export function createSortedTextLookup(text) {
  const src = String(text ?? '');
  return {
    has(word) {
      if (!word) return false;
      let lo = 0, hi = src.length;   // lo is always a line start
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const start = src.lastIndexOf('\n', mid - 1) + 1;
        let end = src.indexOf('\n', start);
        if (end < 0) end = src.length;
        const line = src.slice(start, end);
        if (line === word) return true;
        if (line < word) lo = end + 1; else hi = start;
      }
      return false;
    },
  };
}

// /dictionaryApproved → Set of words (the keys).
export function approvedFromSnapshot(val) {
  return new Set(Object.keys(val ?? {}).filter(w => /^[א-ת]+$/.test(w)));
}

// /dictionaryRejected → Set of words (push ids → string or { word | normalizedWord }).
export function blockedFromSnapshot(val) {
  const out = new Set();
  for (const e of Object.values(val ?? {})) {
    const raw = typeof e === 'string' ? e : (e?.word ?? e?.normalizedWord ?? '');
    const w = String(raw ?? '').replace(/[^א-ת]/g, '').trim();
    if (w) out.add(w);
  }
  return out;
}

export function createWordValidator({ text, blocked = new Set(), approved = new Set() }) {
  const lookup = createSortedTextLookup(text);
  const isBlocked = (word) => {
    for (const v of terminalFinalVariants(word)) if (blocked.has(v)) return true;
    return blocked.has(norm(word));
  };
  return function isValid(rawWord) {
    const word = String(rawWord ?? '').trim().split('').filter(ch => ch >= 'א' && ch <= 'ת').join('');
    if (!word) return false;
    if (isBlocked(word)) return false;
    for (const v of terminalFinalVariants(word)) {
      if (approved.has(v) || lookup.has(v)) return true;
    }
    return false;
  };
}
