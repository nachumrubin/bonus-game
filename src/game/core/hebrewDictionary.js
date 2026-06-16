// Hebrew dictionary + morphological validation.
//
// Validation uses the v2 path exclusively: loadDictV2() reads
// ./data/dictionary.v2.bin (a DAWG-encoded curated lexicon); isValid()
// consults the DAWG directly with the Firebase overlays (BLOCKED_OVERLAY
// reject / approved-overlay accept).

import { parseDawg, buildDawg, serializeDawg } from './dawg.js';

export const DICT = new Set();
export let dictReady = false;
let validationLogger = null;
let dawg = null;                  // parseDawg(...) result, populated by loadDictV2

// Runtime block-overlay: words admins have explicitly excluded from gameplay.
// Populated at boot by syncBlockedDictionaryWordsOnce from /dictionaryRejected
// in Firebase. Checked by isValid before any positive lookup so a blocked word
// always rejects, even if it's in the DAWG / DICT.
export const BLOCKED_OVERLAY = new Set();

export const DICT_V2_URL = './data/dictionary.v2.bin';

// addWordsFromText: builds a minimal in-memory DAWG from a newline-separated
// word list and activates it as the current dictionary. Used by test harnesses
// that need to seed a small word set without fetching the full binary.
export function addWordsFromText(txt) {
  const words = txt.split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
  if (words.length === 0) return;
  const sorted = [...new Set(words)].sort();
  dawg = parseDawg(serializeDawg(buildDawg(sorted)));
  for (const w of sorted) DICT.add(w);
  dictReady = true;
}

// NOTE (June 2026): the curated reject/accept word lists — EXACT_REJECTS,
// CLASSIC_ALLOW, DEFECTIVE_ACCEPT — were removed from the code. Reject/accept
// curation now lives ONLY in Firebase, synced at boot:
//   /dictionaryRejected -> BLOCKED_OVERLAY (reject; overrides any positive hit)
//   /dictionaryApproved -> DICT            (accept; overlay merged into DICT)
// The previous entries are preserved in docs-md/dictionary-firebase-seed.txt
// for one-time loading into those Firebase paths.
// COMMON_FALSE_POSSESSIVE stays — it's morphology logic (stops real words like
// מים/חיים/פנים from being mis-read as possessives), not a curated word list.
export const COMMON_FALSE_POSSESSIVE = new Set(["מים","חיים","פנים","פני","שני","אחי","אחותי","אדוני","גוי","תוי"]);
export const PREFIXES = new Set(["ו","ה","ב","כ","ל","ש","מ"]);
export const POSSESSIVE_SUFFIXES = ["יהם","יהן","יכם","יכן","ינו","ייך","יך","יה","יו","כם","כן","נו","יי"];
export const VERB_SUFFIXES = ["תנה","תם","תן","תי","נו","נה","ים","ות","ת","ה"];

// v2 loader: fetches the DAWG-encoded curated lexicon and populates both the
// DAWG (for isValid lookups) and the DICT Set (so iteration callers like the
// mini-game word search and bot word generator keep working).
export async function loadDictV2(url = DICT_V2_URL) {
  const resp = await fetch(url, { cache: 'no-cache' });
  if (!resp.ok) {
    throw new Error(`dictionary v2 fetch failed: ${resp.status}`);
  }
  const buf = await resp.arrayBuffer();
  dawg = parseDawg(buf);
  // Mirror words into DICT so existing iteration callers don't need to change.
  // ~25 MB heap at 500K Hebrew strings — the wire-size win is the main goal.
  for (const w of dawg.words()) DICT.add(w);
  dictReady = true;
  return DICT.size;
}

// Test-only injection point for the DAWG (lets unit tests bypass fetch).
export function setDawgForTests(parsed) {
  dawg = parsed;
  if (parsed) {
    for (const w of parsed.words()) DICT.add(w);
    dictReady = true;
  }
}

export function getDawgForTests() {
  return dawg;
}

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
  // Normalize the word for suffix matching (board tiles have no final forms)
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
    // Don't strip ה from future-tense verb forms (י/ת/נ/א prefix)
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

// isValid: DAWG lookup + policy overlays.
//
// Policy order (first match wins):
//   1. Clean input to Hebrew letters only; empty → invalid.
//   2. BLOCKED_OVERLAY hit → invalid (Firebase /dictionaryRejected, synced at boot).
//   3. DAWG.has(word) OR DAWG.has(terminal-final variant) → valid.
//   4. Approved-overlay hit (Firebase /dictionaryApproved merged into DICT
//      after loadDictV2) → valid. Allows admin-approved words that haven't
//      yet been absorbed into the binary via absorb-firebase-dict.mjs.
//   5. Otherwise invalid.
export function isValid(rawWord) {
  if (!dawg) {
    validationLogger?.('[isValid]', JSON.stringify(rawWord), '->', '✗ INVALID', '| dawg-not-loaded');
    return false;
  }
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
    if (dawg.has(variant)) {
      validationLogger?.('[isValid]', JSON.stringify(word), '->', '✓ VALID', '| dawg-hit');
      return true;
    }
  }
  for (const variant of terminalFinalVariants(word)) {
    if (DICT.has(variant)) {
      validationLogger?.('[isValid]', JSON.stringify(word), '->', '✓ VALID', '| approved-overlay');
      return true;
    }
  }
  validationLogger?.('[isValid]', JSON.stringify(word), '->', '✗ INVALID', '| not-in-dawg');
  return false;
}
