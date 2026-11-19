import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DECK_0_1, DECK_0_2, DECK_0_3, DECK_COMPOSITION_0_1, DECK_COMPOSITION_0_2, getDeck } from './deckManifest.js';
import { CURRENT_BOOST_V2_RULES_VERSION } from './rulesConfig.js';
import { generateQueue, peek, preview, advance, remainingCount } from './challengeQueue.js';
import { isValidDefinition, FAMILY, ALL_FAMILIES } from './challengeCatalog.js';
import { EXCLUDED_TARGET_LETTERS, getRules } from './rulesConfig.js';
import { createRng } from '../../util/rng.js';

const defOf = (e) => DECK_0_1.definitions[e.definitionId];

test('deck: exactly 100 cards with unique instance ids', () => {
  assert.equal(DECK_0_1.cards.length, 100);
  assert.equal(new Set(DECK_0_1.cards.map(c => c.instanceId)).size, 100);
});

test('deck: family × difficulty counts match the composition table; 45/35/20', () => {
  const counts = {};
  const byDiff = { EASY: 0, MEDIUM: 0, HARD: 0 };
  for (const c of DECK_0_1.cards) {
    const d = defOf(c);
    counts[d.family] ??= [0, 0, 0];
    counts[d.family][['EASY', 'MEDIUM', 'HARD'].indexOf(d.difficulty)]++;
    byDiff[d.difficulty]++;
  }
  for (const [f, exp] of Object.entries(DECK_COMPOSITION_0_1)) {
    assert.deepEqual(counts[f] ?? [0, 0, 0], exp, f);
  }
  assert.deepEqual(byDiff, { EASY: 45, MEDIUM: 35, HARD: 20 });
});

test('deck: only the nine supported families, valid definitions, rewards from rules', () => {
  const rules = getRules(DECK_0_1.rulesVersion);
  for (const c of DECK_0_1.cards) {
    const d = defOf(c);
    assert.ok(ALL_FAMILIES.includes(d.family));
    assert.ok(isValidDefinition(d), d.definitionId);
    assert.equal(d.reward, rules.rewards[d.difficulty]);
  }
});

test('deck: no excluded target letters; every Bridge fallback resolves to a HARD Long Word 8+', () => {
  for (const c of DECK_0_1.cards) {
    const d = defOf(c);
    if (d.parameters.targetLetter) assert.ok(!EXCLUDED_TARGET_LETTERS.includes(d.parameters.targetLetter));
    if (d.family === FAMILY.BRIDGE_BUILDER) {
      const fb = DECK_0_1.definitions[d.fallbackDefinitionId];
      assert.equal(fb.family, FAMILY.LONG_WORD);
      assert.equal(fb.difficulty, 'HARD');
      assert.equal(fb.parameters.minimumLength, 8);
      assert.equal(fb.reward, 20);
    }
  }
});

test('deck: manifest is frozen', () => {
  assert.ok(Object.isFrozen(DECK_0_1));
  assert.ok(Object.isFrozen(DECK_0_1.cards[0]));
  assert.throws(() => getDeck('nope'));
});

test('queue: one Easy, one Medium, one non-Bridge Hard in the first three', () => {
  for (let s = 0; s < 200; s++) {
    const q = generateQueue(DECK_0_1, createRng(`q${s}`));
    const head = q.entries.slice(0, 3).map(defOf);
    assert.deepEqual(head.map(d => d.difficulty).sort(), ['EASY', 'HARD', 'MEDIUM']);
    assert.ok(head.every(d => d.family !== FAMILY.BRIDGE_BUILDER));
  }
});

test('queue: a permutation of the deck — 100 entries, unique ids, cursor 0', () => {
  const q = generateQueue(DECK_0_1, createRng('perm'));
  assert.equal(q.entries.length, 100);
  assert.equal(q.cursor, 0);
  assert.equal(q.deckVersion, DECK_0_1.deckVersion);
  assert.deepEqual(q.entries.map(e => e.instanceId).sort(), DECK_0_1.cards.map(c => c.instanceId).sort());
  for (const e of q.entries) {
    const card = DECK_0_1.cards.find(c => c.instanceId === e.instanceId);
    assert.equal(e.definitionId, card.definitionId, 'parameters never re-randomised');
  }
});

test('queue: deterministic under a controlled seed, different across seeds', () => {
  const a = generateQueue(DECK_0_1, createRng('same'));
  const b = generateQueue(DECK_0_1, createRng('same'));
  const c = generateQueue(DECK_0_1, createRng('other'));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.entries, c.entries);
});

test('queue: FIFO peek / preview / advance; cursor never moves backward or past the end', () => {
  const q = generateQueue(DECK_0_1, createRng('fifo'));
  assert.deepEqual(preview(q, 2), q.entries.slice(0, 2));
  const first3 = peek(q, 3);
  advance(q, 3);
  assert.deepEqual(preview(q, 2), q.entries.slice(3, 5));
  assert.deepEqual(first3, q.entries.slice(0, 3));
  assert.deepEqual(preview(q, 2, 1), q.entries.slice(4, 6));
  assert.throws(() => advance(q, -1));
  assert.equal(remainingCount(q), 97);
});

test('queue: deck exhaustion is graceful', () => {
  const q = generateQueue(DECK_0_1, createRng('end'));
  advance(q, 99);
  assert.equal(peek(q, 3).length, 1);
  assert.equal(preview(q, 2).length, 1);
  advance(q, 1);
  assert.deepEqual(peek(q, 3), []);
  assert.throws(() => advance(q, 1));
});

test('deck 0.3 (current): same 95 cards as 0.2, Bridge Builder without fallback', () => {
  assert.equal(getRules(CURRENT_BOOST_V2_RULES_VERSION).deckVersion, DECK_0_3.deckVersion);
  assert.equal(getRules(CURRENT_BOOST_V2_RULES_VERSION).bridgeFallback, undefined);
  assert.deepEqual(DECK_0_3.cards.map(c => c.definitionId), DECK_0_2.cards.map(c => c.definitionId));
  for (const c of DECK_0_3.cards) {
    const d = DECK_0_3.definitions[c.definitionId];
    if (d.family === FAMILY.BRIDGE_BUILDER) assert.equal(d.fallbackDefinitionId, undefined);
  }
  assert.equal(Object.keys(DECK_0_3.definitions).includes('BST-002:HARD:8'), true, 'Hard Long Word cards still exist');
});

test('deck 0.2: Power Word EASY removed → 95 cards, 40/35/20, otherwise identical to 0.1', () => {
  assert.equal(DECK_0_2.cards.length, 95);
  const byDiff = { EASY: 0, MEDIUM: 0, HARD: 0 };
  for (const c of DECK_0_2.cards) {
    const d = DECK_0_2.definitions[c.definitionId];
    byDiff[d.difficulty]++;
    assert.ok(!(d.family === FAMILY.POWER_WORD && d.difficulty === 'EASY'));
    assert.ok(isValidDefinition(d));
  }
  assert.deepEqual(byDiff, { EASY: 40, MEDIUM: 35, HARD: 20 });
  assert.deepEqual(DECK_COMPOSITION_0_2.POWER_WORD, [0, 5, 2]);
  const q = generateQueue(DECK_0_2, createRng('d2'));
  assert.equal(q.entries.length, 95);
  assert.deepEqual(q.entries.slice(0, 3).map(e => DECK_0_2.definitions[e.definitionId].difficulty).sort(), ['EASY', 'HARD', 'MEDIUM']);
});
