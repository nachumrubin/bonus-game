import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from '../online/mockFirebase.js';
import {
  addWordsToDictionary,
  cleanDictionaryWord,
  parseSuggestedWords,
  removeWordsFromDictionary,
  syncApprovedDictionaryWordsOnce,
  syncBlockedDictionaryWordsOnce,
} from './dictionaryService.js';

test('cleanDictionaryWord and parseSuggestedWords keep Hebrew words only and dedupe', () => {
  assert.equal(cleanDictionaryWord(' אבג!12 '), 'אבג');
  assert.deepEqual(parseSuggestedWords('אבג, דהו\nאבג, x'), ['אבג', 'דהו']);
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

// ── Direct admin actions ────────────────────────────────────────────────────

test('addWordsToDictionary writes new words directly to /dictionaryApproved', async () => {
  const db = makeMockDb();
  const result = await addWordsToDictionary(db, { words: ['חדש', 'אחר'], now: 500 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.added.sort(), ['אחר', 'חדש']);
  assert.equal(db._data.dictionaryApproved.חדש.approvedAt, 500);
  assert.equal(db._data.dictionaryApproved.אחר.approvedAt, 500);
});

test('addWordsToDictionary skips already-approved words', async () => {
  const db = makeMockDb();
  await db.ref('dictionaryApproved/קיים').set({ word: 'קיים' });
  const result = await addWordsToDictionary(db, { words: ['חדש', 'קיים'] });
  assert.deepEqual(result.added, ['חדש']);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'already-approved');
});

test('addWordsToDictionary refuses to add a word that is currently blocked', async () => {
  const db = makeMockDb();
  await db.ref('dictionaryRejected/r1').set({ word: 'חסום' });
  const result = await addWordsToDictionary(db, { words: ['חסום', 'חדש'] });
  assert.deepEqual(result.added, ['חדש']);
  assert.equal(result.skipped[0].reason, 'currently-blocked');
  assert.equal(db._data.dictionaryApproved.חסום, undefined);
});

test('removeWordsFromDictionary writes to /dictionaryRejected and strips /dictionaryApproved', async () => {
  const db = makeMockDb();
  await db.ref('dictionaryApproved/ישן').set({ word: 'ישן' }); // previously admin-added
  const inDict = new Set(['ישן', 'אחר']);
  const result = await removeWordsFromDictionary(db, {
    words: ['ישן', 'אחר', 'לאקיים'],
    isValidWord: (w) => inDict.has(w),
    now: 700,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.removed.sort(), ['אחר', 'ישן']);
  // Approved entry was stripped (so it doesn't re-add at next boot sync).
  assert.equal(db._data.dictionaryApproved.ישן, undefined);
  const rejected = Object.values(db._data.dictionaryRejected ?? {});
  assert.equal(rejected.length, 2);
  for (const r of rejected) assert.equal(r.source, 'admin-direct-remove');
});

test('removeWordsFromDictionary skips words not in the dictionary', async () => {
  const db = makeMockDb();
  const result = await removeWordsFromDictionary(db, {
    words: ['לאקיים'],
    isValidWord: () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.removed.length, 0);
  assert.equal(result.skipped[0].reason, 'not-in-dictionary');
});

test('removeWordsFromDictionary requires the isValidWord predicate', async () => {
  const db = makeMockDb();
  await assert.rejects(
    () => removeWordsFromDictionary(db, { words: ['שלום'] }),
    /isValidWord predicate required/
  );
});

test('syncBlockedDictionaryWordsOnce populates the block-overlay set', async () => {
  const db = makeMockDb();
  await db.ref('dictionaryRejected/r1').set({ word: 'אחד' });
  await db.ref('dictionaryRejected/r2').set({ word: 'שניים' });
  const blocked = new Set();
  const count = await syncBlockedDictionaryWordsOnce(db, blocked);
  assert.equal(count, 2);
  assert.ok(blocked.has('אחד'));
  assert.ok(blocked.has('שניים'));
});

test('syncBlockedDictionaryWordsOnce: BLOCKED_OVERLAY makes isValid reject the word', async () => {
  const { BLOCKED_OVERLAY, DICT, isValid } = await import('../core/hebrewDictionary.js');
  const word = 'יהיהבלוק'; // a synthetic Hebrew-only string unlikely to be elsewhere

  // Setup: put the word in DICT so it would normally validate.
  DICT.add(word);
  assert.equal(isValid(word), true, 'baseline: word validates before blocking');

  // Apply the block via the sync path.
  const db = makeMockDb();
  await db.ref('dictionaryRejected/r1').set({ word });
  await syncBlockedDictionaryWordsOnce(db, BLOCKED_OVERLAY);
  assert.ok(BLOCKED_OVERLAY.has(word));

  // Now isValid must reject — block-overlay overrides positive DICT lookup.
  assert.equal(isValid(word), false, 'blocked word must reject even though DICT contains it');

  // Cleanup
  BLOCKED_OVERLAY.delete(word);
  DICT.delete(word);
});
