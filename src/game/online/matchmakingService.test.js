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

test('isCompatible: BOTH strict + same timelimit but mismatched botTime → incompatible', () => {
  // Regression: both players ticked "חיפוש מדויק" but one chose בזק (20s) and
  // the other רגיל (40s). Both are live so `timelimit` matched on each side;
  // the speed must be compared too when both are strict.
  assert.equal(isCompatible(
    { rating: 1000, settings: { strict: true, timelimit: true, botTime: 20 } },
    { rating: 1000, settings: { strict: true, timelimit: true, botTime: 40 } },
  ), false);
});

test('isCompatible: ONE strict + mismatched botTime → compatible (flexible adopts strict speed)', () => {
  // Player 1 strict + רגיל (40), player 2 flexible + בזק (20). They pair — the
  // flexible side adopts the strict side's speed (resolved in createRoomForPair).
  assert.equal(isCompatible(
    { rating: 1000, settings: { strict: true,  timelimit: true, botTime: 40 } },
    { rating: 1000, settings: { strict: false, timelimit: true, botTime: 20 } },
  ), true);
  // Order-independent.
  assert.equal(isCompatible(
    { rating: 1000, settings: { strict: false, timelimit: true, botTime: 20 } },
    { rating: 1000, settings: { strict: true,  timelimit: true, botTime: 40 } },
  ), true);
});

test('isCompatible: strict + same timelimit and same botTime → compatible', () => {
  assert.equal(isCompatible(
    { rating: 1000, settings: { strict: true, timelimit: true, botTime: 40 } },
    { rating: 1000, settings: { strict: true, timelimit: true, botTime: 40 } },
  ), true);
});

test('isCompatible: neither strict + mismatched botTime → compatible', () => {
  assert.equal(isCompatible(
    { rating: 1000, settings: { strict: false, timelimit: true, botTime: 20 } },
    { rating: 1000, settings: { strict: false, timelimit: true, botTime: 40 } },
  ), true);
});

test('isCompatible: neither strict + mismatched timelimit → compatible', () => {
  assert.equal(isCompatible(
    { rating: 1000, settings: { strict: false, timelimit: true  } },
    { rating: 1000, settings: { strict: false, timelimit: false } },
  ), true);
});

test('isCompatible: a STRICT ratingRange hard-filters an out-of-range partner', () => {
  assert.equal(isCompatible(
    { rating: 1000, settings: { strict: true, ratingRange: 100 } },
    { rating: 1500, settings: {} },
  ), false);
  assert.equal(isCompatible(
    { rating: 1000, settings: { strict: true, ratingRange: 100 } },
    { rating: 1080, settings: {} },
  ), true);
});

test('isCompatible: a strict partner ratingRange is also enforced', () => {
  assert.equal(isCompatible(
    { rating: 2000, settings: {} },
    { rating: 1000, settings: { strict: true, ratingRange: 100 } },
  ), false);
});

test('isCompatible: a FLEXIBLE ratingRange does NOT hard-filter (it is only a preference)', () => {
  // Flexible player with a ±100 preference still accepts a far-off opponent —
  // the range only ranks candidates (matchDistance), it does not block.
  assert.equal(isCompatible(
    { rating: 1000, settings: { strict: false, ratingRange: 100 } },
    { rating: 1500, settings: {} },
  ), true);
  assert.equal(isCompatible(
    { rating: 2000, settings: {} },
    { rating: 1000, settings: { strict: false, ratingRange: 100 } },
  ), true);
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

test('tryPair: a STRICT rating-range filter skips an out-of-range partner', async () => {
  const db = makeMockDb();
  await joinQueue(db, {
    uid: 'me', mode: 'random-live',
    profile: { rating: 1000 }, settings: { strict: true, ratingRange: 100 },
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

test('tryPair: a FLEXIBLE searcher still pairs with an out-of-range partner', async () => {
  const db = makeMockDb();
  await joinQueue(db, {
    uid: 'aaa', mode: 'random-live',
    profile: { rating: 1000 }, settings: { strict: false, ratingRange: 100 },
    serverTimestamp: 100,
  });
  await joinQueue(db, {
    uid: 'zzz-far', mode: 'random-live',
    profile: { rating: 1500 }, settings: {},
    serverTimestamp: 200,
  });
  const r = await tryPair(db, {
    uid: 'aaa', mode: 'random-live',
    createRoomFromPair: async () => ({ roomId: 'r', room: {} }),
  });
  assert.equal(r.matched, true);
  assert.equal(r.partnerUid, 'zzz-far');
});

test('tryPair: a flexible searcher prefers the CLOSEST candidate (same speed, then nearest rating)', async () => {
  const db = makeMockDb();
  // I am flexible, רגיל (40), rating 1000.
  await joinQueue(db, {
    uid: 'aaa-me', mode: 'random-live',
    profile: { rating: 1000 }, settings: { strict: false, timelimit: true, botTime: 40 },
    serverTimestamp: 300,
  });
  // Oldest candidate: same rating but DIFFERENT speed (בזק). Acceptable but not closest.
  await joinQueue(db, {
    uid: 'zzz-fast', mode: 'random-live',
    profile: { rating: 1000 }, settings: { strict: false, timelimit: true, botTime: 20 },
    serverTimestamp: 100,
  });
  // Newer candidate: SAME speed (רגיל), slightly farther rating. Should win on speed.
  await joinQueue(db, {
    uid: 'zzz-same', mode: 'random-live',
    profile: { rating: 1150 }, settings: { strict: false, timelimit: true, botTime: 40 },
    serverTimestamp: 200,
  });
  const r = await tryPair(db, {
    uid: 'aaa-me', mode: 'random-live',
    createRoomFromPair: async (_mine, theirs) => ({ roomId: `r-${theirs.uid}`, room: {} }),
  });
  assert.equal(r.matched, true);
  assert.equal(r.partnerUid, 'zzz-same', 'same-speed partner preferred over an older different-speed one');
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
    // Higher uid than 'me' so 'me' is the driver (lower uid drives the claim).
    uid: 'z-compat-newer', mode: 'random-live',
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
  assert.equal(r.partnerUid, 'z-compat-newer');
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

test('tryPair: the higher-uid side waits (does not create a room)', async () => {
  const db = makeMockDb();
  await joinQueue(db, {
    uid: 'aaa', mode: 'random-live',
    profile: { displayName: 'A' }, settings: {}, serverTimestamp: 100,
  });
  await joinQueue(db, {
    uid: 'zzz', mode: 'random-live',
    profile: { displayName: 'Z' }, settings: {}, serverTimestamp: 200,
  });
  // 'zzz' picks 'aaa' but must NOT drive (it's the higher uid); it waits for
  // its activeRoom instead. Both entries stay until the lower side claims.
  const r = await tryPair(db, {
    uid: 'zzz', mode: 'random-live',
    createRoomFromPair: async () => { throw new Error('higher uid must not create a room'); },
  });
  assert.equal(r.matched, false);
  assert.ok(db._data.matchmakingQueue['random-live']?.aaa, 'partner still queued');
  assert.ok(db._data.matchmakingQueue['random-live']?.zzz, 'waiter still queued');
});

test('tryPair: two searchers who both pick the same higher-uid partner do not double-book it', async () => {
  // Regression for the 3-player race: with a single-shared-node claim, both
  // 'aaa' and 'bbb' (each lower than the partner) claimed their OWN nodes and
  // both created a room with 'zzz-partner', double-booking it — the third
  // player ended up in a coin toss with a phantom opponent.
  const db = makeMockDb();
  // Partner is the OLDEST (so both others pick it) AND the highest uid.
  await joinQueue(db, {
    uid: 'zzz-partner', mode: 'random-live',
    profile: { displayName: 'P' }, settings: {}, serverTimestamp: 50,
  });
  await joinQueue(db, {
    uid: 'aaa', mode: 'random-live',
    profile: { displayName: 'A' }, settings: {}, serverTimestamp: 100,
  });
  await joinQueue(db, {
    uid: 'bbb', mode: 'random-live',
    profile: { displayName: 'B' }, settings: {}, serverTimestamp: 150,
  });

  let createCount = 0;
  const make = (uid) => tryPair(db, {
    uid, mode: 'random-live',
    createRoomFromPair: async (mine, theirs) => {
      createCount += 1;
      return { roomId: `r-${mine.uid}`, room: {}, _theirs: theirs.uid };
    },
  });
  const [ra, rb] = await Promise.all([make('aaa'), make('bbb')]);

  const matched = [ra, rb].filter(r => r.matched);
  assert.equal(matched.length, 1, 'only one room may claim the shared partner');
  assert.equal(createCount, 1, 'createRoomFromPair runs exactly once');
  assert.equal(matched[0].partnerUid, 'zzz-partner');
  // Partner claimed exactly once; the loser rolled itself back for a retry.
  assert.equal(db._data.matchmakingQueue['random-live']?.['zzz-partner'] ?? null, null);
  const loserUid = ra.matched ? 'bbb' : 'aaa';
  assert.ok(db._data.matchmakingQueue['random-live']?.[loserUid], 'loser re-queued for retry');
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
