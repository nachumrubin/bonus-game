// Boost 2.0 — challenge families + definition builders (spec §10, §11, §24).
//
// A ChallengeDefinition is fully concrete: family, difficulty, evaluation
// scope, typed parameters and reward are all fixed when the deck is built.
// The evaluator reads nothing else, so a definition evaluates identically
// in the digital game, the bot, the simulator and a future physical card.
// Pure data — no DOM, no Firebase.

import { DIFFICULTY, TARGET_LETTERS } from './rulesConfig.js';

export const FAMILY = Object.freeze({
  LETTER_HUNT:    'LETTER_HUNT',     // BST-001
  LONG_WORD:      'LONG_WORD',       // BST-002
  TILE_MASTER:    'TILE_MASTER',     // BST-003
  DOUBLE_LETTER:  'DOUBLE_LETTER',   // BST-004
  UNIQUE_LETTERS: 'UNIQUE_LETTERS',  // BST-005
  WORD_EDGE:      'WORD_EDGE',       // BST-006
  BRIDGE_BUILDER: 'BRIDGE_BUILDER',  // BST-007
  POWER_WORD:     'POWER_WORD',      // BST-008
  EXACT_TARGET:   'EXACT_TARGET',    // BST-009
});

export const SCOPE = Object.freeze({ TILE: 'TILE', WORD: 'WORD', MOVE: 'MOVE' });

export const EDGE_POSITION = Object.freeze({ START: 'START', END: 'END' });

export const FAMILY_META = Object.freeze({
  LETTER_HUNT:    Object.freeze({ code: 'BST-001', nameHe: 'ציד אותיות',     nameEn: 'Letter Hunt',    scope: SCOPE.TILE, icon: '🔤' }),
  LONG_WORD:      Object.freeze({ code: 'BST-002', nameHe: 'מילה ארוכה',     nameEn: 'Long Word',      scope: SCOPE.WORD, icon: '📏' }),
  TILE_MASTER:    Object.freeze({ code: 'BST-003', nameHe: 'מאסטר האותיות',  nameEn: 'Tile Master',    scope: SCOPE.MOVE, icon: '🧩' }),
  DOUBLE_LETTER:  Object.freeze({ code: 'BST-004', nameHe: 'אות כפולה',      nameEn: 'Double Letter',  scope: SCOPE.WORD, icon: '♊' }),
  UNIQUE_LETTERS: Object.freeze({ code: 'BST-005', nameHe: 'אותיות שונות',   nameEn: 'Unique Letters', scope: SCOPE.WORD, icon: '✳️' }),
  WORD_EDGE:      Object.freeze({ code: 'BST-006', nameHe: 'קצה המילה',      nameEn: 'Word Edge',      scope: SCOPE.WORD, icon: '↔️' }),
  BRIDGE_BUILDER: Object.freeze({ code: 'BST-007', nameHe: 'בניית גשר',      nameEn: 'Bridge Builder', scope: SCOPE.WORD, icon: '🌉' }),
  POWER_WORD:     Object.freeze({ code: 'BST-008', nameHe: 'מילת כוח',       nameEn: 'Power Word',     scope: SCOPE.WORD, icon: '💪' }),
  EXACT_TARGET:   Object.freeze({ code: 'BST-009', nameHe: 'בול במטרה',      nameEn: 'Exact Target',   scope: SCOPE.WORD, icon: '🎯' }),
});

export const ALL_FAMILIES = Object.freeze(Object.keys(FAMILY_META));

function def(family, difficulty, parameters, rules, idSuffix, extra = {}) {
  const meta = FAMILY_META[family];
  return {
    definitionId: `${meta.code}:${difficulty}${idSuffix ? `:${idSuffix}` : ''}`,
    family,
    difficulty,
    evaluationScope: meta.scope,
    parameters,
    reward: rules.rewards[difficulty],
    ...extra,
  };
}

// Typed constructors — one per family, so an invalid parameter combination
// (e.g. a Word Edge without a position) cannot be built.
export function letterHunt(rules, difficulty, targetLetter) {
  assertTarget(targetLetter);
  return def(FAMILY.LETTER_HUNT, difficulty, { targetLetter }, rules, targetLetter);
}
export function longWord(rules, difficulty, minimumLength = rules.thresholds.LONG_WORD[difficulty]) {
  return def(FAMILY.LONG_WORD, difficulty, { minimumLength }, rules, String(minimumLength));
}
export function tileMaster(rules, difficulty) {
  const minimumNewTiles = rules.thresholds.TILE_MASTER[difficulty];
  return def(FAMILY.TILE_MASTER, difficulty, { minimumNewTiles }, rules, String(minimumNewTiles));
}
export function doubleLetter(rules, difficulty) {
  const t = rules.thresholds.DOUBLE_LETTER[difficulty];
  return def(FAMILY.DOUBLE_LETTER, difficulty,
    { minRepeatedLetters: t.minRepeatedLetters, minWordLength: t.minWordLength }, rules, '');
}
export function uniqueLetters(rules, difficulty) {
  const minimumLength = rules.thresholds.UNIQUE_LETTERS[difficulty];
  return def(FAMILY.UNIQUE_LETTERS, difficulty, { minimumLength }, rules, String(minimumLength));
}
export function wordEdge(rules, difficulty, targetLetter, position) {
  assertTarget(targetLetter);
  if (position !== EDGE_POSITION.START && position !== EDGE_POSITION.END) {
    throw new Error(`word edge: invalid position ${position}`);
  }
  return def(FAMILY.WORD_EDGE, difficulty, { targetLetter, position }, rules, `${position}:${targetLetter}`);
}
export function bridgeBuilder(rules) {
  const fb = rules.bridgeFallback;
  const fallback = longWord(rules, fb.difficulty, fb.minimumLength);
  return def(FAMILY.BRIDGE_BUILDER, DIFFICULTY.HARD, {}, rules, '', { fallbackDefinitionId: fallback.definitionId });
}
export function powerWord(rules, difficulty) {
  const minimumBaseScore = rules.thresholds.POWER_WORD[difficulty];
  return def(FAMILY.POWER_WORD, difficulty, { minimumBaseScore }, rules, String(minimumBaseScore));
}
export function exactTarget(rules, difficulty) {
  const exactLength = rules.thresholds.EXACT_TARGET[difficulty];
  return def(FAMILY.EXACT_TARGET, difficulty, { exactLength }, rules, String(exactLength));
}

function assertTarget(l) {
  if (!TARGET_LETTERS.includes(l)) throw new Error(`excluded or invalid target letter: ${l}`);
}

// Validate a definition's shape (used on load / resume — a definition read
// back from storage must still be one the evaluator understands).
export function isValidDefinition(d) {
  if (!d || typeof d !== 'object' || !FAMILY_META[d.family]) return false;
  if (!Object.values(DIFFICULTY).includes(d.difficulty)) return false;
  if (d.evaluationScope !== FAMILY_META[d.family].scope) return false;
  if (!Number.isInteger(d.reward) || d.reward < 0) return false;
  const p = d.parameters ?? {};
  const posInt = (v) => Number.isInteger(v) && v > 0;
  switch (d.family) {
    case FAMILY.LETTER_HUNT:    return TARGET_LETTERS.includes(p.targetLetter);
    case FAMILY.LONG_WORD:      return posInt(p.minimumLength);
    case FAMILY.TILE_MASTER:    return posInt(p.minimumNewTiles);
    case FAMILY.DOUBLE_LETTER:  return posInt(p.minRepeatedLetters) && posInt(p.minWordLength);
    case FAMILY.UNIQUE_LETTERS: return posInt(p.minimumLength);
    case FAMILY.WORD_EDGE:      return TARGET_LETTERS.includes(p.targetLetter) && (p.position === 'START' || p.position === 'END');
    case FAMILY.BRIDGE_BUILDER: return typeof d.fallbackDefinitionId === 'string';
    case FAMILY.POWER_WORD:     return posInt(p.minimumBaseScore);
    case FAMILY.EXACT_TARGET:   return posInt(p.exactLength);
    default: return false;
  }
}

// Short Hebrew description of the requirement — tooltips and queue preview
// (spec §31, §32) read this so the UI never re-derives rule text.
export function describeRequirementHe(d) {
  const p = d.parameters ?? {};
  switch (d.family) {
    case FAMILY.LETTER_HUNT:    return `הניחו את האות ${p.targetLetter} על משבצת הבוסט`;
    case FAMILY.LONG_WORD:      return `מילה של ${p.minimumLength} אותיות לפחות דרך הבוסט`;
    case FAMILY.TILE_MASTER:    return `הניחו ${p.minimumNewTiles} אריחים חדשים לפחות במהלך אחד`;
    case FAMILY.DOUBLE_LETTER:
      return p.minRepeatedLetters >= 2
        ? 'מילה עם שתי אותיות שונות שכל אחת מופיעה פעמיים'
        : (p.minWordLength > 2 ? `מילה של ${p.minWordLength}+ אותיות עם אות שחוזרת` : 'מילה עם אות שמופיעה פעמיים');
    case FAMILY.UNIQUE_LETTERS: return `מילה של ${p.minimumLength}+ אותיות, כולן שונות`;
    case FAMILY.WORD_EDGE:      return p.position === 'START' ? `מילה שמתחילה באות ${p.targetLetter}` : `מילה שמסתיימת באות ${p.targetLetter}`;
    case FAMILY.BRIDGE_BUILDER: return 'מילה אחת שעוברת דרך הבוסט ודרך בוסט נוסף';
    case FAMILY.POWER_WORD:     return `מילה ששווה ${p.minimumBaseScore} נקודות לפחות`;
    case FAMILY.EXACT_TARGET:   return `מילה של בדיוק ${p.exactLength} אותיות`;
    default: return '';
  }
}

// Short parameter badge for the board icon (spec §30).
export function parameterBadge(d) {
  const p = d.parameters ?? {};
  switch (d.family) {
    case FAMILY.LETTER_HUNT:    return p.targetLetter;
    case FAMILY.LONG_WORD:      return `${p.minimumLength}+`;
    case FAMILY.TILE_MASTER:    return `×${p.minimumNewTiles}`;
    case FAMILY.DOUBLE_LETTER:  return p.minRepeatedLetters >= 2 ? '2×2' : (p.minWordLength > 2 ? `${p.minWordLength}+` : '×2');
    case FAMILY.UNIQUE_LETTERS: return `${p.minimumLength}≠`;
    case FAMILY.WORD_EDGE:      return p.position === 'START' ? `${p.targetLetter}…` : `…${p.targetLetter}`;
    case FAMILY.BRIDGE_BUILDER: return '⇄';
    case FAMILY.POWER_WORD:     return `${p.minimumBaseScore}⚡`;
    case FAMILY.EXACT_TARGET:   return `=${p.exactLength}`;
    default: return '';
  }
}
