// Hebrew dictionary + morphological validation.
//
// The dictionary is a plain sorted text file (data/dictionary.txt).
// loadDict() fetches it and populates the DICT Set.
// isValid() does a direct DICT lookup with terminal-final-form folding.
//
// Firebase overlays:
//   /dictionaryRejected → BLOCKED_OVERLAY (always rejects, checked first)
//   /dictionaryApproved → merged into DICT at boot (accepts; run
//     absorb-firebase-dict.mjs periodically to move them into dictionary.txt)

export const DICT = new Set();
export let dictReady = false;
let validationLogger = null;

// Runtime block-overlay: words admins have explicitly excluded from gameplay.
// Populated at boot by syncBlockedDictionaryWordsOnce from /dictionaryRejected.
export const BLOCKED_OVERLAY = new Set();

export const DICT_URL = './data/dictionary.txt';

export function addWordsFromText(txt) {
  txt.split(/\r?\n/).forEach((raw) => {
    const w = raw.trim();
    if (w) DICT.add(w);
  });
  dictReady = true;
}

export async function loadDict(url = DICT_URL) {
  const resp = await fetch(url, { cache: 'no-cache' });
  if (!resp.ok) {
    throw new Error(`dictionary fetch failed: ${resp.status}`);
  }
  addWordsFromText(await resp.text());
  return DICT.size;
}

// NOTE (June 2026): the curated reject/accept word lists — EXACT_REJECTS,
// CLASSIC_ALLOW, DEFECTIVE_ACCEPT — were removed from the code. Reject/accept
// curation now lives ONLY in Firebase, synced at boot.
// COMMON_FALSE_POSSESSIVE stays — it's morphology logic, not a curated list.
export const COMMON_FALSE_POSSESSIVE = new Set(["מים","חיים","פנים","פני","שני","אחי","אחותי","אדוני","גוי","תוי"]);
export const PREFIXES = new Set(["ו","ה","ב","כ","ל","ש","מ"]);
export const POSSESSIVE_SUFFIXES = ["יהם","יהן","יכם","יכן","ינו","ייך","יך","יה","יו","כם","כן","נו","יי"];
export const VERB_SUFFIXES = ["תנה","תם","תן","תי","נו","נה","ים","ות","ת","ה"];

export function setValidationLogger(logger) {
  validationLogger = typeof logger === 'function' ? logger : null;
}

// final-form normalization (ך→כ etc.) for board-safe comparison
export function norm(w) {
  return w.replace(/ך/g, "כ").replace(/ם/g, "מ").replace(/ן/g, "נ").replace(/ף/g, "פ").replace(/ץ/g, "צ");
}

// because the board does not contain final letters, try legal end-of-word final-form variants too
export function* terminalFinalVariants(word) {
  const seen = new Set();
  function* em(v) { if (v && !seen.has(v)) { seen.add(v); yield v; } }
  yield* em(word);
  if (!word) return;
  const last = word[word.length - 1];
  const toFinal = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };
  if (toFinal[last]) yield* em(word.slice(0, -1) + toFinal[last]);
}

export function dictHas(word) {
  for (const variant of terminalFinalVariants(word)) {
    if (DICT.has(variant)) return true;
  }
  return false;
}

// candidate lemmas
export function* candidateLemmas(word) {
  const seen = new Set();
  function* em(v) {
    if (!v) return;
    for (const variant of terminalFinalVariants(v)) {
      const n = norm(variant);
      if (!seen.has(variant)) { seen.add(variant); yield variant; }
      if (n !== variant && !seen.has(n)) { seen.add(n); yield n; }
    }
  }
  yield* em(word);
  const wordN = norm(word);
  if (wordN.endsWith("ים") && wordN.length > 4) {
    const s = wordN.slice(0, -2);
    if (s.length >= 3) { yield* em(s); yield* em(s + "ה"); }
  }
  if (wordN.endsWith("ות") && wordN.length > 4) {
    const s = wordN.slice(0, -2);
    if (s.length >= 3) { yield* em(s); yield* em(s + "ה"); }
  }
  for (const suf of VERB_SUFFIXES) {
    const sufN = norm(suf);
    if (wordN.endsWith(sufN) && wordN.length > sufN.length + 2) {
      const s = wordN.slice(0, -sufN.length);
      if (s.length >= 3) { yield* em(s); if (!s.endsWith("ה")) yield* em(s + "ה"); }
    }
  }
  if (wordN.endsWith("ה") && wordN.length > 3) {
    const s = wordN.slice(0, -1);
    const futurePrefix = s.length >= 3 && "יתנא".includes(s[0]) && !"אהוי".includes(s[1]);
    if (s.length >= 3 && !futurePrefix) { yield* em(s); if (!s.endsWith("ו")) yield* em(s + "ו"); }
  }
}

export function guessLemmaFromMissing(word) {
  for (const cand of candidateLemmas(word)) {
    if (dictHas(cand) && !looksLikePossessive(cand)) return cand;
  }
  return null;
}

export function looksLikePrefixedParticle(word) {
  if (word.length < 3) return false;
  if (!PREFIXES.has(word[0])) return false;
  const stripped = word.slice(1);
  return dictHas(stripped) || guessLemmaFromMissing(stripped) !== null;
}

export function looksLikePossessive(word) {
  if (COMMON_FALSE_POSSESSIVE.has(word)) return false;
  for (const suf of POSSESSIVE_SUFFIXES) {
    if (word.length <= suf.length + 1 || !word.endsWith(suf)) continue;
    const stem = word.slice(0, -suf.length);
    if (dictHas(stem)) return true;
    if (dictHas(stem + "ה") || dictHas(stem + "ים") || dictHas(stem + "ות")) return true;
  }
  return false;
}

// Generate כתיב-חסר variants — strip ו/י that act as vowel letters (one at a time, interior).
// Also try plene insertion at interior positions.
export function* spellingVariants(word) {
  const seen = new Set();
  function emit(v) { if (v && v.length >= 2 && !seen.has(v)) { seen.add(v); return v; } return null; }
  const v = emit(word); if (v) yield v;
  for (let i = 1; i < word.length - 1; i++) {
    if (word[i] === 'ו' || word[i] === 'י') {
      const s = word.slice(0, i) + word.slice(i + 1);
      const r = emit(s); if (r) yield r;
    }
  }
  if (word.length > 3 && word[word.length - 1] === 'ו') {
    const r = emit(word.slice(0, -1)); if (r) yield r;
  }
  for (let i = 1; i < word.length; i++) {
    for (const ins of ['י', 'ו']) {
      const s = word.slice(0, i) + ins + word.slice(i);
      const r = emit(s); if (r) yield r;
    }
  }
}

export function dictHasPlene(word) {
  for (const variant of spellingVariants(word)) {
    if (dictHas(variant)) return variant;
  }
  return null;
}

// Mini-game word quality filter — rejects words with suspicious letter repetition:
//   • starts with two identical letters
//   • ends with two identical letters
//   • has three or more identical letters in a row anywhere
// Final-form variants (ך/כ etc.) are normalised to base before checking.
export function isMiniGameWord(word) {
  if (!word || word.length < 2) return true;
  const w = norm(word);
  if (w[0] === w[1]) return false;
  if (w[w.length - 1] === w[w.length - 2]) return false;
  for (let i = 2; i < w.length; i++) {
    if (w[i] === w[i - 1] && w[i] === w[i - 2]) return false;
  }
  return true;
}

// isValid: DICT lookup + BLOCKED_OVERLAY policy.
//
// Policy order (first match wins):
//   1. Clean input to Hebrew letters only; empty → invalid.
//   2. BLOCKED_OVERLAY hit → invalid (Firebase /dictionaryRejected, synced at boot).
//   3. DICT.has(word or terminal-final variant) → valid.
//      DICT contains both dictionary.txt words and Firebase-approved overlay words.
//   4. Otherwise invalid.
export function isValid(rawWord) {
  const word = (rawWord || '').trim().split('').filter((ch) => ch >= 'א' && ch <= 'ת').join('');
  if (!word) {
    validationLogger?.('[isValid]', JSON.stringify(rawWord), '->', '✗ INVALID', '| empty');
    return false;
  }
  if (BLOCKED_OVERLAY.has(word)) {
    validationLogger?.('[isValid]', JSON.stringify(word), '->', '✗ INVALID', '| blocked-overlay');
    return false;
  }
  for (const variant of terminalFinalVariants(word)) {
    if (DICT.has(variant)) {
      validationLogger?.('[isValid]', JSON.stringify(word), '->', '✓ VALID', '| dict-hit');
      return true;
    }
  }
  validationLogger?.('[isValid]', JSON.stringify(word), '->', '✗ INVALID', '| not-in-dict');
  return false;
}
