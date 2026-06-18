import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from '../online/mockFirebase.js';
import {
  expectedScore, applyDelta, scoreFromResult,
  applyEloForFinishedGame,
  listTopRatings,
  rankRatings,
  upsertRatingLeaderboardEntry,
  getLeaderboardMeta,
} from './ratingService.js';

test('expectedScore: equal ratings → 0.5', () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
});

test('expectedScore: 400-point gap → ~0.909', () => {
  const v = expectedScore(1400, 1000);
  assert.ok(Math.abs(v - 0.909) < 0.01, `got ${v}`);
});

test('applyDelta: equal-rating win adds half of K', () => {
  const next = applyDelta(1000, 1000, 1.0, 24);
  // K=24, expected=0.5, delta = 24*(1-0.5) = 12
  assert.equal(next, 1012);
});

test('applyDelta: equal-rating loss subtracts half of K', () => {
  assert.equal(applyDelta(1000, 1000, 0.0, 24), 988);
});

test('applyDelta: equal-rating draw is no-op', () => {
  assert.equal(applyDelta(1000, 1000, 0.5, 24), 1000);
});

test('applyDelta: upset win against higher-rated foe gives more points', () => {
  const big   = applyDelta(800, 1200, 1.0, 24);
  const equal = applyDelta(1000, 1000, 1.0, 24);
  assert.ok(big - 800 > equal - 1000);
});

test('scoreFromResult: maps strings', () => {
  assert.equal(scoreFromResult('win'),  1.0);
  assert.equal(scoreFromResult('draw'), 0.5);
  assert.equal(scoreFromResult('loss'), 0.0);
  assert.equal(scoreFromResult('xx'),   null);
});

test('applyEloForFinishedGame: writes ONLY the caller\'s profile + leaderboard entry', async () => {
  // Each client computes its own delta and writes only its own data.
  // The opponent's CURRENT rating is read from globalRatings (public), not
  // from /users/{oppUid}/profile (private to the opponent).
  const db = makeMockDb();
  await db.ref('users/u-me/profile').set({ displayName: 'Me', rating: 1000 });
  await db.ref('users/u-op/profile').set({ displayName: 'Opp', rating: 1000 }); // unreachable in prod
  await db.ref('globalRatings/u-op').set({ uid: 'u-op', name: 'Opp', rating: 1000, updatedAt: 0, avatar: null });

  const r = await applyEloForFinishedGame(db, { myUid: 'u-me', oppUid: 'u-op', result: 'win', now: 1234 });
  assert.equal(r.ok, true);
  assert.equal(r.myAfter,  1012);
  assert.equal(r.oppAfter, 988); // returned for UI; not persisted by this caller

  // My profile + my leaderboard entry are updated.
  assert.equal((await db.ref('users/u-me/profile').get()).val().rating, 1012);
  assert.deepEqual((await db.ref('globalRatings/u-me').get()).val(), {
    uid: 'u-me',
    name: 'Me',
    avatar: null,
    rating: 1012,
    updatedAt: 1234,
  });
  // Opponent's profile + leaderboard entry are NOT touched by this client —
  // the opponent's own client makes the symmetric write on its side.
  assert.equal((await db.ref('users/u-op/profile').get()).val().rating, 1000);
  assert.equal((await db.ref('globalRatings/u-op').get()).val().rating, 1000);
});

test('applyEloForFinishedGame: opponent without a globalRatings entry defaults to RATING_START', async () => {
  // First-ever game for the opponent: globalRatings/{oppUid} doesn't exist yet.
  // The caller should fall back to RATING_START rather than failing.
  const db = makeMockDb();
  await db.ref('users/u-me/profile').set({ displayName: 'Me', rating: 1000 });
  const r = await applyEloForFinishedGame(db, { myUid: 'u-me', oppUid: 'u-op', result: 'win', now: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.oppBefore, 800); // RATING_START (see profileService.js)
  // myBefore=1000, oppBefore=800 → expected ≈ 0.760 → delta ≈ 24 * (1-0.76) ≈ 5.76 → +6
  assert.equal(r.myAfter, 1006);
});

test('rankRatings: sorts by rating and limits results', () => {
  const list = rankRatings({
    a: { name: 'A', rating: 1000, updatedAt: 1 },
    b: { name: 'B', rating: 1200, updatedAt: 1 },
    c: { name: 'C', rating: 1100, updatedAt: 1 },
  }, { limit: 2 });
  assert.deepEqual(list.map(e => e.uid), ['b', 'c']);
});

test('listTopRatings reads and ranks from Firebase', async () => {
  const db = makeMockDb();
  await db.ref('globalRatings').set({
    a: { uid: 'a', name: 'A', rating: 900, updatedAt: 1 },
    b: { uid: 'b', name: 'B', rating: 1300, updatedAt: 1 },
  });
  const list = await listTopRatings(db);
  assert.equal(list[0].uid, 'b');
  assert.equal(list[0].rating, 1300);
});

test('upsertRatingLeaderboardEntry mirrors a profile into globalRatings', async () => {
  const db = makeMockDb();
  await upsertRatingLeaderboardEntry(db, {
    uid: 'u1',
    profile: { displayName: 'Alice', equippedAvatar: 'star', rating: 1111 },
    updatedAt: 10,
  });
  assert.deepEqual((await db.ref('globalRatings/u1').get()).val(), {
    uid: 'u1',
    name: 'Alice',
    avatar: 'star',
    rating: 1111,
    updatedAt: 10,
  });
});

test('applyEloForFinishedGame: missing profile returns no-profile', async () => {
  const db = makeMockDb();
  const r = await applyEloForFinishedGame(db, { myUid: 'u-me', oppUid: 'u-op', result: 'win' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-profile');
});

test('applyEloForFinishedGame: rejects same uid / missing uids / bad result', async () => {
  const db = makeMockDb();
  assert.equal((await applyEloForFinishedGame(db, { myUid: 'a', oppUid: 'a', result: 'win' })).reason, 'same-uid');
  assert.equal((await applyEloForFinishedGame(db, { myUid: 'a',                 result: 'win' })).reason, 'missing-uid');
  await db.ref('users/a/profile').set({ rating: 1000 });
  await db.ref('users/b/profile').set({ rating: 1000 });
  assert.equal((await applyEloForFinishedGame(db, { myUid: 'a', oppUid: 'b', result: 'xx' })).reason, 'bad-result');
});

test('getLeaderboardMeta: returns topUid and totalPlayers', async () => {
  const db = makeMockDb();
  await db.ref('globalRatings').set({
    p1: { uid: 'p1', name: 'Alice', rating: 1500, updatedAt: 1 },
    p2: { uid: 'p2', name: 'Bob',   rating: 1300, updatedAt: 1 },
    p3: { uid: 'p3', name: 'Carol', rating: 1200, updatedAt: 1 },
  });
  const meta = await getLeaderboardMeta(db);
  assert.equal(meta.topUid, 'p1');
  assert.equal(meta.totalPlayers, 3);
});

test('getLeaderboardMeta: returns null topUid and 0 when leaderboard is empty', async () => {
  const db = makeMockDb();
  const meta = await getLeaderboardMeta(db);
  assert.equal(meta.topUid, null);
  assert.equal(meta.totalPlayers, 0);
});
