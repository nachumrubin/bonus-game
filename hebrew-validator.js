/**
 * hebrew-validator.js
 * Hebrew word validation system for Bonus / Scrabble game
 *
 * ARCHITECTURE:
 *   Layer 1 — Surface normalization
 *   Layer 2 — Candidate generation (final-letter variants, ktiv variants)
 *   Layer 3 — Prefix hypotheses
 *   Layer 4 — Suffix hypotheses
 *   Layer 5 — Dictionary lookup (uses external DICT Set)
 *   Layer 6 — Game policy filter
 *   Layer 7 — Main validator (analyzeHebrewWord / validateHebrewWord)
 *   Layer 8 — Bot integration helpers
 *   Layer 9 — Logging / debugging
 *
 * INTEGRATION:
 *   This file must be loaded AFTER the main game script that defines DICT.
 *   Call HV_init() once DICT is ready.
 *   Replace calls to analyze(w) / isValid(w) with:
 *     validateHebrewWord(w).valid
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// INTERNAL STATE
// ─────────────────────────────────────────────────────────────

const _HV = {
  ready: false,
  cache: new Map(),           // word -> validateHebrewWord result
  rejectedLog: [],            // Layer 9 log
  DICT: null,                 // reference to game's DICT Set
};

// ─────────────────────────────────────────────────────────────
// LAYER 5 — LOOKUP TABLES
// (These complement the main DICT; add/remove as the game evolves)
// ─────────────────────────────────────────────────────────────

// Words that must always be accepted regardless of other logic
const FORCE_ALLOW = new Set([
  // Very common defective spellings (כתיב חסר) whose plene form is in DICT
  'כסא','זכרון','שלטון','מסדרון','ספרון','פתרון','עגלון',
  'חנון','ישרון','קטון','גנון','ספון','כלון',
  // Short but valid standalone words
  'אל','כן','לא','גם','רק','עם','כי','אם','או','כל','של','עד',
  'מה','זה','זו','הם','הן','הוא','היא','אנו','אני',
  // Common prefixed forms that look suspicious but are fine
  'בה','בהם','בהן','בו','בי','בך','בכם','בכן','בנו',
  'לה','להם','להן','לו','לי','לך','לכם','לכן','לנו',
  // Words with common ambiguous letters
  'מים','חיים','פנים','שני','אחי','אדוני',
]);

// Words that must always be rejected (pronouns, preposition+pronoun combos, etc.)
const FORCE_REJECT = new Set([
  'אותה','אותו','אותי','אותך','אותכם','אותכן','אותם','אותן','אותנו',
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
]);

// Legal prefix letters and their combinations
const PREFIX_LETTERS = new Set(['ו','ה','ל','ב','כ','ש','מ']);

// Suffix patterns: [suffix_string, kind, min_stem_length]
const SUFFIX_RULES = [
  // Possessive / pronoun — generally rejected in game
  ['יהם','possessive', 3], ['יהן','possessive', 3],
  ['יכם','possessive', 3], ['יכן','possessive', 3],
  ['ינו','possessive', 3], ['ייך','possessive', 3],
  ['יך', 'possessive', 3], ['יה', 'possessive', 3],
  ['יו', 'possessive', 3], ['כם', 'possessive', 3],
  ['כן', 'possessive', 3], ['נו', 'possessive', 3],
  // Plural / feminine — generally accepted
  ['ים','plural',    3],
  ['ות','plural',    3],
  ['יות','plural',   3],
  // Feminine singular — accepted
  ['ה',  'feminine', 3],
  ['ת',  'feminine', 3],
  // Verb conjugation endings — accepted if stem is valid
  ['תי', 'verb_1sg', 3],
  ['ת',  'verb_2sg', 3],
  ['נו',  'verb_1pl', 3],
  ['ו',   'verb_3pl', 3],
  // Short pronoun endings — cautious
  ['י',  'pronoun_or_fem', 2],
  ['ך',  'pronoun_2sg',    2],
  ['ו',  'pronoun_3sg',    2],
];

// ─────────────────────────────────────────────────────────────
// LAYER 1 — SURFACE NORMALIZATION
// ─────────────────────────────────────────────────────────────

/**
 * Normalize final letters to regular letters for internal comparison.
 * The board uses only regular letters (no ך ם ן ף ץ).
 * @param {string} word
 * @returns {{ original: string, normalized: string }}
 */
function normalizeSurface(word) {
  const original = word.trim();
  const normalized = original
    .replace(/ך/g, 'כ')
    .replace(/ם/g, 'מ')
    .replace(/ן/g, 'נ')
    .replace(/ף/g, 'פ')
    .replace(/ץ/g, 'צ');
  return { original, normalized };
}

/**
 * Given a word (using regular board letters), generate variants
 * where only the LAST letter is converted to its final form.
 * e.g. "נמוכ" => ["נמוכ", "נמוך"]
 * @param {string} word
 * @returns {string[]}
 */
function generateFinalLetterVariants(word) {
  const results = [word];
  if (!word) return results;
  const toFinal = { 'כ':'ך', 'מ':'ם', 'נ':'ן', 'פ':'ף', 'צ':'ץ' };
  const last = word[word.length - 1];
  if (toFinal[last]) {
    results.push(word.slice(0, -1) + toFinal[last]);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// LAYER 2 — CANDIDATE GENERATION
// ─────────────────────────────────────────────────────────────

/**
 * Generate orthographic variant candidates for dictionary lookup.
 * Conservative: strip or insert ONE ו/י at a time.
 * Returns deduplicated array of { surface, normalized, source }.
 * @param {string} word  (already normalized, no final letters)
 * @returns {Array}
 */
function generateValidationCandidates(word) {
  const seen = new Set();
  const results = [];
  const MAX_CANDIDATES = 24;

  function push(surface, source) {
    if (results.length >= MAX_CANDIDATES) return;
    const { normalized } = normalizeSurface(surface);
    // Deduplicate by normalized form
    if (seen.has(normalized)) return;
    seen.add(normalized);
    results.push({ surface, normalized, source });
  }

  // 1. Exact original + final-letter variants
  for (const v of generateFinalLetterVariants(word)) {
    push(v, 'exact');
  }

  // 2. ktiv variant: strip one interior ו or י (מלא→חסר)
  for (let i = 1; i < word.length - 1; i++) {
    if (word[i] === 'ו' || word[i] === 'י') {
      const stripped = word.slice(0, i) + word.slice(i + 1);
      for (const v of generateFinalLetterVariants(stripped)) {
        push(v, 'ktiv_haser');
      }
    }
  }
  // Strip trailing ו (common: שלו without possessive meaning)
  if (word.length > 3 && word[word.length - 1] === 'ו') {
    const stripped = word.slice(0, -1);
    for (const v of generateFinalLetterVariants(stripped)) {
      push(v, 'ktiv_haser');
    }
  }

  // 3. ktiv variant: insert one ו or י at each interior position (חסר→מלא)
  // Cap insertions to avoid explosion
  const insertCap = Math.min(word.length - 1, 5);
  for (let i = 1; i <= insertCap; i++) {
    for (const ins of ['י', 'ו']) {
      const inserted = word.slice(0, i) + ins + word.slice(i);
      for (const v of generateFinalLetterVariants(inserted)) {
        push(v, 'ktiv_male');
      }
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// LAYER 3 — PREFIX HYPOTHESES
// ─────────────────────────────────────────────────────────────

/**
 * Generate possible prefix parses for a word.
 * Max 2 prefixes, requires stem >= 2 chars.
 * @param {string} word (normalized)
 * @returns {Array<{ prefixes: string[], stem: string }>}
 */
function generatePrefixHypotheses(word) {
  const results = [];
  const seen = new Set();

  function add(prefixes, stem) {
    if (stem.length < 2) return;
    const key = prefixes.join('') + '|' + stem;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ prefixes: [...prefixes], stem });
  }

  // No prefix
  add([], word);

  // One prefix
  if (PREFIX_LETTERS.has(word[0]) && word.length >= 3) {
    const stem1 = word.slice(1);
    add([word[0]], stem1);

    // Two prefixes
    if (PREFIX_LETTERS.has(stem1[0]) && stem1.length >= 3) {
      // Don't double-strip the same letter (e.g. בב is rarely a valid double prefix)
      if (stem1[0] !== word[0] || word[0] === 'ו') {
        add([word[0], stem1[0]], stem1.slice(1));
      }
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// LAYER 4 — SUFFIX HYPOTHESES
// ─────────────────────────────────────────────────────────────

/**
 * Generate possible suffix parses for a stem.
 * Always includes a no-suffix hypothesis.
 * @param {string} stem (normalized)
 * @returns {Array<{ base: string, suffix: string, kind: string }>}
 */
function generateSuffixHypotheses(stem) {
  const results = [];
  const seen = new Set();

  function add(base, suffix, kind) {
    if (base.length < 2) return;
    if (seen.has(base + '|' + suffix)) return;
    seen.add(base + '|' + suffix);
    results.push({ base, suffix, kind });
  }

  // Always: no suffix
  add(stem, '', 'none');

  // Try each suffix rule
  for (const [suf, kind, minStem] of SUFFIX_RULES) {
    if (!stem.endsWith(suf)) continue;
    const base = stem.slice(0, -suf.length);
    if (base.length < minStem) continue;
    // Special case: don't strip ה from future-tense verbs (יX, תX, נX, אX + consonant)
    if (suf === 'ה' && 'יתנא'.includes(stem[0]) && stem.length >= 4 && !'אהויע'.includes(stem[1])) continue;
    add(base, suf, kind);
    // Also try final-letter variants of the base
    for (const fv of generateFinalLetterVariants(base)) {
      add(fv, suf, kind);
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// LAYER 5 — DICTIONARY LOOKUP HELPERS
// ─────────────────────────────────────────────────────────────

/** Look up word in DICT, trying final-letter variants */
function _dictHas(word) {
  if (!_HV.DICT) return false;
  if (_HV.DICT.has(word)) return true;
  // Try final-letter variant
  for (const v of generateFinalLetterVariants(word)) {
    if (_HV.DICT.has(v)) return true;
  }
  return false;
}

/** Try all validation candidates for a word against the dictionary */
function _dictHasCandidates(candidates) {
  for (const c of candidates) {
    if (_dictHas(c.surface) || _dictHas(c.normalized)) {
      return c;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// LAYER 6 — GAME POLICY FILTER
// ─────────────────────────────────────────────────────────────

/**
 * Assign a confidence level to an analysis path.
 * Higher = more trustworthy for the game.
 * 'high' | 'medium' | 'low' | 'reject'
 */
function _confidence(path) {
  switch (path) {
    case 'force_allow':    return 'high';
    case 'exact':          return 'high';
    case 'final_variant':  return 'high';
    case 'ktiv_haser':     return 'medium';
    case 'ktiv_male':      return 'medium';
    case 'suffix_plural':        return 'medium';
    case 'suffix_feminine':      return 'medium';   // was 'suffix_fem' — never matched
    case 'suffix_verb':          return 'medium';
    case 'suffix_pronoun_or_fem':return 'low';
    case 'suffix_pronoun_2sg':   return 'low';
    case 'suffix_pronoun_3sg':   return 'low';
    case 'prefix_1':       return 'medium';
    case 'prefix_1_suffix':return 'low';
    case 'prefix_2':       return 'low';
    case 'prefix_2_suffix':return 'reject'; // almost always wrong in a game context
    case 'possessive':     return 'reject';
    default:               return 'low';
  }
}

/**
 * Game policy: does this analysis pass for gameplay?
 * @param {{ path: string, prefixes: string[], suffix: string, kind: string }} analysis
 * @param {'classic'|'modern'} mode
 * @returns {boolean}
 */
function passesGamePolicy(analysis, mode = 'classic') {
  const conf = _confidence(analysis.path);

  // Reject is always rejected
  if (conf === 'reject') return false;

  // Possessive suffixes are rejected in both modes
  if (analysis.kind === 'possessive') return false;

  // Low confidence only allowed in modern mode
  if (conf === 'low' && mode === 'classic') return false;

  // Double prefix + any suffix: too speculative
  if (analysis.prefixes.length >= 2 && analysis.suffix) return false;

  return true;
}

// ─────────────────────────────────────────────────────────────
// LAYER 7 — MAIN VALIDATOR
// ─────────────────────────────────────────────────────────────

/**
 * Full analysis of a Hebrew word.
 * Returns rich debug info.
 */
function analyzeHebrewWord(word, options = {}) {
  const mode = options.mode || 'classic';
  const allowPrefixes = options.allowPrefixes !== false;
  const allowPossessives = options.allowPossessives || false;
  const allowOrtho = options.allowOrthographicVariants !== false;

  // Strip non-Hebrew chars
  const cleaned = word.trim().split('').filter(ch => ch >= 'א' && ch <= 'ת').join('');
  const { normalized } = normalizeSurface(cleaned);

  const result = {
    input: word,
    cleaned,
    normalized,
    candidatesTried: [],
    accepted: false,
    acceptedBy: null,
    rejectedReasons: [],
  };

  if (!normalized || normalized.length < 2) {
    result.rejectedReasons.push('too_short');
    return result;
  }

  // ── Fast path: FORCE_REJECT ──
  if (FORCE_REJECT.has(normalized)) {
    result.rejectedReasons.push('force_reject');
    return result;
  }

  // ── Fast path: FORCE_ALLOW ──
  if (FORCE_ALLOW.has(normalized)) {
    result.accepted = true;
    result.acceptedBy = { path: 'force_allow', surface: normalized, lemma: normalized, prefixes: [], suffix: '', kind: 'none', confidence: 'high' };
    return result;
  }

  // ── Try each prefix hypothesis ──
  const prefixHyps = allowPrefixes
    ? generatePrefixHypotheses(normalized)
    : [{ prefixes: [], stem: normalized }];

  for (const ph of prefixHyps) {
    const { prefixes, stem } = ph;

    // ── Try each suffix hypothesis for this stem ──
    const suffixHyps = generateSuffixHypotheses(stem);

    for (const sh of suffixHyps) {
      const { base, suffix, kind } = sh;

      // Skip possessive unless explicitly allowed
      if (kind === 'possessive' && !allowPossessives) {
        result.rejectedReasons.push(`possessive_suffix:${suffix}`);
        continue;
      }

      // Generate orthographic candidates for this base
      const candidates = allowOrtho
        ? generateValidationCandidates(base)
        : [{ surface: base, normalized: base, source: 'exact' }];

      result.candidatesTried.push(...candidates.map(c => c.surface));

      const hit = _dictHasCandidates(candidates);
      if (!hit) continue;

      // Determine path label for policy check
      let path;
      if (prefixes.length === 0 && !suffix) {
        path = hit.source === 'exact' ? 'exact'
             : hit.source === 'final_variant' ? 'final_variant'
             : hit.source === 'ktiv_haser' ? 'ktiv_haser'
             : 'ktiv_male';
      } else if (prefixes.length === 0 && suffix) {
        path = kind === 'plural' || kind === 'feminine' ? 'suffix_' + kind
             : kind.startsWith('verb') ? 'suffix_verb'
             : 'suffix_' + kind;
      } else if (prefixes.length === 1 && !suffix) {
        path = 'prefix_1';
      } else if (prefixes.length === 1 && suffix) {
        path = 'prefix_1_suffix';
      } else if (prefixes.length === 2 && !suffix) {
        path = 'prefix_2';
      } else {
        path = 'prefix_2_suffix';
      }

      const confidence = _confidence(path);
      const analysis = { path, surface: hit.surface, lemma: hit.surface, prefixes, suffix, kind, confidence };

      // Apply game policy
      if (!passesGamePolicy(analysis, mode)) {
        result.rejectedReasons.push(`policy:${path}:${confidence}`);
        continue;
      }

      // Accepted!
      result.accepted = true;
      result.acceptedBy = analysis;
      return result;
    }
  }

  result.rejectedReasons.push('no_valid_parse_found');
  return result;
}

/**
 * Simple validation entry point.
 * Returns { valid, normalizedAcceptedForm, lemma, reason, confidence, debug }
 */
function validateHebrewWord(word, options = {}) {
  // Cache check — key must include all options that affect the result
  const cacheKey = word + '|' + (options.mode || 'classic')
    + '|p' + (options.allowPrefixes === false ? '0' : '1')
    + '|o' + (options.allowOrthographicVariants === false ? '0' : '1');
  if (_HV.cache.has(cacheKey)) return _HV.cache.get(cacheKey);

  const debug = analyzeHebrewWord(word, options);
  const result = {
    valid: debug.accepted,
    normalizedAcceptedForm: debug.accepted ? debug.acceptedBy.surface : null,
    lemma: debug.accepted ? debug.acceptedBy.lemma : null,
    reason: debug.accepted ? debug.acceptedBy.path : (debug.rejectedReasons[0] || 'unknown'),
    confidence: debug.accepted ? debug.acceptedBy.confidence : 'none',
    debug,
  };

  _HV.cache.set(cacheKey, result);

  // Log rejections for Layer 9
  if (!result.valid) {
    logRejectedWord(word, debug);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// LAYER 8 — BOT INTEGRATION HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Filter a list of bot candidate words through the validator.
 * Returns words sorted by confidence (high first).
 * Low-confidence words are excluded so the bot doesn't play junk.
 * @param {string[]} words
 * @param {'classic'|'modern'} mode
 * @returns {string[]}
 */
function filterBotCandidates(words, mode = 'classic') {
  const scored = [];
  for (const w of words) {
    const v = validateHebrewWord(w, { mode });
    if (!v.valid) continue;
    const score = v.confidence === 'high' ? 3 : v.confidence === 'medium' ? 2 : 1;
    scored.push({ w, score });
  }
  // Sort high-confidence first, then return just the words
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.w);
}

/**
 * Quick check for bot: is this word safe to play?
 * Rejects low-confidence words so the bot doesn't embarrass itself.
 * @param {string} word
 * @returns {boolean}
 */
function isBotSafeWord(word) {
  const v = validateHebrewWord(word, { mode: 'classic' });
  return v.valid && v.confidence !== 'none' && v.confidence !== 'reject';
}

// ─────────────────────────────────────────────────────────────
// LAYER 9 — LOGGING / DEBUGGING
// ─────────────────────────────────────────────────────────────

/**
 * Log a rejected word with its debug info.
 * Stored in _HV.rejectedLog for developer inspection.
 */
function logRejectedWord(word, debugInfo, playerAppealed = false) {
  const entry = {
    word,
    reasons: debugInfo.rejectedReasons,
    candidatesTried: debugInfo.candidatesTried,
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
 */
function debugWord(word) {
  const analysis = analyzeHebrewWord(word, { mode: 'classic', explain: true });
  console.log('WORD ANALYSIS', JSON.stringify(analysis, null, 2));
  return analysis;
}

/**
 * Get the full rejection log.
 */
function getRejectedLog() {
  return _HV.rejectedLog;
}

// ─────────────────────────────────────────────────────────────
// INITIALISATION
// ─────────────────────────────────────────────────────────────

/**
 * Initialise the validator with the game's DICT.
 * Call this once the dictionary has been loaded.
 * @param {Set<string>} dict  The game's DICT Set
 */
function HV_init(dict) {
  _HV.DICT = dict;
  _HV.cache.clear();
  _HV.ready = true;
  window.HebrewValidator.ready = true;  // exposes ready flag for external .ready checks
  console.log('[HV] Hebrew validator ready. DICT size:', dict.size);
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────

window.HebrewValidator = {
  // Initialisation
  ready: false,   // set to true by HV_init(); check this, not .init
  init: HV_init,

  // Layer 1
  normalizeSurface,
  generateFinalLetterVariants,

  // Layer 2
  generateValidationCandidates,

  // Layer 3
  generatePrefixHypotheses,

  // Layer 4
  generateSuffixHypotheses,

  // Layer 5 (internal dict access)
  dictHas: _dictHas,

  // Layer 6
  passesGamePolicy,

  // Layer 7
  analyze: analyzeHebrewWord,
  validate: validateHebrewWord,

  // Layer 8
  filterBotCandidates,
  isBotSafeWord,

  // Layer 9
  logRejectedWord,
  debugWord,
  getRejectedLog,

  // Lookup tables (writable so game can add entries at runtime)
  FORCE_ALLOW,
  FORCE_REJECT,
};
