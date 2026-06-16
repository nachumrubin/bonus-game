// Run with:  node --test src/game/core/hebrewDictionary.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DICT,
  norm,
  terminalFinalVariants,
  dictHas,
  candidateLemmas,
  isValid,
  setValidationLogger,
  spellingVariants,
  setDawgForTests,
  BLOCKED_OVERLAY,
} from './hebrewDictionary.js';
import { buildDawg, serializeDawg, parseDawg } from './dawg.js';

function dawgFromWords(words) {
  const sorted = [...new Set(words)].sort();
  return parseDawg(serializeDawg(buildDawg(sorted)));
}

function resetDawg() {
  setDawgForTests(null);
  DICT.clear();
}

test('norm folds final-form letters to base forms', () => {
  assert.equal(norm('שלוםך'), 'שלומכ');
  assert.equal(norm('כלב'), 'כלב');
  assert.equal(norm('דרך'), 'דרכ');
  assert.equal(norm('עץ'), 'עצ');
});

test('terminalFinalVariants yields the word plus its final-form variant when applicable', () => {
  assert.deepEqual([...terminalFinalVariants('שלומ')], ['שלומ', 'שלום']);
  assert.deepEqual([...terminalFinalVariants('דרכ')], ['דרכ', 'דרך']);
  assert.deepEqual([...terminalFinalVariants('כלב')], ['כלב']);
  assert.deepEqual([...terminalFinalVariants('')], []);
});

test('dictHas accepts both base and final-form variants', () => {
  DICT.clear();
  DICT.add('שלום'); DICT.add('דרך'); DICT.add('כלב');
  assert.equal(dictHas('שלום'), true);
  assert.equal(dictHas('שלומ'), true);
  assert.equal(dictHas('דרך'), true);
  assert.equal(dictHas('דרכ'), true);
  assert.equal(dictHas('כלב'), true);
  assert.equal(dictHas('פיל'), false);
  DICT.clear();
});

test('candidateLemmas yields the original word first', () => {
  const cands = [...candidateLemmas('כלבים')];
  assert.equal(cands[0], 'כלבים');
});

test('candidateLemmas strips ים plural to give the singular stem', () => {
  const cands = [...candidateLemmas('כלבים')];
  assert.ok(cands.includes('כלב'), `expected 'כלב' in ${cands.join(', ')}`);
  assert.ok(cands.includes('כלבה'));
});

test('candidateLemmas strips ות plural', () => {
  const cands = [...candidateLemmas('שולחנות')];
  assert.ok(cands.includes('שולחנ'), `expected 'שולחנ' in ${cands.join(', ')}`);
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

test('isValid: returns true for exact DAWG hit', () => {
  try {
    setDawgForTests(dawgFromWords(['שלום', 'בית', 'ילד']));
    assert.equal(isValid('שלום'), true);
    assert.equal(isValid('בית'), true);
    assert.equal(isValid('ילד'), true);
  } finally { resetDawg(); }
});

test('isValid: returns false for words not in DAWG (no morphology fallback)', () => {
  try {
    setDawgForTests(dawgFromWords(['הלך']));
    assert.equal(isValid('הלך'), true);
    assert.equal(isValid('הלכתי'), false, 'inflected form not in DAWG must reject');
    assert.equal(isValid('הולך'), false);
  } finally { resetDawg(); }
});

test('isValid: terminal final-form variants are accepted', () => {
  try {
    setDawgForTests(dawgFromWords(['שלום']));
    assert.equal(isValid('שלום'), true);
    assert.equal(isValid('שלומ'), true, 'medial-mem variant should match via final-form fold');
  } finally { resetDawg(); }
});

test('isValid: BLOCKED_OVERLAY rejects a word even when it is in the DAWG', () => {
  try {
    setDawgForTests(dawgFromWords(['שלום', 'בית']));
    assert.equal(isValid('בית'), true, 'in-DAWG word valid before blocking');
    BLOCKED_OVERLAY.add('בית');
    assert.equal(isValid('בית'), false, 'BLOCKED_OVERLAY must override a DAWG hit');
  } finally { BLOCKED_OVERLAY.delete('בית'); resetDawg(); }
});

test('isValid: Firebase-approved overlay (DICT.add after load) is honored', () => {
  try {
    setDawgForTests(dawgFromWords(['שלום']));
    assert.equal(isValid('מילהחדשה'), false, 'unseen word should reject before approval');
    DICT.add('מילהחדשה');
    assert.equal(isValid('מילהחדשה'), true, 'approved-overlay word must validate');
  } finally { resetDawg(); }
});

test('isValid: invalid input (non-Hebrew, empty) rejects', () => {
  try {
    setDawgForTests(dawgFromWords(['שלום']));
    assert.equal(isValid(''), false);
    assert.equal(isValid('   '), false);
    assert.equal(isValid('xyz'), false);
  } finally { resetDawg(); }
});

test('isValid: rejects when DAWG never loaded', () => {
  try {
    setDawgForTests(null);
    assert.equal(isValid('שלום'), false);
  } finally { resetDawg(); }
});

test('isValid: configurable logger records validations', () => {
  try {
    setDawgForTests(dawgFromWords(['אב']));
    const logs = [];
    setValidationLogger(null);
    assert.equal(isValid('אב'), true);
    assert.deepEqual(logs, []);

    setValidationLogger((...args) => logs.push(args));
    assert.equal(isValid('גד'), false);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[isValid]');
    setValidationLogger(null);
  } finally { resetDawg(); }
});

test('isValid: real bundled binary validates expected words', async () => {
  try {
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile('data/dictionary.v2.bin');
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    setDawgForTests(parseDawg(ab));
    assert.equal(isValid('מפורשת'), true, 'מפורשת should be in v2 binary');
    assert.equal(isValid('שלום'), true);
    assert.equal(isValid('זזזזזזזזזז'), false);
  } finally { resetDawg(); }
});
