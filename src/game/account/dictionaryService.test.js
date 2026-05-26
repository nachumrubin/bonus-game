import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from '../online/mockFirebase.js';
import {
  applyDictionaryDecision,
  buildPendingSuggestions,
  cleanDictionaryWord,
  parseSuggestedWords,
  submitDictionarySuggestions,
  syncApprovedDictionaryWordsOnce,
} from './dictionaryService.js';

test('cleanDictionaryWord and parseSuggestedWords keep Hebrew words only and dedupe', () => {
  assert.equal(cleanDictionaryWord(' אבג!12 '), 'אבג');
  assert.deepEqual(parseSuggestedWords('אבג, דהו\nאבג, x'), ['אבג', 'דהו']);
});

test('submitDictionarySuggestions writes only words not previously rejected or approved', async () => {
  const db = makeMockDb();
  await db.ref('dictionaryRejected/r1').set({ word: 'דחוי' });
  await db.ref('dictionaryApproved/קיים').set({ word: 'קיים' });

  const result = await submitDictionarySuggestions(db, {
    words: ['חדש', 'דחוי', 'קיים', 'חדש'],
    now: 123,
  });

  assert.deepEqual(result.submitted, ['חדש']);
  assert.equal(result.skipped.length, 2);
  const suggestions = db._data.dictionarySuggestions;
  assert.equal(Object.values(suggestions).length, 1);
  assert.equal(Object.values(suggestions)[0].word, 'חדש');
  assert.equal(Object.values(suggestions)[0].createdAt, 123);
});

test('buildPendingSuggestions filters rejected, approved, duplicates, and processed words', () => {
  const pending = buildPendingSuggestions({
    suggestions: {
      s1: { word: 'אחד', status: 'pending', createdAt: 2 },
      s2: { word: 'שניים', status: 'pending', createdAt: 1 },
      s3: { word: 'אחד', status: 'pending', createdAt: 3 },
      s4: { word: 'ישן', status: 'approved' },
      s5: { word: 'דחוי', status: 'pending' },
      s6: { word: 'מאושר', status: 'pending' },
      s7: { word: 'טופל', status: 'pending' },
    },
    rejected: { r1: { word: 'דחוי' } },
    approved: { a1: { word: 'מאושר' } },
    recentlyProcessed: new Set(['טופל']),
  });

  assert.deepEqual(pending.map((s) => s.id), ['s2', 's1']);
});

test('applyDictionaryDecision approves selected words and updates duplicate suggestions', async () => {
  const db = makeMockDb();
  await db.ref('dictionarySuggestions/s1').set({ word: 'חדש', status: 'pending' });
  await db.ref('dictionarySuggestions/s2').set({ word: 'חדש', status: 'pending' });
  await db.ref('dictionarySuggestions/s3').set({ word: 'אחר', status: 'pending' });

  const result = await applyDictionaryDecision(db, {
    action: 'approve',
    ids: ['s1'],
    suggestions: [
      { id: 's1', word: 'חדש' },
      { id: 's2', word: 'חדש' },
      { id: 's3', word: 'אחר' },
    ],
    now: 456,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.words, ['חדש']);
  assert.equal(db._data.dictionaryApproved['חדש'].approvedAt, 456);
  assert.equal(db._data.dictionarySuggestions.s1.status, 'approved');
  assert.equal(db._data.dictionarySuggestions.s2.status, 'approved');
  assert.equal(db._data.dictionarySuggestions.s3.status, 'pending');
});

test('applyDictionaryDecision rejects words into dictionaryRejected', async () => {
  const db = makeMockDb();
  await db.ref('dictionarySuggestions/s1').set({ word: 'לא', status: 'pending' });

  const result = await applyDictionaryDecision(db, {
    action: 'reject',
    ids: ['s1'],
    suggestions: [{ id: 's1', word: 'לא' }],
    now: 789,
  });

  assert.equal(result.changed, 1);
  assert.equal(Object.values(db._data.dictionaryRejected)[0].word, 'לא');
  assert.equal(Object.values(db._data.dictionaryRejected)[0].rejectedAt, 789);
});

test('syncApprovedDictionaryWordsOnce adds approved words to a dictionary Set', async () => {
  const db = makeMockDb();
  await db.ref('dictionaryApproved/א').set({ word: 'אחד' });
  const dict = new Set();
  assert.equal(await syncApprovedDictionaryWordsOnce(db, dict), 1);
  assert.ok(dict.has('אחד'));
});

// ── End-to-end: Firebase-approved words become valid in gameplay (GAP_REPORT item 11) ─
// The gap raised the concern that approved words might not flow into the
// active dictionary used by isValid(). This test wires the real
// `hebrewDictionary.DICT` (the same Set used by isValid) and proves a
// word in dictionaryApproved becomes playable.
test('syncApprovedDictionaryWordsOnce: approved words become valid via isValid()', async () => {
  const { DICT, isValid } = await import('../core/hebrewDictionary.js');
  const customWord = 'בוסטטסט'; // unlikely to be in the base dictionary
  assert.equal(isValid(customWord), false, 'baseline: custom word is not valid before sync');

  const db = makeMockDb();
  await db.ref('dictionaryApproved/ב').set({ word: customWord });
  const added = await syncApprovedDictionaryWordsOnce(db, DICT);
  assert.ok(added >= 1, 'at least the custom word was added');
  assert.ok(DICT.has(customWord), 'word is in the live DICT Set');
  assert.equal(isValid(customWord), true, 'word now passes isValid() — playable in-game');

  // Cleanup so other tests don't see the synthetic word.
  DICT.delete(customWord);
});
