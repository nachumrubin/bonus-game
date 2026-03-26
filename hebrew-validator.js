// ==== STRICT HEBREW VALIDATOR (CLASSIC MODE) ====

const FORCE_REJECT = new Set(['רא']);

const FORCE_ALLOW = new Set([
  'אל','כן','לא','גם','רק','עם','כי','אם','או','כל','של','עד',
  'מה','זה','זו','הם','הן','הוא','היא','אנו','אני',
  'מים','חיים','פנים'
]);

const PREFIX_LETTERS = new Set(['ו','ה','ל','ב','כ']);

const SUFFIX_RULES = [
  ['ים','plural', 3],
  ['ות','plural', 3],
  ['יות','plural', 3],
  ['ה','feminine', 3],
  ['תי','verb_1sg', 3],
  ['נו','verb_1pl', 3],
];

function _confidence(path) {
  switch (path) {
    case 'exact': return 'high';
    case 'ktiv_haser': return 'medium';
    default: return 'reject';
  }
}

function passesGamePolicy(path) {
  const c = _confidence(path);
  return c === 'high' || c === 'medium';
}

function validate(word, dict) {
  const w = word.trim();

  if (FORCE_REJECT.has(w)) return false;

  if (FORCE_ALLOW.has(w)) return true;

  // 🔥 RULE: short words must be exact
  if (w.length <= 2) {
    return dict.has(w);
  }

  if (dict.has(w)) return true;

  // ktiv haser (remove one ו/י)
  for (let i = 1; i < w.length - 1; i++) {
    if (w[i] === 'ו' || w[i] === 'י') {
      const stripped = w.slice(0, i) + w.slice(i + 1);
      if (dict.has(stripped)) return true;
    }
  }

  // prefixes (STRICT)
  if (PREFIX_LETTERS.has(w[0]) && w.length >= 4) {
    const stem = w.slice(1);
    if (stem.length >= 3 && dict.has(stem)) return true;
  }

  // suffixes (STRICT)
  for (const [suf] of SUFFIX_RULES) {
    if (w.endsWith(suf) && w.length >= suf.length + 3) {
      const base = w.slice(0, -suf.length);
      if (dict.has(base)) return true;
    }
  }

  return false;
}

window.HebrewValidator = { validate };