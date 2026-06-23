// Dictionary admin + user-suggestion operations.
//
// The admin panel writes directly to two Firebase paths:
//   /dictionaryApproved  — words explicitly added to the dictionary
//   /dictionaryRejected  — words explicitly excluded from gameplay
//
// Regular users can suggest words via:
//   /dictionarySuggestions — pending user suggestions, reviewed by admins
//
// When an admin approves a word, findPendingSuggestionsForWords() is used
// to look up which users suggested it so their wordsAccepted stat can be
// bumped (driving the word_contributor achievement).
//
// At boot, the runtime mirrors both paths into in-memory overlays
// (hebrewDictionary.DICT and hebrewDictionary.BLOCKED_OVERLAY) via the
// sync* functions below. isValid() consults BLOCKED_OVERLAY before any
// positive lookup so admin removals override DAWG/DICT hits.

export const DICTIONARY_APPROVED_PATH    = 'dictionaryApproved';
export const DICTIONARY_REJECTED_PATH    = 'dictionaryRejected';
export const DICTIONARY_SUGGESTIONS_PATH = 'dictionarySuggestions';

export function cleanDictionaryWord(raw) {
  return String(raw ?? '').replace(/[^א-ת]/g, '').trim();
}

// Parse a comma/newline-separated string of words, normalizing each to
// Hebrew-only and deduplicating.
export function parseSuggestedWords(raw) {
  const seen = new Set();
  return String(raw ?? '')
    .replace(/[^א-ת,\n]/g, '')
    .split(/[,\n]+/u)
    .map(cleanDictionaryWord)
    .filter(Boolean)
    .filter((word) => {
      if (seen.has(word)) return false;
      seen.add(word);
      return true;
    });
}

// Admin direct-add. Writes each word to /dictionaryApproved/{word} with
// { word, approvedAt }. Skips words that are already approved or currently
// blocked (admin must un-block before re-adding).
export async function addWordsToDictionary(db, {
  words,
  now = Date.now(),
  serverTimestamp = null,
} = {}) {
  if (!db) throw new Error('addWordsToDictionary: db required');
  const parsed = Array.isArray(words) ? words.map(cleanDictionaryWord).filter(Boolean) : parseSuggestedWords(words);
  if (!parsed.length) return { ok: false, reason: 'empty', added: [], skipped: [] };

  const [approvedSnap, rejectedSnap] = await Promise.all([
    db.ref(DICTIONARY_APPROVED_PATH).get(),
    db.ref(DICTIONARY_REJECTED_PATH).get(),
  ]);
  const approvedWords = wordsFromRecord(approvedSnap?.val ? approvedSnap.val() : null);
  const rejectedWords = wordsFromRecord(rejectedSnap?.val ? rejectedSnap.val() : null);
  const unique = [...new Set(parsed)];
  const stamp = typeof serverTimestamp === 'function' ? serverTimestamp() : now;
  const added = [];
  const skipped = [];

  for (const word of unique) {
    if (approvedWords.has(word)) { skipped.push({ word, reason: 'already-approved' }); continue; }
    if (rejectedWords.has(word)) { skipped.push({ word, reason: 'currently-blocked' }); continue; }
    await db.ref(`${DICTIONARY_APPROVED_PATH}/${word}`).set({ word, approvedAt: stamp });
    added.push(word);
  }
  return {
    ok: added.length > 0,
    reason: added.length > 0 ? null : 'all-skipped',
    added,
    skipped,
  };
}

// Admin direct-remove. Validates each word is currently valid (via injected
// isValidWord predicate), writes a /dictionaryRejected entry, and strips the
// word from /dictionaryApproved if it was there (so the boot approved-sync
// doesn't re-add it next session).
export async function removeWordsFromDictionary(db, {
  words,
  isValidWord,
  now = Date.now(),
  serverTimestamp = null,
} = {}) {
  if (!db) throw new Error('removeWordsFromDictionary: db required');
  if (typeof isValidWord !== 'function') {
    throw new Error('removeWordsFromDictionary: isValidWord predicate required');
  }
  const parsed = Array.isArray(words) ? words.map(cleanDictionaryWord).filter(Boolean) : parseSuggestedWords(words);
  if (!parsed.length) return { ok: false, reason: 'empty', removed: [], skipped: [] };

  const unique = [...new Set(parsed)];
  const stamp = typeof serverTimestamp === 'function' ? serverTimestamp() : now;
  const removed = [];
  const skipped = [];

  for (const word of unique) {
    if (!isValidWord(word)) { skipped.push({ word, reason: 'not-in-dictionary' }); continue; }
    await db.ref(DICTIONARY_REJECTED_PATH).push().set({
      word,
      rejectedAt: stamp,
      source: 'admin-direct-remove',
    });
    await db.ref(`${DICTIONARY_APPROVED_PATH}/${word}`).remove();
    removed.push(word);
  }
  return {
    ok: removed.length > 0,
    reason: removed.length > 0 ? null : 'all-skipped',
    removed,
    skipped,
  };
}

// Boot-time sync: merge /dictionaryApproved into the runtime DICT set so
// admin-added words validate in gameplay.
export async function syncApprovedDictionaryWordsOnce(db, dictSet) {
  if (!db) throw new Error('syncApprovedDictionaryWordsOnce: db required');
  if (!dictSet || typeof dictSet.add !== 'function') {
    throw new Error('syncApprovedDictionaryWordsOnce: dictSet required');
  }
  const snap = await db.ref(DICTIONARY_APPROVED_PATH).get();
  const words = wordsFromRecord(snap?.val ? snap.val() : null);
  for (const word of words) dictSet.add(word);
  return words.size;
}

// Boot-time sync: merge /dictionaryRejected into the runtime block-overlay
// so admin-removed words always reject, overriding any positive DAWG/DICT
// lookup.
export async function syncBlockedDictionaryWordsOnce(db, blockedSet) {
  if (!db) throw new Error('syncBlockedDictionaryWordsOnce: db required');
  if (!blockedSet || typeof blockedSet.add !== 'function') {
    throw new Error('syncBlockedDictionaryWordsOnce: blockedSet required');
  }
  const snap = await db.ref(DICTIONARY_REJECTED_PATH).get();
  const words = wordsFromRecord(snap?.val ? snap.val() : null);
  for (const word of words) blockedSet.add(word);
  return words.size;
}

function wordsFromRecord(record) {
  return new Set(
    Object.values(record ?? {})
      .map((entry) => cleanDictionaryWord(entry?.word ?? entry?.normalizedWord ?? ''))
      .filter(Boolean),
  );
}

// Submit a user word suggestion to /dictionarySuggestions. Any authenticated
// user can call this — the actual approval lives with the admin.
// type: 'add' (suggest adding a missing word) | 'remove' (suggest removing a word)
// Returns { ok, reason? }.
export async function submitWordSuggestion(db, {
  word,
  uid,
  type = 'add',
  now = Date.now(),
  serverTimestamp = null,
} = {}) {
  if (!db) throw new Error('submitWordSuggestion: db required');
  if (!uid) return { ok: false, reason: 'not-authenticated' };
  const normalized = cleanDictionaryWord(word);
  if (!normalized) return { ok: false, reason: 'empty' };

  const [approvedSnap, rejectedSnap] = await Promise.all([
    db.ref(DICTIONARY_APPROVED_PATH).get(),
    db.ref(DICTIONARY_REJECTED_PATH).get(),
  ]);
  const approvedWords = wordsFromRecord(approvedSnap?.val ? approvedSnap.val() : null);
  const rejectedWords = wordsFromRecord(rejectedSnap?.val ? rejectedSnap.val() : null);

  if (type === 'add') {
    if (approvedWords.has(normalized)) return { ok: false, reason: 'already-in-dictionary' };
    if (rejectedWords.has(normalized)) return { ok: false, reason: 'word-is-blocked' };
  } else {
    // type === 'remove': word is already blocked — no point suggesting removal
    if (rejectedWords.has(normalized)) return { ok: false, reason: 'word-already-removed' };
  }

  // Check if this user already has a pending suggestion of the same type for this word.
  const suggestionsSnap = await db.ref(DICTIONARY_SUGGESTIONS_PATH).get();
  const existing = Object.values(suggestionsSnap?.val ? (suggestionsSnap.val() ?? {}) : {});
  const alreadySuggested = existing.some(
    (s) => cleanDictionaryWord(s?.word ?? '') === normalized &&
      s?.status === 'pending' &&
      s?.type === type &&
      (Array.isArray(s?.suggestedBy) ? s.suggestedBy.includes(uid) : s?.suggestedBy === uid),
  );
  if (alreadySuggested) return { ok: false, reason: 'already-suggested' };

  const stamp = typeof serverTimestamp === 'function' ? serverTimestamp() : now;
  await db.ref(DICTIONARY_SUGGESTIONS_PATH).push().set({
    word: normalized,
    normalizedWord: normalized,
    type,
    status: 'pending',
    suggestedBy: [uid],
    createdAt: stamp,
  });
  return { ok: true, word: normalized };
}

// Given a list of words that were just approved/actioned by an admin, scan
// /dictionarySuggestions for pending suggestions of those words.
// Pass { type: 'add' | 'remove' } to restrict to one suggestion type.
// Returns an array of { key, word, uid } pairs — one entry per user per word
// who suggested it. The caller is responsible for bumping wordsAccepted
// and marking suggestions approved.
export async function findPendingSuggestionsForWords(db, words, { type } = {}) {
  if (!db) throw new Error('findPendingSuggestionsForWords: db required');
  if (!words?.length) return [];
  const wordSet = new Set(words.map(cleanDictionaryWord).filter(Boolean));

  const snap = await db.ref(DICTIONARY_SUGGESTIONS_PATH).get();
  const entries = Object.entries(snap?.val ? (snap.val() ?? {}) : {});

  const credits = [];
  for (const [key, s] of entries) {
    const w = cleanDictionaryWord(s?.word ?? '');
    if (!wordSet.has(w) || s?.status !== 'pending') continue;
    if (type !== undefined && s?.type !== type) continue;
    const suggesters = Array.isArray(s.suggestedBy) ? s.suggestedBy : (s.suggestedBy ? [s.suggestedBy] : []);
    for (const uid of suggesters) {
      if (uid) credits.push({ key, word: w, uid });
    }
  }
  return credits;
}

// Mark a batch of suggestion entries (by key) as approved in Firebase.
export async function markSuggestionsApproved(db, keys) {
  if (!db || !keys?.length) return;
  await Promise.all(
    keys.map((key) => db.ref(`${DICTIONARY_SUGGESTIONS_PATH}/${key}/status`).set('approved')),
  );
}
