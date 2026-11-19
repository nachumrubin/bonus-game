import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateBoost, evaluateMoveBoosts, wordSatisfies, wordId } from './challengeEvaluator.js';
import {
  letterHunt, longWord, tileMaster, doubleLetter, uniqueLetters, wordEdge, bridgeBuilder, powerWord, exactTarget,
  isValidDefinition, FAMILY,
} from './challengeCatalog.js';
import { RULES, hw, vw, placedOf } from './testHelpers.js';

const boostAt = (r, c, id = 'b1') => ({ instanceId: id, r, c });
function evalOne(definition, words, boost, placed = placedOf(...words), activeAtStart = [boost]) {
  return evaluateBoost({ boost: { ...boost, effectiveDefinitionId: definition.definitionId }, definition, words, placed, activeAtStart });
}

// ── BST-001 Letter Hunt (TILE) ──────────────────────────────────────────────
test('Letter Hunt: tile on the Boost square is the target → completed', () => {
  const w = hw(4, 3, 'שלום');
  const r = evalOne(letterHunt(RULES, 'EASY', 'ל'), [w], boostAt(4, 4));
  assert.equal(r.consumed, true);
  assert.equal(r.completed, true);
  assert.equal(r.reward, 5);
});
test('Letter Hunt: target elsewhere in the word does not count (TILE scope)', () => {
  const r = evalOne(letterHunt(RULES, 'EASY', 'מ'), [hw(4, 3, 'שלום')], boostAt(4, 4));
  assert.equal(r.consumed, true);
  assert.equal(r.completed, false);
  assert.equal(r.reward, 0);
});
test('Letter Hunt: final form equals standard form', () => {
  const r = evalOne(letterHunt(RULES, 'EASY', 'מ'), [hw(4, 3, 'שלום')], boostAt(4, 6));
  assert.equal(r.completed, true);
});
test('Letter Hunt: joker representing the target qualifies', () => {
  const r = evalOne(letterHunt(RULES, 'HARD', 'ג'), [hw(4, 3, 'ש*גם')], boostAt(4, 4));
  assert.equal(r.completed, true);
  assert.equal(r.reward, 20);
});
test('Letter Hunt: Boost square not covered by a new tile → not consumed', () => {
  const w = hw(4, 3, 'שלום', [0, 1]); // ו, ם already on the board
  const r = evalOne(letterHunt(RULES, 'EASY', 'מ'), [w], boostAt(4, 6));
  assert.equal(r.consumed, false);
  assert.equal(r.completed, false);
});
test('Letter Hunt: excluded letters cannot be targets', () => {
  for (const l of ['א', 'ה', 'ו', 'י']) assert.throws(() => letterHunt(RULES, 'EASY', l));
});

// ── BST-002 Long Word (WORD) ────────────────────────────────────────────────
test('Long Word: exact threshold / below / above', () => {
  const d = longWord(RULES, 'EASY'); // ≥ 4
  assert.equal(evalOne(d, [hw(4, 3, 'שלום')], boostAt(4, 3)).completed, true);
  assert.equal(evalOne(d, [hw(4, 3, 'שלו')], boostAt(4, 3)).completed, false);
  assert.equal(evalOne(d, [hw(4, 3, 'שלומי')], boostAt(4, 3)).completed, true);
});
test('Long Word: existing tiles count toward length', () => {
  const w = hw(4, 3, 'שלום', [3]); // only ם is new
  const r = evalOne(longWord(RULES, 'EASY'), [w], boostAt(4, 6));
  assert.equal(r.completed, true);
});
test('Long Word: a cross-word containing the Boost satisfies it', () => {
  // Main word: new tiles at (5,3)(5,4); cross word through (5,3) vertically.
  const mainW = hw(5, 3, 'אב');
  const crossW = vw(2, 3, 'שלוא', [3]);
  const r = evalOne(longWord(RULES, 'EASY'), [mainW, crossW], boostAt(5, 3));
  assert.equal(r.completed, true);
  assert.deepEqual(r.qualifyingWordIds, [wordId(crossW)]);
});
test('Long Word: an unrelated long word elsewhere never qualifies', () => {
  const shortW = hw(5, 3, 'אב');           // contains the Boost at (5,4)
  const longW = vw(0, 3, 'שלומא', [4]);    // through (4,3)... does not contain (5,4)
  const r = evalOne(longWord(RULES, 'EASY'), [shortW, longW], boostAt(5, 4));
  assert.equal(r.consumed, true);
  assert.equal(r.completed, false);
});
test('Long Word: multiple qualifying words award the reward once', () => {
  const a = hw(4, 3, 'שלום');
  const b = vw(4, 3, 'שלום', [1, 2, 3]).map((t, i) => (i === 0 ? { ...t, ex: false } : t));
  const r = evalOne(longWord(RULES, 'EASY'), [a, b], boostAt(4, 3));
  assert.equal(r.qualifyingWordIds.length, 2);
  assert.equal(r.reward, 5);
});
test('Long Word: joker counts as one letter', () => {
  assert.equal(evalOne(longWord(RULES, 'EASY'), [hw(4, 3, 'של*ום')], boostAt(4, 3)).completed, true);
});

// ── BST-003 Tile Master (MOVE) ──────────────────────────────────────────────
test('Tile Master: counts newly placed tiles only, threshold inclusive', () => {
  const d = tileMaster(RULES, 'EASY'); // ≥ 3 new
  assert.equal(evalOne(d, [hw(4, 3, 'שלום', [0, 1, 2])], boostAt(4, 3)).completed, true);
  assert.equal(evalOne(d, [hw(4, 3, 'שלום', [0, 1])], boostAt(4, 3)).completed, false);
  assert.equal(evalOne(d, [hw(4, 3, 'שלום')], boostAt(4, 3)).completed, true);
});
test('Tile Master: Boost square must receive a new tile', () => {
  const r = evalOne(tileMaster(RULES, 'EASY'), [hw(4, 3, 'שלום', [0, 1, 2])], boostAt(4, 6));
  assert.equal(r.consumed, false);
});
test('Tile Master: a new joker counts as a tile', () => {
  assert.equal(evalOne(tileMaster(RULES, 'EASY'), [hw(4, 3, '*שלו')], boostAt(4, 3)).completed, true);
});

// ── BST-004 Double Letter (WORD) ────────────────────────────────────────────
test('Double Letter: spec examples', () => {
  const E = doubleLetter(RULES, 'EASY'), M = doubleLetter(RULES, 'MEDIUM'), H = doubleLetter(RULES, 'HARD');
  const w = (s) => hw(4, 2, s);
  assert.equal(wordSatisfies(E, w('אבא')), true);
  assert.equal(wordSatisfies(M, w('אבא')), false);
  assert.equal(wordSatisfies(H, w('אבא')), false);
  assert.equal(wordSatisfies(E, w('גלגל')), true);
  assert.equal(wordSatisfies(M, w('גלגל')), false);
  assert.equal(wordSatisfies(H, w('גלגל')), true);
  assert.equal(wordSatisfies(E, w('בקבוק')), true);
  assert.equal(wordSatisfies(M, w('בקבוק')), true);
  assert.equal(wordSatisfies(H, w('בקבוק')), true);
  assert.equal(wordSatisfies(E, w('שלום')), false);
});
test('Double Letter: final forms are normalised before counting', () => {
  assert.equal(wordSatisfies(doubleLetter(RULES, 'EASY'), hw(4, 2, 'מים')), true);
});
test('Double Letter: joker uses its represented letter', () => {
  assert.equal(wordSatisfies(doubleLetter(RULES, 'EASY'), hw(4, 2, 'אב*א')), true);
});

// ── BST-005 Unique Letters (WORD) ───────────────────────────────────────────
test('Unique Letters: length threshold and uniqueness', () => {
  const E = uniqueLetters(RULES, 'EASY'); // ≥ 4, all unique
  assert.equal(wordSatisfies(E, hw(0, 0, 'שלום')), true);
  assert.equal(wordSatisfies(E, hw(0, 0, 'שלו')), false);
  assert.equal(wordSatisfies(E, hw(0, 0, 'גלגל')), false);
  assert.equal(wordSatisfies(uniqueLetters(RULES, 'MEDIUM'), hw(0, 0, 'שלום')), false);
});
test('Unique Letters: מ and ם count as the same letter', () => {
  assert.equal(wordSatisfies(uniqueLetters(RULES, 'EASY'), hw(0, 0, 'מקום')), false);
});

// ── BST-006 Word Edge (WORD) ────────────────────────────────────────────────
test('Word Edge: START / END in logical reading order, finals normalised', () => {
  assert.equal(wordSatisfies(wordEdge(RULES, 'EASY', 'ש', 'START'), hw(4, 3, 'שלום')), true);
  assert.equal(wordSatisfies(wordEdge(RULES, 'EASY', 'מ', 'END'), hw(4, 3, 'שלום')), true);
  assert.equal(wordSatisfies(wordEdge(RULES, 'EASY', 'ש', 'END'), hw(4, 3, 'שלום')), false);
  assert.equal(wordSatisfies(wordEdge(RULES, 'EASY', 'ש', 'START'), vw(1, 3, 'שלום')), true);
});
test('Word Edge: existing letter may satisfy the position; Boost tile need not be the letter', () => {
  const w = hw(4, 3, 'שלום', [3]); // ש is existing; Boost on new ם
  const r = evalOne(wordEdge(RULES, 'EASY', 'ש', 'START'), [w], boostAt(4, 6));
  assert.equal(r.completed, true);
});
test('Word Edge: invalid position / excluded letter rejected at construction', () => {
  assert.throws(() => wordEdge(RULES, 'EASY', 'ש', 'MIDDLE'));
  assert.throws(() => wordEdge(RULES, 'EASY', 'ה', 'START'));
});

// ── BST-007 Bridge Builder (WORD) ───────────────────────────────────────────
test('Bridge Builder: one word covers this and another active Boost → both evaluated', () => {
  const bridge = bridgeBuilder(RULES);
  const other = longWord(RULES, 'EASY');
  const defs = { [bridge.definitionId]: bridge, [other.definitionId]: other };
  const active = [
    { instanceId: 'b1', r: 4, c: 3, effectiveDefinitionId: bridge.definitionId },
    { instanceId: 'b2', r: 4, c: 6, effectiveDefinitionId: other.definitionId },
  ];
  const w = hw(4, 3, 'שלום');
  const res = evaluateMoveBoosts({ activeBoosts: active, definitions: defs, words: [w], placed: placedOf(w) });
  assert.equal(res.length, 2);
  assert.equal(res[0].completed, true);
  assert.equal(res[0].reward, 20);
  assert.equal(res[1].completed, true);
});
test('Bridge Builder: other Boost fails but Bridge still succeeds', () => {
  const bridge = bridgeBuilder(RULES);
  const other = letterHunt(RULES, 'EASY', 'ר');
  const defs = { [bridge.definitionId]: bridge, [other.definitionId]: other };
  const active = [
    { instanceId: 'b1', r: 4, c: 3, effectiveDefinitionId: bridge.definitionId },
    { instanceId: 'b2', r: 4, c: 6, effectiveDefinitionId: other.definitionId },
  ];
  const w = hw(4, 3, 'שלום');
  const [b, o] = evaluateMoveBoosts({ activeBoosts: active, definitions: defs, words: [w], placed: placedOf(w) });
  assert.equal(b.completed, true);
  assert.equal(o.consumed, true);
  assert.equal(o.completed, false);
});
test('Bridge Builder: two Bridges in the same word both succeed', () => {
  const bridge = bridgeBuilder(RULES);
  const defs = { [bridge.definitionId]: bridge };
  const active = [
    { instanceId: 'b1', r: 4, c: 3, effectiveDefinitionId: bridge.definitionId },
    { instanceId: 'b2', r: 4, c: 5, effectiveDefinitionId: bridge.definitionId },
  ];
  const w = hw(4, 3, 'שלום');
  const res = evaluateMoveBoosts({ activeBoosts: active, definitions: defs, words: [w], placed: placedOf(w) });
  assert.deepEqual(res.map(r => r.completed), [true, true]);
  assert.equal(res.reduce((s, r) => s + r.reward, 0), 40);
});
test('Bridge Builder: Boosts covered by different words → Bridge fails', () => {
  const bridge = bridgeBuilder(RULES);
  const other = longWord(RULES, 'EASY');
  const defs = { [bridge.definitionId]: bridge, [other.definitionId]: other };
  // Main word horizontal at row 5 covering (5,3); cross word vertical through (5,4) covering (3,4)?
  const main = hw(5, 3, 'אב');
  const cross = vw(3, 4, 'שלב', [2]).map((t, i) => (i === 2 ? { ...t, ex: false } : t));
  const placed = placedOf(main);
  const active = [
    { instanceId: 'b1', r: 5, c: 3, effectiveDefinitionId: bridge.definitionId },
    { instanceId: 'b2', r: 3, c: 4, effectiveDefinitionId: other.definitionId }, // existing tile row → not covered
  ];
  const res = evaluateMoveBoosts({ activeBoosts: active, definitions: defs, words: [main, cross], placed });
  assert.equal(res.length, 1);
  assert.equal(res[0].completed, false);
});
test('Bridge Builder: a Boost not active at the start of the move does not count', () => {
  const bridge = bridgeBuilder(RULES);
  const w = hw(4, 3, 'שלום');
  const r = evaluateBoost({
    boost: { instanceId: 'b1', r: 4, c: 3, effectiveDefinitionId: bridge.definitionId },
    definition: bridge, words: [w], placed: placedOf(w),
    activeAtStart: [{ instanceId: 'b1', r: 4, c: 3 }],
  });
  assert.equal(r.completed, false);
});

// ── BST-008 Power Word (WORD) ───────────────────────────────────────────────
test('Power Word: single-word base score, threshold inclusive', () => {
  const E = powerWord(RULES, 'EASY'); // ≥ 8
  assert.equal(wordSatisfies(E, hw(0, 0, 'שלום')), true);  // 3+2+1+2 = 8 (ם valued as מ)
  assert.equal(wordSatisfies(E, hw(0, 0, 'אבא')), false);  // 5
  assert.equal(wordSatisfies(E, hw(0, 0, 'צבא')), true);   // 13
});
test('Power Word: joker uses its existing 0 value', () => {
  assert.equal(wordSatisfies(powerWord(RULES, 'EASY'), hw(0, 0, '*שלום')), false); // 0+2+1+2
});
test('Power Word: other words do not add to the qualifying word', () => {
  const small = hw(5, 3, 'אב');            // 4 points, contains Boost
  const big = vw(0, 6, 'צצצצצ', [4]);      // unrelated
  const r = evalOne(powerWord(RULES, 'EASY'), [small, big], boostAt(5, 3));
  assert.equal(r.completed, false);
});

// ── BST-009 Exact Target (WORD) ─────────────────────────────────────────────
test('Exact Target: exact length only', () => {
  const E = exactTarget(RULES, 'EASY'); // = 4
  assert.equal(wordSatisfies(E, hw(0, 0, 'שלום')), true);
  assert.equal(wordSatisfies(E, hw(0, 0, 'שלו')), false);
  assert.equal(wordSatisfies(E, hw(0, 0, 'שלומי')), false);
});
test('Exact Target: another resulting word through the Boost with the exact length succeeds', () => {
  const main = hw(4, 3, 'שלומי');
  const cross = vw(4, 3, 'שלום', [1, 2, 3]).map((t, i) => (i === 0 ? { ...t, ex: false } : t));
  const r = evalOne(exactTarget(RULES, 'EASY'), [main, cross], boostAt(4, 3), placedOf(main));
  assert.equal(r.completed, true);
  assert.deepEqual(r.qualifyingWordIds, [wordId(cross)]);
});

test('every family constructor yields a valid definition with the configured reward', () => {
  const defs = [
    letterHunt(RULES, 'MEDIUM', 'ש'), longWord(RULES, 'HARD'), tileMaster(RULES, 'MEDIUM'),
    doubleLetter(RULES, 'MEDIUM'), uniqueLetters(RULES, 'HARD'), wordEdge(RULES, 'MEDIUM', 'ל', 'END'),
    bridgeBuilder(RULES), powerWord(RULES, 'MEDIUM'), exactTarget(RULES, 'HARD'),
  ];
  for (const d of defs) {
    assert.ok(isValidDefinition(d), d.definitionId);
    assert.equal(d.reward, RULES.rewards[d.difficulty]);
  }
  assert.equal(new Set(defs.map(d => d.family)).size, Object.keys(FAMILY).length);
});

test('evaluation is deterministic and does not mutate its input', () => {
  const w = hw(4, 3, 'שלום');
  const snap = JSON.stringify(w);
  const d = longWord(RULES, 'EASY');
  const a = evalOne(d, [w], boostAt(4, 3));
  const b = evalOne(d, [w], boostAt(4, 3));
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(w), snap);
});
