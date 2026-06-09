// Dictionary admin operations.
//
// The admin panel writes directly to two Firebase paths:
//   /dictionaryApproved  — words explicitly added to the dictionary
//   /dictionaryRejected  — words explicitly excluded from gameplay
//
// At boot, the runtime mirrors both paths into in-memory overlays
// (hebrewDictionary.DICT and hebrewDictionary.BLOCKED_OVERLAY) via the
// sync* functions below. isValid() consults BLOCKED_OVERLAY before any
// positive lookup so admin removals override DAWG/DICT hits.
//
// History: a suggest→review pipeline used to live here, routed through a
// /dictionarySuggestions Firebase path. It was removed in June 2026 when
// the dictionary panel became admin-only and the staging step lost its
// purpose. See CHANGELOG entries dated June 2026.

export const DICTIONARY_APPROVED_PATH = 'dictionaryApproved';
export const DICTIONARY_REJECTED_PATH = 'dictionaryRejected';

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
