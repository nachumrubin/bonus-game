// Run with:  node --test src/game/core/hebrewDictionary.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DICT,
  addWordsFromText,
  norm,
  terminalFinalVariants,
  dictHas,
  candidateLemmas,
  analyze,
  isValid,
  setValidationLogger,
  spellingVariants,
} from './hebrewDictionary.js';

test('norm folds final-form letters to base forms', () => {
  assert.equal(norm('שלוםך'), 'שלומכ');
  assert.equal(norm('כלב'), 'כלב');
  assert.equal(norm('דרך'), 'דרכ');
  assert.equal(norm('עץ'), 'עצ');
});

test('terminalFinalVariants yields the word plus its final-form variant when applicable', () => {
  assert.deepEqual([...terminalFinalVariants('שלומ')], ['שלומ', 'שלום']);
  assert.deepEqual([...terminalFinalVariants('דרכ')], ['דרכ', 'דרך']);
  // No final-form mapping for the last char → only the original
  assert.deepEqual([...terminalFinalVariants('כלב')], ['כלב']);
  assert.deepEqual([...terminalFinalVariants('')], []);
});

test('dictHas accepts both base and final-form variants', () => {
  DICT.clear();
  addWordsFromText('שלום\nדרך\nכלב\n');
  assert.equal(dictHas('שלום'), true);
  assert.equal(dictHas('שלומ'), true);    // final-form fold should match
  assert.equal(dictHas('דרך'), true);
  assert.equal(dictHas('דרכ'), true);
  assert.equal(dictHas('כלב'), true);
  assert.equal(dictHas('פיל'), false);
});

test('candidateLemmas yields the original word first', () => {
  const cands = [...candidateLemmas('כלבים')];
  assert.equal(cands[0], 'כלבים');
});

test('candidateLemmas strips ים plural to give the singular stem', () => {
  const cands = [...candidateLemmas('כלבים')];
  assert.ok(cands.includes('כלב'), `expected 'כלב' in ${cands.join(', ')}`);
  // also yields the +"ה" variant for feminine forms
  assert.ok(cands.includes('כלבה'));
});

test('candidateLemmas strips ות plural', () => {
  const cands = [...candidateLemmas('שולחנות')];
  assert.ok(cands.includes('שולחנ'), `expected 'שולחנ' in ${cands.join(', ')}`);
});

test('analyze returns invalid for empty input', () => {
  DICT.clear();
  const r = analyze('');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'empty');
});

test('analyze returns valid with reason "exact-match" for a known word', () => {
  DICT.clear();
  addWordsFromText('שלום\n');
  const r = analyze('שלום');
  assert.equal(r.valid, true);
  assert.equal(r.lemma, 'שלום');
  assert.equal(r.reason, 'exact-match');
});

test('analyze handles board-style words without final forms via dictHas', () => {
  DICT.clear();
  addWordsFromText('שלום\n');
  const r = analyze('שלומ'); // board has no final-mem
  assert.equal(r.valid, true);
  assert.equal(r.reason, 'exact-match');
});

test('analyze rejects non-Hebrew input', () => {
  DICT.clear();
  addWordsFromText('שלום\n');
  // Latin chars get filtered by the [א-ת] gate; the remaining word may match
  const r = analyze('hello');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'empty');
});

test('isValid is silent by default and can use a configurable logger', () => {
  DICT.clear();
  addWordsFromText('אב\n');

  const logs = [];
  setValidationLogger(null);
  assert.equal(isValid('אב'), true);
  assert.deepEqual(logs, []);

  setValidationLogger((...args) => logs.push(args));
  assert.equal(isValid('גד'), false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], '[isValid]');
  setValidationLogger(null);
});

test('isValid accepts exact dictionary words even when HebrewValidator rejects them', () => {
  DICT.clear();
  addWordsFromText('מפורשת\n');

  const previousValidator = globalThis.HebrewValidator;
  try {
    globalThis.HebrewValidator = {
      ready: true,
      validate: () => ({ valid: false, reason: 'stub-reject' }),
    };

    assert.equal(isValid('מפורשת'), true);
  } finally {
    if (previousValidator) globalThis.HebrewValidator = previousValidator;
    else delete globalThis.HebrewValidator;
  }
});

test('base dictionary contains the playable word מפורשת', async () => {
  const fs = await import('node:fs/promises');
  const text = await fs.readFile('data/dictionary.base.txt', 'utf8');
  DICT.clear();
  addWordsFromText(text);

  assert.equal(DICT.has('מפורשת'), true);
  assert.equal(isValid('מפורשת'), true);
});

test('spellingVariants generates ktiv-haser variants by stripping interior ו/י', () => {
  const variants = [...spellingVariants('כיסא')];
  assert.ok(variants.includes('כיסא'));
  assert.ok(variants.includes('כסא'), `expected 'כסא' in ${variants.join(', ')}`);
});

test('spellingVariants generates ktiv-male variants by inserting interior ו/י', () => {
  const variants = [...spellingVariants('כסא')];
  assert.ok(variants.includes('כיסא'), `expected 'כיסא' in ${variants.join(', ')}`);
});
