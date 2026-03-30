/**
 * hebrew-validator.js
 * Hebrew word validation system for Bonus / Scrabble game
 *
 * ARCHITECTURE (simplified):
 *   Layer 1 — Surface normalization + final-letter handling
 *   Layer 2 — Dictionary lookup (exact match only, no morphological guessing)
 *   Layer 3 — Main validator (analyzeHebrewWord / validateHebrewWord)
 *   Layer 4 — Bot integration helpers
 *   Layer 5 — Logging / debugging
 *
 * VALIDATION LOGIC:
 *   1. Normalize input (strip non-Hebrew, collapse final letters)
 *   2. Check FORCE_REJECT  → immediate reject
 *   3. Check FORCE_ACCEPT  → immediate accept (bypasses length check; used for 2-letter words)
 *   4. Reject words shorter than MIN_WORD_LENGTH (3)
 *   5. Exact dictionary lookup (with final-letter normalization only)
 *
 * No prefix stripping, no suffix stripping, no ktiv/orthographic variants.
 *
 * INTEGRATION:
 *   Load this file after the main game script that defines and loads DICT.
 *   Call window.HebrewValidator.init(DICT) once the dictionary is ready.
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// INTERNAL STATE
// ─────────────────────────────────────────────────────────────

const _HV = {
  ready: false,
  cache: new Map(),        // word -> validateHebrewWord result
  rejectedLog: [],         // Layer 5 log
  DICT: null,              // reference to game's DICT Set
};

const MIN_WORD_LENGTH = 3;

function normalizeFinalLetters(word) {
  return String(word)
    .replace(/ך/g, 'כ')
    .replace(/ם/g, 'מ')
    .replace(/ן/g, 'נ')
    .replace(/ף/g, 'פ')
    .replace(/ץ/g, 'צ');
}

// ─────────────────────────────────────────────────────────────
// LOOKUP TABLES
// (Add/remove entries as the game evolves)
// ─────────────────────────────────────────────────────────────

/**
 * Words that bypass minimum-length and dictionary checks and are always accepted.
 * Primarily used for valid 2-letter Hebrew words.
 * Grow this list over time as gaps are found during play.
 */
const FORCE_ACCEPT = new Set([
  // ── Common 2-letter function words / pronouns ──
  'או','אז','אל','אם','אף',
  'בו','בי',
  'די',
  'הן',
  'זה','זו',
  'חי',
  'יש',
  'כי','כל','כן',
  'לא','לו','לי',
  'מה','מי',
  'נא',
  'על',
  'פה',
  'צו',
  'קם',
  'שי',
  'אך','אש','אט','בא','גל','הל','חף','כד','כת','נר','שם','תג','תן','אותי',

  // ── Common 2-letter nouns / other ──
  'אב','אח',
  'בן','בת',
  'גב','גד',
  'דג','דד','דם','דף','דק',
  'הד','הר',
  'חג','חם','חן','חץ',
  'יד','ים',
  'כף',
  'לב','לד',
  'מד','מת',
  'נס',
  'סל','סם',
  'עז','עט','עם','עץ','עת',
  'צד','צל','צר',
  'קו','קל','קן','קץ','קר',
  'רב','רד','רז','רך','רע',
  'שן','שר',
  'תא','תו','תל','תם',
].map(normalizeFinalLetters));

/**
 * Words that are always rejected — pronouns, preposition+pronoun combos,
 * and anything hspell includes that makes no sense as a standalone game word.
 * Grow this list over time as the bot surfaces bad entries.
 */
const FORCE_REJECT = new Set([
  // Pronoun + preposition compounds
  'אותה','אותו','אותך','אותכם','אותכן','אותם','אותן','אותנו',
  'אחריה','אחריהם','אחריהן','אחריו','אחריי','אחרייך','אחריך','אחריכם','אחריכן','אחרינו',
  'איתה','איתו','איתי','איתך','איתכם','איתכן','איתם','איתן','איתנו',
  'אלי','אליה','אליהם','אליהן','אליו','אלייך','אליך','אליכם','אליכן','אלינו',
  'אצלה','אצלו','אצלי','אצלך','אצלכם','אצלכן','אצלם','אצלן','אצלנו',
  'בלעדי','בלעדיה','בלעדיהם','בלעדיהן','בלעדיו','בלעדייך','בלעדיך','בלעדיכם','בלעדיכן','בלעדינו',
  'בשבילה','בשבילהן','בשבילו','בשבילי','בשבילך','בשבילכם','בשבילכן','בשבילם','בשבילנו',
  'כמוה','כמוהו','כמוך','כמוכם','כמוכן','כמונו','כמוני','כמותם','כמותן',
  'לידה','לידו','לידי','לידך','לידכם','לידכן','לידם','לידן','לידנו',
  'למענה','למענו','למעני','למענך','למענכם','למענכן','למענם','למענן','למעננו',
  'לפניה','לפניהם','לפניהן','לפניו','לפניי','לפנייך','לפניך','לפניכם','לפניכן','לפנינו',
  'מאחוריה','מאחוריהם','מאחוריהן','מאחוריו','מאחוריי','מאחורייך','מאחוריך','מאחוריכם','מאחוריכן','מאחורינו',
  'מולה','מולו','מולי','מולך','מולכם','מולכן','מולם','מולן','מולנו',
  'ממך','ממכם','ממכן','ממנה','ממנו','ממני',
  'נגדה','נגדו','נגדי','נגדך','נגדכם','נגדכן','נגדם','נגדן','נגדנו',
  'עלי','עליה','עליהם','עליהן','עליו','עלייך','עליך','עליכם','עליכן','עלינו',
  'עמה','עמהן','עמו','עמי','עמך','עמכם','עמכן','עמם','עמנו',
  'שלה','שלהם','שלהן','שלו','שלי','שלך','שלכם','שלכן','שלנו',
  'תוכה','תוכו','תוכי','תוכך','תוכם','תוכן','תוכנו',
].map(normalizeFinalLetters));

// ─────────────────────────────────────────────────────────────
// LAYER 1 — SURFACE NORMALIZATION
// ─────────────────────────────────────────────────────────────

/**
 * Strip non-Hebrew characters and normalize final letters to their
 * regular (non-final) equivalents for internal processing.
 * The board uses only regular letters — ך ם ן ף ץ never appear on tiles.
 * @param {string} word
 * @returns {{ cleaned: string, normalized: string }}
 */
function normalizeSurface(word) {
  const cleaned = word.trim().split('').filter(ch => ch >= 'א' && ch <= 'ת').join('');
  const normalized = normalizeFinalLetters(cleaned);
  return { cleaned, normalized };
}

/**
 * Given a word using regular (non-final) letters, generate the variant
 * where the LAST letter is replaced with its final form if applicable.
 * e.g. "ספר" stays ["ספר"]; "ספרנ" => ["ספרנ", "ספרן"]
 * @param {string} word
 * @returns {string[]}
 */
function generateFinalLetterVariants(word) {
  const results = [word];
  if (!word) return results;
  const toFinal = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };
  const last = word[word.length - 1];
  if (toFinal[last]) {
    results.push(word.slice(0, -1) + toFinal[last]);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// LAYER 2 — DICTIONARY LOOKUP
// ─────────────────────────────────────────────────────────────

/**
 * Check if a word (using regular board letters) is in the dictionary.
 * Tries the word as-is and with the last letter converted to its final form.
 * No orthographic variants, no prefix/suffix stripping.
 * @param {string} word  (normalized — no final letters)
 * @returns {string|null}  The matched surface form, or null
 */
function _dictLookup(word) {
  if (!_HV.DICT) return null;
  if (_HV.DICT.has(word)) return word;
  for (const v of generateFinalLetterVariants(word)) {
    if (v !== word && _HV.DICT.has(v)) return v;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// LAYER 3 — MAIN VALIDATOR
// ─────────────────────────────────────────────────────────────

/**
 * Full analysis of a Hebrew word. Returns rich debug info.
 * Validation order:
 *   1. Normalize
 *   2. FORCE_REJECT
 *   3. FORCE_ACCEPT  (bypasses length check)
 *   4. Minimum length (MIN_WORD_LENGTH = 3)
 *   5. Exact dictionary lookup
 *
 * @param {string} word
 * @returns {object}
 */
function analyzeHebrewWord(word) {
  const { cleaned, normalized } = normalizeSurface(word);

  const result = {
    input: word,
    cleaned,
    normalized,
    accepted: false,
    acceptedBy: null,       // { path, surface, confidence }
    rejectedReasons: [],
  };

  // ── 1. Empty / non-Hebrew ──
  if (!normalized) {
    result.rejectedReasons.push('empty_or_non_hebrew');
    return result;
  }

  // ── 2. FORCE_REJECT ──
  if (FORCE_REJECT.has(normalized)) {
    result.rejectedReasons.push('force_reject');
    return result;
  }

  // ── 3. FORCE_ACCEPT (bypasses length check) ──
  if (FORCE_ACCEPT.has(normalized)) {
    result.accepted = true;
    result.acceptedBy = { path: 'force_accept', surface: normalized, confidence: 'high' };
    return result;
  }

  // ── 4. Minimum length ──
  if (normalized.length < MIN_WORD_LENGTH) {
    result.rejectedReasons.push('too_short');
    return result;
  }

  // ── 5. Exact dictionary lookup ──
  const hit = _dictLookup(normalized);
  if (hit) {
    result.accepted = true;
    result.acceptedBy = { path: 'exact', surface: hit, confidence: 'high' };
    return result;
  }

  result.rejectedReasons.push('not_in_dictionary');
  return result;
}

/**
 * Simple validation entry point.
 * Returns { valid, surface, reason, confidence, debug }
 * @param {string} word
 * @returns {object}
 */
function validateHebrewWord(word) {
  if (_HV.cache.has(word)) return _HV.cache.get(word);

  const debug = analyzeHebrewWord(word);
  const result = {
    valid: debug.accepted,
    surface: debug.accepted ? debug.acceptedBy.surface : null,
    reason: debug.accepted ? debug.acceptedBy.path : (debug.rejectedReasons[0] || 'unknown'),
    confidence: debug.accepted ? debug.acceptedBy.confidence : 'none',
    debug,
  };

  _HV.cache.set(word, result);

  if (!result.valid) {
    _logRejectedWord(word, debug);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// LAYER 4 — BOT INTEGRATION HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Filter a list of bot candidate words through the validator.
 * Returns only valid words.
 * @param {string[]} words
 * @returns {string[]}
 */
function filterBotCandidates(words) {
  return words.filter(w => validateHebrewWord(w).valid);
}

/**
 * Quick check for bot: is this word safe to play?
 * @param {string} word
 * @returns {boolean}
 */
function isBotSafeWord(word) {
  return validateHebrewWord(word).valid;
}

// ─────────────────────────────────────────────────────────────
// LAYER 5 — LOGGING / DEBUGGING
// ─────────────────────────────────────────────────────────────

function _logRejectedWord(word, debugInfo, playerAppealed = false) {
  const entry = {
    word,
    reasons: debugInfo.rejectedReasons,
    playerAppealed,
    laterAccepted: false,
    timestamp: Date.now(),
  };
  _HV.rejectedLog.push(entry);

  // Keep log bounded
  if (_HV.rejectedLog.length > 200) _HV.rejectedLog.shift();

  if (typeof console !== 'undefined') {
    console.log('[HV] Rejected:', word, '| Reasons:', debugInfo.rejectedReasons.join(', '));
  }
}

/**
 * Print full analysis to console (for developer debugging).
 * @param {string} word
 */
function debugWord(word) {
  const analysis = analyzeHebrewWord(word);
  console.log('[HV] WORD ANALYSIS', JSON.stringify(analysis, null, 2));
  return analysis;
}

/**
 * Get the full rejection log.
 * @returns {object[]}
 */
function getRejectedLog() {
  return _HV.rejectedLog;
}

// ─────────────────────────────────────────────────────────────
// INITIALISATION
// ─────────────────────────────────────────────────────────────

/**
 * Initialise the validator with the game's DICT.
 * Call this once after the dictionary has been loaded.
 * @param {Set<string>} dict  The game's DICT Set
 */
function HV_init(dict) {
  _HV.DICT = dict;
  _HV.cache.clear();
  _HV.ready = true;
  window.HebrewValidator.ready = true;
  console.log('[HV] Hebrew validator ready. DICT size:', dict.size);
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────

window.HebrewValidator = {
  // Initialisation
  ready: false,          // set to true by init(); check this before using the validator
  init: HV_init,

  // Layer 1
  normalizeSurface,
  generateFinalLetterVariants,

  // Layer 2
  dictLookup: _dictLookup,

  // Layer 3
  analyze: analyzeHebrewWord,
  validate: validateHebrewWord,

  // Layer 4
  filterBotCandidates,
  isBotSafeWord,

  // Layer 5
  debugWord,
  getRejectedLog,

  // Lookup tables (writable so game can add/remove entries at runtime)
  FORCE_ACCEPT,
  FORCE_REJECT,

  // Constants
  MIN_WORD_LENGTH,
};
