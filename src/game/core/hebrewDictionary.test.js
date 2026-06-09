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
  setDictionaryMode,
  getDictionaryMode,
  setDawgForTests,
  EXACT_REJECTS,
  CLASSIC_ALLOW,
  DEFECTIVE_ACCEPT,
} from './hebrewDictionary.js';
import { buildDawg, serializeDawg, parseDawg } from './dawg.js';

function dawgFromWords(words) {
  const sorted = [...new Set(words)].sort();
  return parseDawg(serializeDawg(buildDawg(sorted)));
}

function resetToV1() {
  setDictionaryMode('v1');
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

// ----------------------------------------------------------------------------
// v2 dictionary path (DAWG-backed, no morphology fallback).
// Every v2 test resets to v1 in a finally block so subsequent tests in the
// suite see the default mode.
// ----------------------------------------------------------------------------

test('v2: isValid returns true for exact DAWG hit', () => {
  try {
    setDawgForTests(dawgFromWords(['שלום', 'בית', 'ילד']));
    setDictionaryMode('v2');
    assert.equal(isValid('שלום'), true);
    assert.equal(isValid('בית'), true);
    assert.equal(isValid('ילד'), true);
  } finally { resetToV1(); }
});

test('v2: isValid returns false for words not in DAWG (no morphology fallback)', () => {
  try {
    // Only the lemma is in the DAWG. v1 would accept הלכתי via suffix
    // stripping → הלך; v2 should reject because curated lexicon is
    // responsible for shipping the inflected form directly.
    setDawgForTests(dawgFromWords(['הלך']));
    setDictionaryMode('v2');
    assert.equal(isValid('הלך'), true);
    assert.equal(isValid('הלכתי'), false, 'v2 must not infer inflection from lemma');
    assert.equal(isValid('הולך'), false);
  } finally { resetToV1(); }
});

test('v2: terminal final-form variants are accepted', () => {
  try {
    setDawgForTests(dawgFromWords(['שלום'])); // base form contains ם
    setDictionaryMode('v2');
    assert.equal(isValid('שלום'), true);
    assert.equal(isValid('שלומ'), true, 'medial-mem variant should match via final-form fold');
  } finally { resetToV1(); }
});

test('v2: EXACT_REJECTS always reject even if word slips into DAWG', () => {
  try {
    const sample = [...EXACT_REJECTS].slice(0, 5);
    // Deliberately include EXACT_REJECTS words in the DAWG to prove the
    // runtime policy filter still kicks in.
    setDawgForTests(dawgFromWords(['שלום', ...sample]));
    setDictionaryMode('v2');
    for (const w of sample) {
      assert.equal(isValid(w), false, `EXACT_REJECTS member ${w} must reject`);
    }
    assert.equal(isValid('שלום'), true);
  } finally { resetToV1(); }
});

test('v2: every EXACT_REJECTS member rejects', () => {
  try {
    setDawgForTests(dawgFromWords(['placeholder']));
    setDictionaryMode('v2');
    for (const w of EXACT_REJECTS) {
      assert.equal(isValid(w), false, `EXACT_REJECTS member ${w} must reject`);
    }
  } finally { resetToV1(); }
});

test('v2: CLASSIC_ALLOW members always accept even if DAWG omits them', () => {
  try {
    setDawgForTests(dawgFromWords(['filler']));
    setDictionaryMode('v2');
    for (const w of CLASSIC_ALLOW) {
      assert.equal(isValid(w), true, `CLASSIC_ALLOW member ${w} must accept`);
    }
  } finally { resetToV1(); }
});

test('v2: DEFECTIVE_ACCEPT members always accept even if DAWG omits them', () => {
  try {
    setDawgForTests(dawgFromWords(['filler']));
    setDictionaryMode('v2');
    for (const w of DEFECTIVE_ACCEPT) {
      assert.equal(isValid(w), true, `DEFECTIVE_ACCEPT member ${w} must accept`);
    }
  } finally { resetToV1(); }
});

test('v2: Firebase-approved overlay (DICT.add after load) is honored', () => {
  try {
    setDawgForTests(dawgFromWords(['שלום']));
    setDictionaryMode('v2');
    assert.equal(isValid('מילהחדשה'), false, 'unseen word should reject before approval');
    DICT.add('מילהחדשה');
    assert.equal(isValid('מילהחדשה'), true, 'approved-overlay word must validate');
  } finally { resetToV1(); }
});

test('v2: invalid input (non-Hebrew, empty) rejects', () => {
  try {
    setDawgForTests(dawgFromWords(['שלום']));
    setDictionaryMode('v2');
    assert.equal(isValid(''), false);
    assert.equal(isValid('   '), false);
    assert.equal(isValid('xyz'), false);
  } finally { resetToV1(); }
});

test('v2: rejects when DAWG never loaded', () => {
  try {
    setDawgForTests(null);
    setDictionaryMode('v2');
    assert.equal(isValid('שלום'), false);
  } finally { resetToV1(); }
});

test('v2: real bundled binary loads and validates expected words', async () => {
  try {
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile('data/dictionary.v2.bin');
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    setDawgForTests(parseDawg(ab));
    setDictionaryMode('v2');
    // The bundled v2 binary is currently the legacy 40K re-encoded.
    // Anything present in legacy must validate.
    assert.equal(isValid('מפורשת'), true, 'מפורשת should validate via v2');
    assert.equal(isValid('שלום'), true);
    // Negative
    assert.equal(isValid('זזזזזזזזזז'), false);
  } finally { resetToV1(); }
});

test('mode switch: v1 ↔ v2 is clean — v1 tests after v2 still see legacy behavior', () => {
  // Verify resetToV1 truly puts the module back to v1 behavior.
  try {
    setDawgForTests(dawgFromWords(['א']));
    setDictionaryMode('v2');
    assert.equal(getDictionaryMode(), 'v2');
  } finally { resetToV1(); }
  assert.equal(getDictionaryMode(), 'v1');
  // v1 path now active — verify analyze() chain still runs by adding a word
  // and checking exact match works.
  addWordsFromText('בדיקה\n');
  assert.equal(isValid('בדיקה'), true);
});
