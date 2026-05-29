import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from './mockFirebase.js';
import { joinQueue, leaveQueue, tryPair, isCompatible } from './matchmakingService.js';

test('joinQueue writes the entry under matchmakingQueue/{mode}/{uid}', async () => {
  const db = makeMockDb();
  await joinQueue(db, {
    uid: 'alice', mode: 'random-live',
    profile: { displayName: 'Alice', avatar: null, rating: 1200 },
    settings: {},
    serverTimestamp: 100,
  });
  const entry = db._data.matchmakingQueue['random-live'].alice;
  assert.equal(entry.uid, 'alice');
  assert.equal(entry.rating, 1200);
});

test('leaveQueue removes the entry', async () => {
  const db = makeMockDb();
  await joinQueue(db, {
    uid: 'alice', mode: 'random-live',
    profile: { displayName: 'Alice', avatar: null }, settings: {},
    serverTimestamp: 100,
  });
  await leaveQueue(db, { uid: 'alice', mode: 'random-live' });
  assert.equal(db._data.matchmakingQueue['random-live']?.alice ?? null, null);
});

test('tryPair returns matched=false when nobody else is queued', async () => {
  const db = makeMockDb();
  await joinQueue(db, {
    uid: 'alice', mode: 'random-live',
    profile: { displayName: 'Alice', avatar: null }, settings: {},
    serverTimestamp: 100,
  });
  const r = await tryPair(db, {
    uid: 'alice', mode: 'random-live',
    createRoomFromPair: () => { throw new Error('should not be called'); },
  });
  assert.equal(r.matched, false);
});

test('tryPair pairs two waiting users and removes both queue entries', async () => {
  const db = makeMockDb();
  await joinQueue(db, {
    uid: 'alice', mode: 'random-live',
    profile: { displayName: 'Alice', avatar: null }, settings: {}, serverTimestamp: 100,
  });
  await joinQueue(db, {
    uid: 'bob', mode: 'random-live',
    profile: { displayName: 'Bob', avatar: null }, settings: {}, serverTimestamp: 200,
  });

  let createdWith = null;
  const r = await tryPair(db, {
    uid: 'alice', mode: 'random-live',
    createRoomFromPair: async (mine, theirs) => {
      createdWith = { mine, theirs };
      return { roomId: 'r-paired', room: { roomId: 'r-paired' } };
    },
  });
  assert.equal(r.matched, true);
  assert.equal(r.partnerUid, 'bob');
  assert.equal(r.roomId, 'r-paired');
  assert.equal(createdWith.mine.uid, 'alice');
  assert.equal(createdWith.theirs.uid, 'bob');
  // Both removed from queue
  assert.equal(db._data.matchmakingQueue['random-live']?.alice ?? null, null);
  assert.equal(db._data.matchmakingQueue['random-live']?.bob ?? null, null);
});

test('isCompatible: strict + matching timelimit → compatible', () => {
  assert.equal(isCompatible(
    { rating: 1000, settings: { strict: true, timelimit: true } },
    { rating: 1000, settings: { strict: true, timelimit: true } },
  ), true);
});

test('isCompatible: strict + mismatched timelimit → incompatible', () => {
  assert.equal(isCompatible(
    { rating: 1000, settings: { strict: true,  timelimit: true  } },
    { rating: 1000, settings: { strict: false, timelimit: false } },
  ), false);
});

test('isCompatible: neither strict + mismatched timelimit → compatible', () => {
  assert.equal(isCompatible(
    { rating: 1000, settings: { strict: false, timelimit: true  } },
    { rating: 1000, settings: { strict: false, timelimit: false } },
  ), true);
});

test('isCompatible: my ratingRange filters out high-rating partner', () => {
  assert.equal(isCompatible(
    { rating: 1000, settings: { ratingRange: 100 } },
    { rating: 1500, settings: {} },
  ), false);
  assert.equal(isCompatible(
    { rating: 1000, settings: { ratingRange: 100 } },
    { rating: 1080, settings: {} },
  ), true);
});

test('isCompatible: partner ratingRange also enforced', () => {
  assert.equal(isCompatible(
    { rating: 2000, settings: {} },
    { rating: 1000, settings: { ratingRange: 100 } },
  ), false);
});

test('tryPair: skips a strict-incompatible partner and reports no match', async () => {
  const db = makeMockDb();
  await joinQueue(db, {
    uid: 'me', mode: 'random-live',
    profile: { rating: 1000 },
    settings: { strict: true, timelimit: true },
    serverTimestamp: 100,
  });
  await joinQueue(db, {
    uid: 'them', mode: 'random-live',
    profile: { rating: 1000 },
    settings: { strict: false, timelimit: false },
    serverTimestamp: 200,
  });
  const r = await tryPair(db, {
    uid: 'me', mode: 'random-live',
    createRoomFromPair: () => { throw new Error('should not be called'); },
  });
  assert.equal(r.matched, false);
});

test('tryPair: rating-range filter skips out-of-range partner', async () => {
  const db = makeMockDb();
  await joinQueue(db, {
    uid: 'me', mode: 'random-live',
    profile: { rating: 1000 }, settings: { ratingRange: 100 },
    serverTimestamp: 100,
  });
  await joinQueue(db, {
    uid: 'far', mode: 'random-live',
    profile: { rating: 1500 }, settings: {},
    serverTimestamp: 200,
  });
  const r = await tryPair(db, {
    uid: 'me', mode: 'random-live',
    createRoomFromPair: () => { throw new Error('should not be called'); },
  });
  assert.equal(r.matched, false);
});

test('tryPair: prefers a compatible partner over an incompatible older one', async () => {
  const db = makeMockDb();
  await joinQueue(db, {
    uid: 'incompat-old', mode: 'random-live',
    profile: { rating: 1000 },
    settings: { strict: true, timelimit: false },
    serverTimestamp: 50,
  });
  await joinQueue(db, {
    uid: 'compat-newer', mode: 'random-live',
    profile: { rating: 1000 },
    settings: { strict: true, timelimit: true },
    serverTimestamp: 200,
  });
  await joinQueue(db, {
    uid: 'me', mode: 'random-live',
    profile: { rating: 1000 },
    settings: { strict: true, timelimit: true },
    serverTimestamp: 300,
  });
  const r = await tryPair(db, {
    uid: 'me', mode: 'random-live',
    createRoomFromPair: async () => ({ roomId: 'r', room: {} }),
  });
  assert.equal(r.matched, true);
  assert.equal(r.partnerUid, 'compat-newer');
});

test('tryPair: simultaneous race — only one client claims the pair', async () => {
  // Regression: previously both clients could "win" tryPair simultaneously,
  // each creating its own room. Both players ended up in different rooms
  // and the coin-toss showed each of them as the starting player on their
  // own client. The transactional claim must guarantee a single winner.
  const db = makeMockDb();
  await joinQueue(db, {
    uid: 'alice', mode: 'random-live',
    profile: { displayName: 'Alice' }, settings: {}, serverTimestamp: 100,
  });
  await joinQueue(db, {
    uid: 'bob', mode: 'random-live',
    profile: { displayName: 'Bob' }, settings: {}, serverTimestamp: 200,
  });

  let createCount = 0;
  const make = (uid) => tryPair(db, {
    uid, mode: 'random-live',
    createRoomFromPair: async (mine, theirs) => {
      createCount += 1;
      return { roomId: `r-${mine.uid}-${theirs.uid}`, room: {} };
    },
  });
  const [a, b] = await Promise.all([make('alice'), make('bob')]);

  const winners = [a, b].filter(r => r.matched);
  assert.equal(winners.length, 1, 'exactly one client must win the pairing race');
  assert.equal(createCount, 1, 'createRoomFromPair must run exactly once');
  // Both queue entries removed.
  assert.equal(db._data.matchmakingQueue['random-live']?.alice ?? null, null);
  assert.equal(db._data.matchmakingQueue['random-live']?.bob ?? null, null);
});

test('tryPair picks the oldest waiting partner', async () => {
  const db = makeMockDb();
  await joinQueue(db, {
    uid: 'old',  mode: 'random-async',
    profile: { displayName: 'Old' }, settings: {}, serverTimestamp: 100,
  });
  await joinQueue(db, {
    uid: 'newer', mode: 'random-async',
    profile: { displayName: 'Newer' }, settings: {}, serverTimestamp: 500,
  });
  await joinQueue(db, {
    uid: 'me', mode: 'random-async',
    profile: { displayName: 'Me' }, settings: {}, serverTimestamp: 1000,
  });
  const r = await tryPair(db, {
    uid: 'me', mode: 'random-async',
    createRoomFromPair: async () => ({ roomId: 'r', room: {} }),
  });
  assert.equal(r.matched, true);
  assert.equal(r.partnerUid, 'old'); // joined earliest
});
