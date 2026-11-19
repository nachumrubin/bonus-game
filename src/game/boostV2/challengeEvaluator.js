// Boost 2.0 — pure challenge evaluator (spec §10, §11, §12, §25).
//
// Deterministic and side-effect free. Input is the already-validated move:
// the words getAllWords() produced (tile arrays in logical reading order,
// each tile { r, c, letter, val, ex }) and the newly placed tiles. Nothing
// here reads the dictionary, the rack, the queue or any UI state.
//
// Scopes:
//   TILE — the tile placed on the Boost square        (Letter Hunt)
//   WORD — any resulting word containing the square   (seven families)
//   MOVE — the whole placement action                 (Tile Master)
// For every scope the Boost square must be covered by a newly placed tile
// (that is what "consumed" means); an unrelated word never qualifies.
//
// Jokers (spec §12): a placed joker carries the letter it represents in
// `letter` and its existing point value (0) in `val`, so every family uses
// the represented letter / counts it as one letter / one new tile.

import { FAMILY, SCOPE, EDGE_POSITION } from './challengeCatalog.js';
import { normalizeLetter, wordLetters, letterCounts } from './hebrew.js';

// Stable id for a resulting word: orientation + start/end coordinates
// (spec §6.1 — distinct by coordinates and orientation, not text).
export function wordId(tiles) {
  const a = tiles[0], b = tiles[tiles.length - 1];
  const o = tiles.length > 1 && a.r === b.r ? 'H' : 'V';
  return `${o}:${a.r},${a.c}-${b.r},${b.c}`;
}

export function wordBaseScore(tiles) {
  let s = 0;
  for (const t of tiles) s += Number(t.val) || 0;
  return s;
}

const containsSquare = (tiles, r, c) => tiles.some(t => t.r === r && t.c === c);

// Word-level predicate per family. Returns true when `tiles` satisfies the
// definition's own configured condition (and only that condition).
export function wordSatisfies(definition, tiles) {
  const p = definition.parameters ?? {};
  const letters = wordLetters(tiles);
  const n = letters.length;
  switch (definition.family) {
    case FAMILY.LONG_WORD:
      return n >= p.minimumLength;
    case FAMILY.EXACT_TARGET:
      return n === p.exactLength;
    case FAMILY.POWER_WORD:
      return wordBaseScore(tiles) >= p.minimumBaseScore;
    case FAMILY.DOUBLE_LETTER: {
      if (n < p.minWordLength) return false;
      const repeated = [...letterCounts(letters).values()].filter(v => v >= 2).length;
      return repeated >= p.minRepeatedLetters;
    }
    case FAMILY.UNIQUE_LETTERS:
      return n >= p.minimumLength && letterCounts(letters).size === n;
    case FAMILY.WORD_EDGE: {
      const target = normalizeLetter(p.targetLetter);
      const edge = p.position === EDGE_POSITION.START ? letters[0] : letters[n - 1];
      return edge === target;
    }
    default:
      return false;
  }
}

/**
 * Evaluate one consumed Boost.
 * @param {object} args
 * @param {{instanceId:string, r:number, c:number, effectiveDefinitionId:string}} args.boost
 * @param {object} args.definition  the boost's effective ChallengeDefinition
 * @param {Array<Array<object>>} args.words  resulting words (getAllWords output)
 * @param {Array<object>} args.placed  newly placed tiles
 * @param {Array<{instanceId:string, r:number, c:number}>} args.activeAtStart
 *        every Boost active at the beginning of the move (Bridge Builder)
 * @returns {{instanceId, definitionId, family, difficulty, consumed, completed, reward, qualifyingWordIds}}
 */
export function evaluateBoost({ boost, definition, words, placed, activeAtStart = [] }) {
  const base = {
    instanceId: boost.instanceId,
    definitionId: definition.definitionId,
    family: definition.family,
    difficulty: definition.difficulty,
    consumed: false,
    completed: false,
    reward: 0,
    qualifyingWordIds: [],
  };
  const tile = placed.find(t => t.r === boost.r && t.c === boost.c);
  if (!tile) return base; // not covered by a new tile → not consumed
  base.consumed = true;

  const boostWords = words.filter(w => containsSquare(w, boost.r, boost.c));
  let qualifying = [];
  let completed = false;

  switch (definition.evaluationScope) {
    case SCOPE.TILE: {
      // Letter Hunt — the tile on the square represents the target letter.
      completed = normalizeLetter(tile.letter) === normalizeLetter(definition.parameters.targetLetter);
      break;
    }
    case SCOPE.MOVE: {
      // Tile Master — count newly placed tiles (a joker is one tile).
      completed = placed.length >= definition.parameters.minimumNewTiles;
      break;
    }
    case SCOPE.WORD: {
      if (definition.family === FAMILY.BRIDGE_BUILDER) {
        const others = activeAtStart.filter(b => b.instanceId !== boost.instanceId);
        qualifying = boostWords.filter(w => others.some(o => containsSquare(w, o.r, o.c)));
      } else {
        qualifying = boostWords.filter(w => wordSatisfies(definition, w));
      }
      completed = qualifying.length > 0;
      break;
    }
    default:
      completed = false;
  }

  base.completed = completed;
  // One reward per Boost, however many words qualify (spec §8).
  base.reward = completed ? definition.reward : 0;
  base.qualifyingWordIds = qualifying.map(wordId);
  return base;
}

/**
 * Evaluate every Boost the move consumes. `activeBoosts` are those active at
 * the start of the move; `definitions` maps definitionId → definition.
 */
export function evaluateMoveBoosts({ activeBoosts, definitions, words, placed }) {
  const results = [];
  for (const boost of activeBoosts) {
    if (!placed.some(t => t.r === boost.r && t.c === boost.c)) continue;
    const definition = definitions[boost.effectiveDefinitionId];
    if (!definition) throw new Error(`missing definition ${boost.effectiveDefinitionId}`);
    results.push(evaluateBoost({ boost, definition, words, placed, activeAtStart: activeBoosts }));
  }
  return results;
}
