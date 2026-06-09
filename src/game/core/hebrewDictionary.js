// Hebrew dictionary + morphological validation.
// Ported verbatim from index.html:2802-3145 (norm, candidateLemmas, analyze,
// isValid, plus their supporting tables and helpers).
//
// Two validation paths exist:
//   1. v1 (legacy): loadDict() reads ./data/dictionary.base.txt into DICT;
//      isValid() uses the morphological fallback chain
//      (candidateLemmas → suffix stripping → spelling variants).
//   2. v2: loadDictV2() reads ./data/dictionary.v2.bin (a DAWG-encoded
//      curated lexicon); isValid() consults the DAWG directly with policy
//      overlays (EXACT_REJECTS / CLASSIC_ALLOW / DEFECTIVE_ACCEPT) and
//      skips the morphology chain — the curated lexicon already contains
//      inflected forms.
//
// The active path is selected by setDictionaryMode('v1' | 'v2'), called from
// main.js based on the ?dict=v2 URL flag. The v1 path is the default to
// preserve existing behavior during the canary.

import { parseDawg } from './dawg.js';

export const DICT = new Set();
export let dictReady = false;
let validationLogger = null;
let dawg = null;                  // parseDawg(...) result, populated by loadDictV2
let dictionaryMode = 'v1';        // 'v1' | 'v2'

// Runtime block-overlay: words admins have explicitly excluded from gameplay.
// Populated at boot by syncBlockedDictionaryWordsOnce from /dictionaryRejected
// in Firebase. Checked by isValid (both v1 and v2) before any positive lookup
// so a blocked word always rejects, even if it's in the DAWG / DICT / lemma
// chain.
export const BLOCKED_OVERLAY = new Set();

export const DICT_BASE_URL = './data/dictionary.base.txt';
export const DICT_V2_URL = './data/dictionary.v2.bin';

export function setDictionaryMode(mode) {
  if (mode !== 'v1' && mode !== 'v2') {
    throw new Error(`unknown dictionary mode: ${mode}`);
  }
  dictionaryMode = mode;
}

export function getDictionaryMode() {
  return dictionaryMode;
}

export const DEFECTIVE_ACCEPT = new Set(["כסא","זכרון","שלטון","מסדרון","ספרון","פתרון","עגלון","חנון","ישרון","קטון"]);
// EXACT_REJECTS extras added with the dictionary v2 build (June 2026):
//   - ירושלים: proper-noun place name present in HSpell. Game policy rejects.
//   - עליי: plene spelling of עלי (already rejected); add the כתיב-מלא variant.
export const EXACT_REJECTS = new Set(["ירושלים","עליי","אותה","אותו","אותך","אותכם","אותכן","אותם","אותן","אותנו","אחריה","אחריהם","אחריהן","אחריו","אחריי","אחרייך","אחריך","אחריכם","אחריכן","אחרינו","איתה","איתו","איתי","איתך","איתכם","איתכן","איתם","איתן","איתנו","אלי","אליה","אליהם","אליהן","אליו","אלייך","אליך","אליכם","אליכן","אלינו","אצלה","אצלו","אצלי","אצלך","אצלכם","אצלכן","אצלם","אצלן","אצלנו","בלעדי","בלעדיה","בלעדיהם","בלעדיהן","בלעדיו","בלעדייך","בלעדיך","בלעדיכם","בלעדיכן","בלעדינו","בשבילה","בשבילהן","בשבילו","בשבילי","בשבילך","בשבילכם","בשבילכן","בשבילם","בשבילנו","כמוה","כמוהו","כמוך","כמוכם","כמוכן","כמונו","כמוני","כמותם","כמותן","לידה","לידו","לידי","לידך","לידכם","לידכן","לידם","לידן","לידנו","למענה","למענו","למעני","למענך","למענכם","למענכן","למענם","למענן","למעננו","לפניה","לפניהם","לפניהן","לפניו","לפניי","לפנייך","לפניך","לפניכם","לפניכן","לפנינו","מאחוריה","מאחוריהם","מאחוריהן","מאחוריו","מאחוריי","מאחורייך","מאחוריך","מאחוריכם","מאחוריכן","מאחורינו","מולה","מולו","מולי","מולך","מולכם","מולכן","מולם","מולן","מולנו","ממך","ממכם","ממכן","ממנה","ממנו","ממני","נגדה","נגדו","נגדי","נגדך","נגדכם","נגדכן","נגדם","נגדן","נגדנו","עלי","עליה","עליהם","עליהן","עליו","עלייך","עליך","עליכם","עליכן","עלינו","עמה","עמהן","עמו","עמי","עמך","עמכם","עמכן","עמם","עמנו","שלה","שלהם","שלהן","שלו","שלי","שלך","שלכם","שלכן","שלנו","תוכה","תוכו","תוכי","תוכך","תוכם","תוכן","תוכנו","נאצי"]);
export const CLASSIC_ALLOW = new Set(["בה","בהם","בהן","בו","בי","בך","בכם","בכן","בנו","לה","להם","להן","לו","לי","לך","לכם","לכן","לנו"]);
export const COMMON_FALSE_POSSESSIVE = new Set(["מים","חיים","פנים","פני","שני","אחי","אחותי","אדוני","גוי","תוי"]);
export const PREFIXES = new Set(["ו","ה","ב","כ","ל","ש","מ"]);
export const POSSESSIVE_SUFFIXES = ["יהם","יהן","יכם","יכן","ינו","ייך","יך","יה","יו","כם","כן","נו","יי"];
export const VERB_SUFFIXES = ["תנה","תם","תן","תי","נו","נה","ים","ות","ת","ה"];

export function addWordsFromText(txt) {
  txt.split(/\r?\n/).forEach((raw) => {
    const w = raw.trim();
    if (w) DICT.add(w);
  });
}

export async function loadDict() {
  const resp = await fetch(DICT_BASE_URL, { cache: 'no-cache' });
  if (!resp.ok) {
    throw new Error(`dictionary file fetch failed: ${resp.status}`);
  }
  const txt = await resp.text();
  addWordsFromText(txt);
  dictReady = true;
  return DICT.size;
}

// v2 loader: fetches the DAWG-encoded curated lexicon and populates both the
// DAWG (for isValid lookups) and the legacy DICT Set (so iteration callers
// like the mini-game word search and bot word generator keep working).
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

// Bot vocabulary: independent of the active dictionary mode, the offline bot
// always picks candidate words from the legacy 40K list. This keeps bot play
// strength stable as the player-facing dictionary grows. We fetch the legacy
// file once per session and cache; the bot uses this list as its candidate
// universe, while the validator (isValid) still runs against the active
// dictionary so any word the bot proposes is naturally accepted.
let legacyBotVocabularyCache = null;
let legacyBotVocabularyPromise = null;

export async function loadBotLegacyVocabularyOnce(url = DICT_BASE_URL) {
  if (legacyBotVocabularyCache) return legacyBotVocabularyCache;
  if (!legacyBotVocabularyPromise) {
    legacyBotVocabularyPromise = (async () => {
      const resp = await fetch(url, { cache: 'no-cache' });
      if (!resp.ok) throw new Error(`legacy bot vocabulary fetch failed: ${resp.status}`);
      const txt = await resp.text();
      legacyBotVocabularyCache = txt.split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
      return legacyBotVocabularyCache;
    })().catch((e) => { legacyBotVocabularyPromise = null; throw e; });
  }
  return legacyBotVocabularyPromise;
}

// Synchronous accessor for the cached legacy vocabulary. Returns null if
// loadBotLegacyVocabularyOnce hasn't completed yet — callers should fall back
// to DICT in that case.
export function getBotLegacyVocabularyCached() {
  return legacyBotVocabularyCache;
}

// Test-only: clear the bot-vocabulary cache so tests can re-seed.
export function resetBotLegacyVocabularyForTests() {
  legacyBotVocabularyCache = null;
  legacyBotVocabularyPromise = null;
}

// Test-only: pre-seed the cache without doing a fetch.
export function setBotLegacyVocabularyForTests(words) {
  legacyBotVocabularyCache = Array.isArray(words) ? [...words] : null;
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
  if (word.length < 3 || CLASSIC_ALLOW.has(word)) return false;
  if (!PREFIXES.has(word[0])) return false;
  const stripped = word.slice(1);
  return dictHas(stripped) || guessLemmaFromMissing(stripped) !== null;
}

export function looksLikePossessive(word) {
  if (COMMON_FALSE_POSSESSIVE.has(word) || CLASSIC_ALLOW.has(word)) return false;
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

// Main entry: analyze a word, return {valid, word, lemma, reason}
export function analyze(rawWord) {
  const word = rawWord.trim().split("").filter(ch => ch >= "א" && ch <= "ת").join("");
  if (!word) return { valid: false, word, lemma: null, reason: "empty" };
  if (dictHas(word)) return { valid: true, word, lemma: word, reason: "exact-match" };
  return { valid: false, word, lemma: null, reason: "not-in-b64-dictionary" };
}

export function isValid(w) {
  if (dictionaryMode === 'v2') return isValidV2(w);

  // v1 path — unchanged from the original implementation, plus the
  // BLOCKED_OVERLAY check (admin-removed words always reject).
  if (BLOCKED_OVERLAY.size > 0) {
    const cleaned = (w || '').trim().split('').filter((ch) => ch >= 'א' && ch <= 'ת').join('');
    if (cleaned && BLOCKED_OVERLAY.has(cleaned)) {
      validationLogger?.('[isValid]', JSON.stringify(w), '->', '✗ INVALID', '| blocked-overlay');
      return false;
    }
  }
  // Legacy HebrewValidator ultimately accepts exact dictionary hits. Keep that
  // guarantee here so a stricter/stale validator cannot reject a word that is
  // present in the active dictionary, such as "מפורשת".
  const exact = analyze(w);
  if (exact.valid) {
    validationLogger?.('[isValid]', JSON.stringify(w), '->', '✓ VALID', '|', exact.reason);
    return true;
  }

  // Use HebrewValidator when available (better accuracy)
  let result, reason;
  const hv = globalThis.HebrewValidator;
  if (hv && hv.ready && DICT.size > 0) {
    const v = hv.validate(w);
    result = v.valid;
    reason = v.reason + (v.confidence ? ' [' + v.confidence + ']' : '');
  } else {
    result = exact.valid;
    reason = exact.reason;
  }
  validationLogger?.('[isValid]', JSON.stringify(w), '->', result ? '✓ VALID' : '✗ INVALID', '|', reason);
  return result;
}

// v2 validation path: DAWG lookup + policy overlays, no morphology fallback.
// Synchronous, returns boolean — same contract as v1 isValid().
//
// Policy order (first match wins):
//   1. Clean input to Hebrew letters only; empty → invalid.
//   2. EXACT_REJECTS hit → invalid (slurs, possessive-suffixed prepositions).
//   3. CLASSIC_ALLOW hit → valid (short particles like בה, לי, לכם).
//   4. DEFECTIVE_ACCEPT hit → valid (10 defective spellings the curated list
//      may or may not contain; pinned for safety).
//   5. DAWG.has(word) OR DAWG.has(terminal-final variant) → valid.
//   6. Approved-overlay hit (Firebase-approved words added to DICT after
//      loadDictV2) → valid.
//   7. Otherwise invalid.
function isValidV2(rawWord) {
  if (!dawg) {
    validationLogger?.('[isValidV2]', JSON.stringify(rawWord), '->', '✗ INVALID', '| dawg-not-loaded');
    return false;
  }
  const word = (rawWord || '').trim().split('').filter((ch) => ch >= 'א' && ch <= 'ת').join('');
  if (!word) {
    validationLogger?.('[isValidV2]', JSON.stringify(rawWord), '->', '✗ INVALID', '| empty');
    return false;
  }
  if (EXACT_REJECTS.has(word)) {
    validationLogger?.('[isValidV2]', JSON.stringify(word), '->', '✗ INVALID', '| exact-reject');
    return false;
  }
  if (BLOCKED_OVERLAY.has(word)) {
    validationLogger?.('[isValidV2]', JSON.stringify(word), '->', '✗ INVALID', '| blocked-overlay');
    return false;
  }
  if (CLASSIC_ALLOW.has(word) || DEFECTIVE_ACCEPT.has(word)) {
    validationLogger?.('[isValidV2]', JSON.stringify(word), '->', '✓ VALID', '| policy-allow');
    return true;
  }
  for (const variant of terminalFinalVariants(word)) {
    if (dawg.has(variant)) {
      validationLogger?.('[isValidV2]', JSON.stringify(word), '->', '✓ VALID', '| dawg-hit');
      return true;
    }
  }
  // Firebase-approved overlay is merged into DICT (see main.js
  // syncApprovedDictionaryWordsOnce). Honor those even if the binary doesn't
  // contain them — admin-approved words must always validate.
  for (const variant of terminalFinalVariants(word)) {
    if (DICT.has(variant)) {
      validationLogger?.('[isValidV2]', JSON.stringify(word), '->', '✓ VALID', '| approved-overlay');
      return true;
    }
  }
  validationLogger?.('[isValidV2]', JSON.stringify(word), '->', '✗ INVALID', '| not-in-dawg');
  return false;
}
