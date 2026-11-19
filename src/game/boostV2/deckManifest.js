// Boost 2.0 — versioned deck manifests (spec §14). Current: 0.3 (95 cards).
//
// STATUS: CANDIDATE — generated for product-owner review, not frozen for
// production (spec §14 "Generate a candidate fixed deck for review before
// freezing"). The Letter Hunt / Word Edge target letters come from the
// offline analysis (scripts/boostV2/analyze-dictionary.mjs →
// docs-md/boost-v2/ANALYSIS.md); the bands are copied here as data so the
// deck never changes when the dictionary does.
//
// Each card has a stable id (c001…c100) — the same numbering a physical
// edition would print. Cards are listed in manifest order; the match queue
// shuffles them (challengeQueue.generateQueue). Card parameters are fixed
// here and never re-randomised after shuffling (spec §14).
//
// Never edit a published manifest in place: add a new version and register
// it in DECK_REGISTRY. Matches reference their deckVersion and also persist
// the definitions they use, so an old match keeps evaluating identically.

import { DIFFICULTY } from './rulesConfig.js';
import { getRules } from './rulesConfig.js';
import {
  FAMILY, EDGE_POSITION, letterHunt, longWord, tileMaster, doubleLetter, uniqueLetters,
  wordEdge, bridgeBuilder, powerWord, exactTarget, isValidDefinition,
} from './challengeCatalog.js';

const { EASY, MEDIUM, HARD } = DIFFICULTY;
const { START, END } = EDGE_POSITION;

// Composition table (spec §14). Order: [EASY, MEDIUM, HARD].
export const DECK_COMPOSITION_0_1 = Object.freeze({
  LETTER_HUNT:    [8, 5, 2],
  LONG_WORD:      [7, 5, 2],
  TILE_MASTER:    [5, 5, 2],
  DOUBLE_LETTER:  [5, 3, 2],
  UNIQUE_LETTERS: [5, 3, 2],
  WORD_EDGE:      [7, 5, 3],
  BRIDGE_BUILDER: [0, 0, 3],
  POWER_WORD:     [5, 5, 2],
  EXACT_TARGET:   [3, 4, 2],
});

// Target letter lists per difficulty (from ANALYSIS.md bands, in band order).
// Letter Hunt: banded by tile count in the bag (EASY ≥ 5, MEDIUM ≥ 3).
// Cards cycle through the band list in order.
export const LETTER_HUNT_TARGETS_0_1 = Object.freeze({
  EASY:   ['ל', 'נ', 'ר', 'מ'],
  MEDIUM: ['ש', 'ת', 'ב', 'ד', 'ח'],
  HARD:   ['ג', 'ס'],
});
// Word Edge: [letter, position], interleaving the START and END bands
// (banded by share of common words starting / ending with the letter).
export const WORD_EDGE_TARGETS_0_1 = Object.freeze({
  EASY:   [['מ', START], ['ת', END], ['ת', START], ['מ', END], ['נ', START], ['ר', END], ['ל', START]],
  MEDIUM: [['ש', START], ['ל', END], ['פ', START], ['ק', END], ['ח', START]],
  HARD:   [['ע', START], ['ח', END], ['ר', START]],
});

function buildDeck({ deckVersion, rulesVersion, composition, letterHuntTargets, wordEdgeTargets }) {
  const rules = getRules(rulesVersion);
  const levels = [EASY, MEDIUM, HARD];
  const definitions = {};
  const cards = [];
  const add = (d) => {
    if (!isValidDefinition(d)) throw new Error(`invalid definition ${d.definitionId}`);
    definitions[d.definitionId] = d;
    cards.push({ instanceId: `c${String(cards.length + 1).padStart(3, '0')}`, definitionId: d.definitionId });
  };
  for (const [family, counts] of Object.entries(composition)) {
    counts.forEach((count, li) => {
      const diff = levels[li];
      for (let i = 0; i < count; i++) {
        switch (family) {
          case FAMILY.LETTER_HUNT: {
            const ls = letterHuntTargets[diff];
            add(letterHunt(rules, diff, ls[i % ls.length]));
            break;
          }
          case FAMILY.WORD_EDGE: {
            const ts = wordEdgeTargets[diff];
            const [l, pos] = ts[i % ts.length];
            add(wordEdge(rules, diff, l, pos));
            break;
          }
          case FAMILY.LONG_WORD:      add(longWord(rules, diff)); break;
          case FAMILY.TILE_MASTER:    add(tileMaster(rules, diff)); break;
          case FAMILY.DOUBLE_LETTER:  add(doubleLetter(rules, diff)); break;
          case FAMILY.UNIQUE_LETTERS: add(uniqueLetters(rules, diff)); break;
          case FAMILY.POWER_WORD:     add(powerWord(rules, diff)); break;
          case FAMILY.EXACT_TARGET:   add(exactTarget(rules, diff)); break;
          case FAMILY.BRIDGE_BUILDER: {
            const b = bridgeBuilder(rules);
            if (rules.bridgeFallback) {   // 0.1 / 0.2 only
              const fb = longWord(rules, rules.bridgeFallback.difficulty, rules.bridgeFallback.minimumLength);
              definitions[fb.definitionId] = fb;
            }
            add(b);
            break;
          }
          default: throw new Error(`unknown family ${family}`);
        }
      }
    });
  }
  return deepFreeze({ deckVersion, rulesVersion, status: 'CANDIDATE', definitions, cards });
}

export const DECK_0_1 = buildDeck({
  deckVersion: 'boost-v2.deck.0.1-candidate',
  rulesVersion: 'boost-v2.rules.0.1-proto',
  composition: DECK_COMPOSITION_0_1,
  letterHuntTargets: LETTER_HUNT_TARGETS_0_1,
  wordEdgeTargets: WORD_EDGE_TARGETS_0_1,
});

// 0.2 — Power Word EASY removed (product decision, Nov 2026): 95 cards,
// 40 / 35 / 20. Whether to refill to 100 is open (see AUDIT).
export const DECK_COMPOSITION_0_2 = Object.freeze({ ...DECK_COMPOSITION_0_1, POWER_WORD: [0, 5, 2] });

export const DECK_0_2 = buildDeck({
  deckVersion: 'boost-v2.deck.0.2-candidate',
  rulesVersion: 'boost-v2.rules.0.2-proto',
  composition: DECK_COMPOSITION_0_2,
  letterHuntTargets: LETTER_HUNT_TARGETS_0_1,
  wordEdgeTargets: WORD_EDGE_TARGETS_0_1,
});

// 0.3 — same 95 cards as 0.2; Bridge Builder has no fallback (Nov 2026).
export const DECK_0_3 = buildDeck({
  deckVersion: 'boost-v2.deck.0.3-candidate',
  rulesVersion: 'boost-v2.rules.0.3-proto',
  composition: DECK_COMPOSITION_0_2,
  letterHuntTargets: LETTER_HUNT_TARGETS_0_1,
  wordEdgeTargets: WORD_EDGE_TARGETS_0_1,
});

export const DECK_REGISTRY = Object.freeze({
  [DECK_0_1.deckVersion]: DECK_0_1, [DECK_0_2.deckVersion]: DECK_0_2, [DECK_0_3.deckVersion]: DECK_0_3,
});

export function getDeck(version) {
  const d = DECK_REGISTRY[version];
  if (!d) throw new Error(`unknown Boost 2.0 deck version: ${version}`);
  return d;
}

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}
