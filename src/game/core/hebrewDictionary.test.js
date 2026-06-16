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
  addWordsFromText,
  setValidationLogger,
  spellingVariants,
  isMiniGameWord,
  BLOCKED_OVERLAY,
} from './hebrewDictionary.js';

function loadWords(...words) {
  addWordsFromText(words.join('\n'));
}

function resetDict() {
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

test('isValid: returns true for exact dict hit', () => {
  try {
    loadWords('שלום', 'בית', 'ילד');
    assert.equal(isValid('שלום'), true);
    assert.equal(isValid('בית'), true);
    assert.equal(isValid('ילד'), true);
  } finally { resetDict(); }
});

test('isValid: returns false for words not in dict (no morphology fallback)', () => {
  try {
    loadWords('הלך');
    assert.equal(isValid('הלך'), true);
    assert.equal(isValid('הלכתי'), false, 'inflected form not in dict must reject');
    assert.equal(isValid('הולך'), false);
  } finally { resetDict(); }
});

test('isValid: terminal final-form variants are accepted', () => {
  try {
    loadWords('שלום');
    assert.equal(isValid('שלום'), true);
    assert.equal(isValid('שלומ'), true, 'medial-mem variant should match via final-form fold');
  } finally { resetDict(); }
});

test('isValid: BLOCKED_OVERLAY rejects a word even when it is in the dict', () => {
  try {
    loadWords('שלום', 'בית');
    assert.equal(isValid('בית'), true, 'in-dict word valid before blocking');
    BLOCKED_OVERLAY.add('בית');
    assert.equal(isValid('בית'), false, 'BLOCKED_OVERLAY must override a dict hit');
  } finally { BLOCKED_OVERLAY.delete('בית'); resetDict(); }
});

test('isValid: Firebase-approved overlay (DICT.add after load) is honored', () => {
  try {
    loadWords('שלום');
    assert.equal(isValid('מילהחדשה'), false, 'unseen word should reject before approval');
    DICT.add('מילהחדשה');
    assert.equal(isValid('מילהחדשה'), true, 'approved-overlay word must validate');
  } finally { resetDict(); }
});

test('isValid: invalid input (non-Hebrew, empty) rejects', () => {
  try {
    loadWords('שלום');
    assert.equal(isValid(''), false);
    assert.equal(isValid('   '), false);
    assert.equal(isValid('xyz'), false);
  } finally { resetDict(); }
});

test('isValid: rejects when dict is empty', () => {
  try {
    DICT.clear();
    assert.equal(isValid('שלום'), false);
  } finally { resetDict(); }
});

test('isValid: configurable logger records validations', () => {
  try {
    loadWords('אב');
    const logs = [];
    setValidationLogger(null);
    assert.equal(isValid('אב'), true);
    assert.deepEqual(logs, []);

    setValidationLogger((...args) => logs.push(args));
    assert.equal(isValid('גד'), false);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[isValid]');
    setValidationLogger(null);
  } finally { resetDict(); }
});

test('isMiniGameWord: rejects words starting with two identical letters', () => {
  assert.equal(isMiniGameWord('ששון'), false);   // starts שש
  assert.equal(isMiniGameWord('ממשלה'), false);  // starts מם (same after norm)
});

test('isMiniGameWord: rejects words ending with two identical letters', () => {
  assert.equal(isMiniGameWord('שלומם'), false);  // ends מם → ממ after norm
  assert.equal(isMiniGameWord('כבסס'), false);   // ends סס
});

test('isMiniGameWord: rejects words with three identical letters in a row', () => {
  assert.equal(isMiniGameWord('אאא'), false);
  assert.equal(isMiniGameWord('שלאאאם'), false);
});

test('isMiniGameWord: accepts normal words', () => {
  assert.equal(isMiniGameWord('שלום'), true);
  assert.equal(isMiniGameWord('ילד'), true);
  assert.equal(isMiniGameWord('ממשלה'), false);  // starts מם
  assert.equal(isMiniGameWord('בית'), true);
});

test('isMiniGameWord: final-form folding applies before repetition check', () => {
  // ם and מ are same base letter — word ending in ...מם should be rejected
  assert.equal(isMiniGameWord('לחמם'), false);
});

test('isValid: real bundled text file validates expected words', async () => {
  try {
    const fs = await import('node:fs/promises');
    const txt = await fs.readFile('data/dictionary.txt', 'utf8');
    addWordsFromText(txt);
    assert.equal(isValid('מפורשת'), true, 'מפורשת should be in dictionary.txt');
    assert.equal(isValid('שלום'), true);
    assert.equal(isValid('זזזזזזזזזז'), false);
  } finally { resetDict(); }
});
