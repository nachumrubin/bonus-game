export const DICTIONARY_SUGGESTIONS_PATH = 'dictionarySuggestions';
export const DICTIONARY_APPROVED_PATH = 'dictionaryApproved';
export const DICTIONARY_REJECTED_PATH = 'dictionaryRejected';

export function cleanDictionaryWord(raw) {
  return String(raw ?? '').replace(/[^א-ת]/g, '').trim();
}

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

export function buildPendingSuggestions({ suggestions = {}, rejected = {}, approved = {}, recentlyProcessed = new Set() } = {}) {
  const rejectedWords = wordsFromRecord(rejected);
  const approvedWords = wordsFromRecord(approved);
  const seenWords = new Set();
  return Object.entries(suggestions ?? {})
    .map(([id, entry]) => ({
      id,
      word: cleanDictionaryWord(entry?.word ?? entry?.normalizedWord ?? ''),
      status: entry?.status ?? 'pending',
      createdAt: Number(entry?.createdAt ?? 0) || 0,
    }))
    .filter((entry) => {
      if (!entry.word || entry.status !== 'pending') return false;
      if (rejectedWords.has(entry.word) || approvedWords.has(entry.word) || recentlyProcessed.has(entry.word)) return false;
      if (seenWords.has(entry.word)) return false;
      seenWords.add(entry.word);
      return true;
    })
    .sort((a, b) => (a.createdAt - b.createdAt) || a.word.localeCompare(b.word));
}

export async function submitDictionarySuggestions(db, {
  words,
  now = Date.now(),
  serverTimestamp = null,
} = {}) {
  if (!db) throw new Error('submitDictionarySuggestions: db required');
  const parsed = Array.isArray(words) ? words.map(cleanDictionaryWord).filter(Boolean) : parseSuggestedWords(words);
  if (!parsed.length) return { ok: false, reason: 'empty', submitted: [], skipped: [] };

  const rejectedSnap = await db.ref(DICTIONARY_REJECTED_PATH).get();
  const approvedSnap = await db.ref(DICTIONARY_APPROVED_PATH).get();
  const rejectedWords = wordsFromRecord(rejectedSnap?.val ? rejectedSnap.val() : null);
  const approvedWords = wordsFromRecord(approvedSnap?.val ? approvedSnap.val() : null);
  const unique = [...new Set(parsed)];
  const submitted = [];
  const skipped = [];

  for (const word of unique) {
    if (rejectedWords.has(word)) { skipped.push({ word, reason: 'rejected' }); continue; }
    if (approvedWords.has(word)) { skipped.push({ word, reason: 'approved' }); continue; }
    const ref = db.ref(DICTIONARY_SUGGESTIONS_PATH).push();
    await ref.set({
      word,
      normalizedWord: word,
      status: 'pending',
      createdAt: typeof serverTimestamp === 'function' ? serverTimestamp() : now,
    });
    submitted.push(word);
  }

  return {
    ok: submitted.length > 0,
    reason: submitted.length > 0 ? null : 'all-skipped',
    submitted,
    skipped,
  };
}

export async function listPendingDictionarySuggestions(db, { recentlyProcessed = new Set() } = {}) {
  if (!db) throw new Error('listPendingDictionarySuggestions: db required');
  const [suggestionsSnap, rejectedSnap, approvedSnap] = await Promise.all([
    db.ref(DICTIONARY_SUGGESTIONS_PATH).get(),
    db.ref(DICTIONARY_REJECTED_PATH).get(),
    db.ref(DICTIONARY_APPROVED_PATH).get(),
  ]);
  return buildPendingSuggestions({
    suggestions: suggestionsSnap?.val ? suggestionsSnap.val() : null,
    rejected: rejectedSnap?.val ? rejectedSnap.val() : null,
    approved: approvedSnap?.val ? approvedSnap.val() : null,
    recentlyProcessed,
  });
}

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

export async function applyDictionaryDecision(db, {
  action,
  suggestions = [],
  ids = [],
  now = Date.now(),
  serverTimestamp = null,
} = {}) {
  if (!db) throw new Error('applyDictionaryDecision: db required');
  if (action !== 'approve' && action !== 'reject') return { ok: false, reason: 'bad-action', changed: 0, words: [] };
  const selectedIds = new Set(ids);
  if (!selectedIds.size) return { ok: false, reason: 'empty', changed: 0, words: [] };

  const selected = suggestions.filter((s) => selectedIds.has(s.id) && cleanDictionaryWord(s.word));
  const words = [...new Set(selected.map((s) => cleanDictionaryWord(s.word)))];
  const stamp = typeof serverTimestamp === 'function' ? serverTimestamp() : now;

  for (const word of words) {
    if (action === 'approve') {
      await db.ref(`${DICTIONARY_APPROVED_PATH}/${word}`).set({ word, approvedAt: stamp });
    } else {
      await db.ref(DICTIONARY_REJECTED_PATH).push().set({ word, rejectedAt: stamp });
    }
    for (const suggestion of suggestions) {
      if (cleanDictionaryWord(suggestion.word) !== word) continue;
      await db.ref(`${DICTIONARY_SUGGESTIONS_PATH}/${suggestion.id}`).update({
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewedAt: stamp,
      });
    }
  }

  return { ok: true, action, changed: words.length, words };
}

function wordsFromRecord(record) {
  return new Set(
    Object.values(record ?? {})
      .map((entry) => cleanDictionaryWord(entry?.word ?? entry?.normalizedWord ?? ''))
      .filter(Boolean),
  );
}
