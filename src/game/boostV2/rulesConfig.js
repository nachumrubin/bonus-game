// Boost 2.0 — versioned rules configuration (spec §9, §24 MatchRules, §44).
//
// Every Boost 2.0 match snapshots its MatchRules object into state at
// creation (state.boostV2.rules). Changing or adding a version here can
// therefore never alter a match already in progress (spec §29, §44).
// Never mutate a published version — add a new one and point
// CURRENT_BOOST_V2_RULES_VERSION at it.
//
// Values marked PROVISIONAL are prototype defaults pending product-owner
// approval (spec Part L). Pure data — no DOM, no Firebase.

import { BOARD_SIZE } from '../core/board.js';
import { RACK_SIZE } from '../core/tileBag.js';
import { BINGO_BONUS } from '../core/scoringEngine.js';

export const RULESET = Object.freeze({
  LEGACY_V1: 'LEGACY_V1',
  BOOST_V2: 'BOOST_V2',
});

export const DIFFICULTY = Object.freeze({ EASY: 'EASY', MEDIUM: 'MEDIUM', HARD: 'HARD' });

// Accessible presentation for each difficulty: colour is never the only
// differentiator (spec §9) — every level also has a symbol and a label.
export const DIFFICULTY_PRESENTATION = Object.freeze({
  EASY:   Object.freeze({ color: 'green',  symbol: '●',   labelHe: 'קל',    labelEn: 'Easy' }),
  MEDIUM: Object.freeze({ color: 'orange', symbol: '◆◆',  labelHe: 'בינוני', labelEn: 'Medium' }),
  HARD:   Object.freeze({ color: 'red',    symbol: '▲▲▲', labelHe: 'קשה',   labelEn: 'Hard' }),
});

// Letters excluded from specific-letter targets (Letter Hunt, Word Edge).
export const EXCLUDED_TARGET_LETTERS = Object.freeze(['א', 'ה', 'ו', 'י']);
export const TARGET_LETTERS = Object.freeze([
  'ב', 'ג', 'ד', 'ז', 'ח', 'ט', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ', 'ק', 'ר', 'ש', 'ת',
]);

export const PLACEMENT_ORDER = Object.freeze({
  // Second player, starting player, second player (spec §22 recommended).
  SECOND_FIRST_SECOND: 'SECOND_FIRST_SECOND',
});

const RULES_0_1 = deepFreeze({
  rulesVersion: 'boost-v2.rules.0.1-proto',
  boardSize: BOARD_SIZE,
  rackCapacity: RACK_SIZE,
  minimumWordLength: 2,
  fullRackBonus: 25,
  activeBoostTarget: 3,
  boostPlacementDistance: 2,          // PROVISIONAL — Manhattan distance to nearest tile
  queuePreviewSize: 2,
  deckVersion: 'boost-v2.deck.0.1-candidate',
  centerSquares: [[4, 4], [4, 5], [5, 4], [5, 5]],
  rewards: { EASY: 5, MEDIUM: 10, HARD: 20 },   // PROVISIONAL balancing values
  // Challenge thresholds per difficulty — used to BUILD deck definitions.
  // A match never reads these at evaluation time: the evaluator only reads the
  // frozen parameters of the definition it is evaluating.
  thresholds: {
    LONG_WORD:      { EASY: 4, MEDIUM: 6, HARD: 8 },   // min word length
    TILE_MASTER:    { EASY: 3, MEDIUM: 5, HARD: 7 },   // min new tiles
    UNIQUE_LETTERS: { EASY: 4, MEDIUM: 5, HARD: 7 },   // min length, all unique
    POWER_WORD:     { EASY: 8, MEDIUM: 12, HARD: 18 }, // PROVISIONAL min base score
    EXACT_TARGET:   { EASY: 4, MEDIUM: 6, HARD: 8 },   // exact length
    DOUBLE_LETTER: {
      EASY:   { minRepeatedLetters: 1, minWordLength: 2 },
      MEDIUM: { minRepeatedLetters: 1, minWordLength: 5 },
      HARD:   { minRepeatedLetters: 2, minWordLength: 2 },
    },
  },
  bridgeFallback: { family: 'LONG_WORD', difficulty: 'HARD', minimumLength: 8 }, // PROVISIONAL
  initialPlacementOrder: PLACEMENT_ORDER.SECOND_FIRST_SECOND,
  exchangeDrawBeforeReturn: true,    // PROVISIONAL (spec §7 recommended default)
  // Legacy mechanics that Boost 2.0 turns off (spec §4, §5.2).
  legacyBonusSquares: false,
  locks: false,
  tileSwaps: false,
});

// 0.2 — product decisions of Nov 2026: full-rack bonus is the shared
// BINGO_BONUS (25), tile swaps stay available, locks stay removed, Power
// Word has no EASY level.
const RULES_0_2 = deepFreeze({
  ...JSON.parse(JSON.stringify(RULES_0_1)),
  rulesVersion: 'boost-v2.rules.0.2-proto',
  deckVersion: 'boost-v2.deck.0.2-candidate',
  fullRackBonus: BINGO_BONUS,
  thresholds: {
    ...JSON.parse(JSON.stringify(RULES_0_1.thresholds)),
    POWER_WORD: { MEDIUM: 12, HARD: 18 },          // PROVISIONAL; EASY removed
  },
  tileSwaps: true,
});

// 0.3 — product decisions of Nov 2026 (round 3): Bridge Builder has no
// alignment rule and no fallback; rack deductions only on natural endings
// (rack + bag empty, or the scoreless-turn limit) — engineV2.applyEndgameV2;
// a skipped opening-setup step is placed by the opponent — engineV2.
const RULES_0_3 = deepFreeze((() => {
  const r = JSON.parse(JSON.stringify(RULES_0_2));
  delete r.bridgeFallback;
  return { ...r, rulesVersion: 'boost-v2.rules.0.3-proto', deckVersion: 'boost-v2.deck.0.3-candidate' };
})());

export const RULES_REGISTRY = Object.freeze({
  [RULES_0_1.rulesVersion]: RULES_0_1,
  [RULES_0_2.rulesVersion]: RULES_0_2,
  [RULES_0_3.rulesVersion]: RULES_0_3,
});

export const CURRENT_BOOST_V2_RULES_VERSION = RULES_0_3.rulesVersion;

export function getRules(version = CURRENT_BOOST_V2_RULES_VERSION) {
  const r = RULES_REGISTRY[version];
  if (!r) throw new Error(`unknown Boost 2.0 rules version: ${version}`);
  return r;
}

// A JSON-safe, unfrozen copy for persisting into a match.
export function snapshotRules(version = CURRENT_BOOST_V2_RULES_VERSION) {
  return JSON.parse(JSON.stringify(getRules(version)));
}

export function isBoostV2(state) {
  return state?.ruleset === RULESET.BOOST_V2;
}

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}
