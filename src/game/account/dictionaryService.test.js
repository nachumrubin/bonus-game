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
  submitWordSuggestion,
  findPendingSuggestionsForWords,
  markSuggestionsApproved,
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

// ── User word suggestions ──────────────────────────────────────────────────

test('submitWordSuggestion writes a pending suggestion for an authenticated user', async () => {
  const db = makeMockDb();
  const result = await submitWordSuggestion(db, { word: 'חדשה', uid: 'u1', now: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.word, 'חדשה');
  const entries = Object.values(db._data.dictionarySuggestions ?? {});
  assert.equal(entries.length, 1);
  assert.equal(entries[0].word, 'חדשה');
  assert.equal(entries[0].status, 'pending');
  assert.deepEqual(entries[0].suggestedBy, ['u1']);
});

test('submitWordSuggestion rejects when no uid provided', async () => {
  const db = makeMockDb();
  const result = await submitWordSuggestion(db, { word: 'חדשה' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-authenticated');
});

test('submitWordSuggestion rejects empty or non-Hebrew word', async () => {
  const db = makeMockDb();
  const result = await submitWordSuggestion(db, { word: 'abc123', uid: 'u1' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'empty');
});

test('submitWordSuggestion rejects word already in /dictionaryApproved', async () => {
  const db = makeMockDb();
  await db.ref('dictionaryApproved/קיים').set({ word: 'קיים' });
  const result = await submitWordSuggestion(db, { word: 'קיים', uid: 'u1' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'already-in-dictionary');
});

test('submitWordSuggestion rejects duplicate suggestion from same user', async () => {
  const db = makeMockDb();
  await submitWordSuggestion(db, { word: 'חדשה', uid: 'u1' });
  const result = await submitWordSuggestion(db, { word: 'חדשה', uid: 'u1' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'already-suggested');
});

test('findPendingSuggestionsForWords returns credits for matching pending suggestions', async () => {
  const db = makeMockDb();
  await db.ref('dictionarySuggestions/s1').set({
    word: 'חדשה', normalizedWord: 'חדשה', status: 'pending', suggestedBy: ['u1', 'u2'], type: 'add', createdAt: 1,
  });
  await db.ref('dictionarySuggestions/s2').set({
    word: 'אחרת', normalizedWord: 'אחרת', status: 'pending', suggestedBy: ['u1'], type: 'add', createdAt: 2,
  });
  const credits = await findPendingSuggestionsForWords(db, ['חדשה']);
  assert.equal(credits.length, 2);
  const uids = credits.map((c) => c.uid).sort();
  assert.deepEqual(uids, ['u1', 'u2']);
  assert.ok(credits.every((c) => c.word === 'חדשה'));
});

test('findPendingSuggestionsForWords ignores already-approved suggestions', async () => {
  const db = makeMockDb();
  await db.ref('dictionarySuggestions/s1').set({
    word: 'חדשה', normalizedWord: 'חדשה', status: 'approved', suggestedBy: ['u1'], type: 'add', createdAt: 1,
  });
  const credits = await findPendingSuggestionsForWords(db, ['חדשה']);
  assert.equal(credits.length, 0);
});

test('markSuggestionsApproved updates status to approved', async () => {
  const db = makeMockDb();
  await db.ref('dictionarySuggestions/s1').set({
    word: 'חדשה', status: 'pending', suggestedBy: ['u1'],
  });
  await markSuggestionsApproved(db, ['s1']);
  assert.equal(db._data.dictionarySuggestions.s1.status, 'approved');
});

// ── User removal suggestions ───────────────────────────────────────────────

test('submitWordSuggestion with type remove writes a pending remove suggestion', async () => {
  const db = makeMockDb();
  const result = await submitWordSuggestion(db, {
    word: 'שלום',
    uid: 'u1',
    type: 'remove',
    isValidWord: (w) => w === 'שלום',
    now: 2000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.word, 'שלום');
  const entries = Object.values(db._data.dictionarySuggestions ?? {});
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, 'remove');
  assert.equal(entries[0].status, 'pending');
});

test('submitWordSuggestion remove rejects words not in the dictionary', async () => {
  const db = makeMockDb();
  const result = await submitWordSuggestion(db, {
    word: 'טעות',
    uid: 'u1',
    type: 'remove',
    isValidWord: () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-in-dictionary');
  assert.deepEqual(db._data.dictionarySuggestions, undefined);
});

test('submitWordSuggestion remove rejects word already in rejectedWords', async () => {
  const db = makeMockDb();
  await db.ref('dictionaryRejected/r1').set({ word: 'חסום' });
  const result = await submitWordSuggestion(db, { word: 'חסום', uid: 'u1', type: 'remove' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'word-already-removed');
});

test('submitWordSuggestion remove rejects duplicate from same user', async () => {
  const db = makeMockDb();
  const isValidWord = (w) => w === 'שלום';
  await submitWordSuggestion(db, { word: 'שלום', uid: 'u1', type: 'remove', isValidWord });
  const result = await submitWordSuggestion(db, { word: 'שלום', uid: 'u1', type: 'remove', isValidWord });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'already-suggested');
});

test('submitWordSuggestion add and remove are independent — same word can have both types', async () => {
  const db = makeMockDb();
  const r1 = await submitWordSuggestion(db, { word: 'שלום', uid: 'u1', type: 'add' });
  const r2 = await submitWordSuggestion(db, {
    word: 'שלום',
    uid: 'u1',
    type: 'remove',
    isValidWord: (w) => w === 'שלום',
  });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  const entries = Object.values(db._data.dictionarySuggestions ?? {});
  assert.equal(entries.length, 2);
});

test('findPendingSuggestionsForWords with type filter only returns matching type', async () => {
  const db = makeMockDb();
  await db.ref('dictionarySuggestions/s1').set({
    word: 'שלום', normalizedWord: 'שלום', status: 'pending', suggestedBy: ['u1'], type: 'add', createdAt: 1,
  });
  await db.ref('dictionarySuggestions/s2').set({
    word: 'שלום', normalizedWord: 'שלום', status: 'pending', suggestedBy: ['u2'], type: 'remove', createdAt: 2,
  });
  const addCredits = await findPendingSuggestionsForWords(db, ['שלום'], { type: 'add' });
  assert.equal(addCredits.length, 1);
  assert.equal(addCredits[0].uid, 'u1');

  const removeCredits = await findPendingSuggestionsForWords(db, ['שלום'], { type: 'remove' });
  assert.equal(removeCredits.length, 1);
  assert.equal(removeCredits[0].uid, 'u2');

  const allCredits = await findPendingSuggestionsForWords(db, ['שלום']);
  assert.equal(allCredits.length, 2);
});

test('findPendingSuggestionsForWords treats legacy missing type as add', async () => {
  const db = makeMockDb();
  await db.ref('dictionarySuggestions/s1').set({
    word: 'חדש', normalizedWord: 'חדש', status: 'pending', suggestedBy: ['u1'], createdAt: 1,
  });
  const addCredits = await findPendingSuggestionsForWords(db, ['חדש'], { type: 'add' });
  assert.equal(addCredits.length, 1);
  assert.equal(addCredits[0].uid, 'u1');

  const removeCredits = await findPendingSuggestionsForWords(db, ['חדש'], { type: 'remove' });
  assert.equal(removeCredits.length, 0);
});
