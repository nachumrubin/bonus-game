// Hebrew dictionary + morphological validation.
// Ported verbatim from index.html:2802-3145 (norm, candidateLemmas, analyze,
// isValid, plus their supporting tables and helpers).
//
// Two validation paths exist:
//   1. If globalThis.HebrewValidator is loaded and ready, use it (more accurate).
//   2. Otherwise fall back to analyze(), which is a plain dict lookup with
//      final-form normalization.
//
// Dictionary loading is split out: call loadDict() once on boot to populate
// DICT from ./data/dictionary.base.txt. The legacy embedded base64 fallback
// from index.html:2940 was dropped — it duplicated the static file, was hard
// to maintain, and isn't reached on production fetch paths.

export const DICT = new Set();
export let dictReady = false;
let validationLogger = null;

export const DICT_BASE_URL = './data/dictionary.base.txt';

export const DEFECTIVE_ACCEPT = new Set(["כסא","זכרון","שלטון","מסדרון","ספרון","פתרון","עגלון","חנון","ישרון","קטון"]);
export const EXACT_REJECTS = new Set(["אותה","אותו","אותך","אותכם","אותכן","אותם","אותן","אותנו","אחריה","אחריהם","אחריהן","אחריו","אחריי","אחרייך","אחריך","אחריכם","אחריכן","אחרינו","איתה","איתו","איתי","איתך","איתכם","איתכן","איתם","איתן","איתנו","אלי","אליה","אליהם","אליהן","אליו","אלייך","אליך","אליכם","אליכן","אלינו","אצלה","אצלו","אצלי","אצלך","אצלכם","אצלכן","אצלם","אצלן","אצלנו","בלעדי","בלעדיה","בלעדיהם","בלעדיהן","בלעדיו","בלעדייך","בלעדיך","בלעדיכם","בלעדיכן","בלעדינו","בשבילה","בשבילהן","בשבילו","בשבילי","בשבילך","בשבילכם","בשבילכן","בשבילם","בשבילנו","כמוה","כמוהו","כמוך","כמוכם","כמוכן","כמונו","כמוני","כמותם","כמותן","לידה","לידו","לידי","לידך","לידכם","לידכן","לידם","לידן","לידנו","למענה","למענו","למעני","למענך","למענכם","למענכן","למענם","למענן","למעננו","לפניה","לפניהם","לפניהן","לפניו","לפניי","לפנייך","לפניך","לפניכם","לפניכן","לפנינו","מאחוריה","מאחוריהם","מאחוריהן","מאחוריו","מאחוריי","מאחורייך","מאחוריך","מאחוריכם","מאחוריכן","מאחורינו","מולה","מולו","מולי","מולך","מולכם","מולכן","מולם","מולן","מולנו","ממך","ממכם","ממכן","ממנה","ממנו","ממני","נגדה","נגדו","נגדי","נגדך","נגדכם","נגדכן","נגדם","נגדן","נגדנו","עלי","עליה","עליהם","עליהן","עליו","עלייך","עליך","עליכם","עליכן","עלינו","עמה","עמהן","עמו","עמי","עמך","עמכם","עמכן","עמם","עמנו","שלה","שלהם","שלהן","שלו","שלי","שלך","שלכם","שלכן","שלנו","תוכה","תוכו","תוכי","תוכך","תוכם","תוכן","תוכנו"]);
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
