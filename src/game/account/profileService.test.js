import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from '../online/mockFirebase.js';
import {
  buildInitialProfile, generateUserId, gameResultFor, computeStatsDelta,
  computeLiveGameStatsDelta, isLiveOnlineMode,
  readProfile, watchProfile, updateProfile,
  checkUsernameAvailable, claimUsername,
  lookupUidByUsername, lookupUidByUserId,
  bumpStats, EMPTY_STATS, RATING_START, DEFAULT_AVATAR,
} from './profileService.js';

test('buildInitialProfile: includes defaults', () => {
  const p = buildInitialProfile({ displayName: 'נחום', userId: '123456' });
  assert.equal(p.displayName, 'נחום');
  assert.equal(p.userId, '123456');
  assert.equal(p.equippedAvatar, DEFAULT_AVATAR);
  assert.equal(p.rating, RATING_START);
  assert.deepEqual(p.stats, EMPTY_STATS);
});

test('generateUserId: 6 digits, deterministic with rng', () => {
  let n = 0;
  const rng = () => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6][n++];
  assert.equal(generateUserId(rng), '123456');
});

test('gameResultFor: returns win/loss/draw', () => {
  assert.equal(gameResultFor({ 0: 100, 1: 50 }, 0), 'win');
  assert.equal(gameResultFor({ 0: 50,  1: 100 }, 0), 'loss');
  assert.equal(gameResultFor({ 0: 50,  1: 50 }, 0), 'draw');
});

test('computeStatsDelta: increments gamesPlayed and gamesWon on a win', () => {
  const d = computeStatsDelta({ result: 'win', score: 200, currentStreak: 2, longestStreak: 3, highScore: 150 });
  assert.equal(d.gamesPlayed, 1);
  assert.equal(d.gamesWon,    1);
  assert.equal(d.gamesLost,   0);
  assert.deepEqual(d.currentStreak, { set: 3 });
  assert.deepEqual(d.longestStreak, { max: 3 });
  assert.deepEqual(d.highScore,     { max: 200 });
});

test('computeStatsDelta: a loss resets the streak', () => {
  const d = computeStatsDelta({ result: 'loss', score: 50, currentStreak: 5 });
  assert.deepEqual(d.currentStreak, { set: 0 });
  assert.equal(d.gamesLost, 1);
});

test('isLiveOnlineMode: only live online modes count', () => {
  assert.equal(isLiveOnlineMode('friend-live'), true);
  assert.equal(isLiveOnlineMode('random-live'), true);
  assert.equal(isLiveOnlineMode('friend-async'), false);
  assert.equal(isLiveOnlineMode('offline-solo'), false);
});

test('computeLiveGameStatsDelta: derives live aggregate and rich stats', () => {
  const state = {
    mode: 'friend-live',
    scores: { 0: 70, 1: 55 },
    players: { 0: { uid: 'u1', displayName: 'Me' }, 1: { uid: 'u2', displayName: 'Rival', avatar: 'fire' } },
    bonusAssignment: [{ type: 'B9' }],
    moveHistory: [
      { slot: 1, tiles: [{ r: 2, c: 2, letter: 'א' }], words: ['אב'], score: 30, ts: 1000 },
      { slot: 0, tiles: [{ r: -1, c: 1, letter: 'ש' }, { r: 0, c: 1, letter: 'ם' }], words: ['שלום'], score: 40, ts: 2000 },
      { slot: 0, tiles: [{ r: 1, c: 1, letter: 'ג' }], words: ['גם'], score: 30, ts: 4000 },
    ],
  };
  const d = computeLiveGameStatsDelta({
    state,
    room: { mode: 'friend-live', players: state.players },
    mySlot: 0,
    currentStats: { currentStreak: 2, longestStreak: 2, highScore: 50 },
    now: 10_000,
  });
  assert.equal(d.gamesPlayed, 1);
  assert.equal(d.gamesWon, 1);
  assert.equal(d.totalScore, 70);
  assert.equal(d.wordsPlayed, 2);
  assert.equal(d.totalMoves, 2);
  assert.equal(d.totalTilesPlayed, 3);
  assert.equal(d.bonusesTriggered, 1);
  assert.equal(d.comebackWins, 1);
  assert.equal(d.lastMoveWins, 1);
  assert.deepEqual(d.currentStreak, { set: 3 });
  assert.deepEqual(d.highScore, { max: 70 });
  assert.equal(d.longestWord.set, 'שלום');
  assert.equal(d.boostUsage.set.B9, 1);
  assert.equal(d.recentGames.set.length, 1);
  assert.equal(d.rivalStats.set.u2.won, 1);
});

test('computeLiveGameStatsDelta: excludes async and offline modes', () => {
  const state = { mode: 'friend-async', scores: { 0: 1, 1: 0 }, moveHistory: [] };
  assert.equal(computeLiveGameStatsDelta({ state, mySlot: 0 }), null);
  assert.equal(computeLiveGameStatsDelta({ state: { ...state, mode: 'offline-solo' }, mySlot: 0 }), null);
});

test('computeLiveGameStatsDelta: caps recent games and word counts', () => {
  const currentStats = {
    recentGames: Array.from({ length: 25 }, (_, i) => ({ ts: i, result: 'loss' })),
    wordCounts: Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`w${i}`, i + 1])),
  };
  const state = {
    mode: 'random-live',
    scores: { 0: 10, 1: 10 },
    players: { 0: { uid: 'u1' }, 1: { uid: 'u2' } },
    moveHistory: [{ slot: 0, tiles: [{ r: 0, c: 0, letter: 'א' }], words: ['חדש'], score: 10, ts: 1 }],
  };
  const d = computeLiveGameStatsDelta({ state, room: { mode: 'random-live', players: state.players }, mySlot: 0, currentStats });
  assert.equal(d.recentGames.set.length, 20);
  assert.equal(Object.keys(d.wordCounts.set).length, 30);
});

test('readProfile / updateProfile round-trip', async () => {
  const db = makeMockDb();
  await db.ref('users/u1/profile').set({ displayName: 'נחום', rating: 800 });
  assert.equal((await readProfile(db, 'u1')).displayName, 'נחום');
  await updateProfile(db, 'u1', { equippedAvatar: 'dragon' });
  const p = await readProfile(db, 'u1');
  assert.equal(p.equippedAvatar, 'dragon');
  assert.equal(p.rating, 800);
});

test('readProfile: returns null for unknown uid', async () => {
  const db = makeMockDb();
  assert.equal(await readProfile(db, 'unknown'), null);
});

test('watchProfile fires on writes', async () => {
  const db = makeMockDb();
  const fires = [];
  const off = watchProfile(db, 'u1', (p) => fires.push(p));
  // Initial fire is null
  assert.equal(fires.length, 1);
  await updateProfile(db, 'u1', { displayName: 'דני' });
  assert.equal(fires.length, 2);
  assert.equal(fires.at(-1).displayName, 'דני');
  off();
});

test('checkUsernameAvailable: free name returns available', async () => {
  const db = makeMockDb();
  assert.deepEqual(await checkUsernameAvailable(db, 'נחום'), { available: true });
});

test('checkUsernameAvailable: claimed by other user returns unavailable', async () => {
  const db = makeMockDb();
  await db.ref('usernames/נחום').set('u1');
  const r = await checkUsernameAvailable(db, 'נחום', 'u2');
  assert.equal(r.available, false);
  assert.equal(r.uid, 'u1');
});

test('checkUsernameAvailable: same user is allowed (rename to same)', async () => {
  const db = makeMockDb();
  await db.ref('usernames/נחום').set('u1');
  const r = await checkUsernameAvailable(db, 'נחום', 'u1');
  assert.equal(r.available, true);
  assert.equal(r.ownedBySelf, true);
});

test('claimUsername: writes the name and frees the old one', async () => {
  const db = makeMockDb();
  await db.ref('usernames/old').set('u1');
  await db.ref('users/u1/profile').set({ displayName: 'old' });
  const r = await claimUsername(db, { uid: 'u1', oldName: 'old', newName: 'new' });
  assert.equal(r.ok, true);
  assert.equal((await db.ref('usernames/new').get()).val(), 'u1');
  // Old name is freed
  assert.equal((await db.ref('usernames/old').get()).val(), null);
  // Profile displayName updated
  assert.equal((await db.ref('users/u1/profile').get()).val().displayName, 'new');
});

test('claimUsername: rejects when name is held by another user', async () => {
  const db = makeMockDb();
  await db.ref('usernames/taken').set('u-other');
  const r = await claimUsername(db, { uid: 'u1', newName: 'taken' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'taken');
});

test('claimUsername: idempotent for the same user', async () => {
  const db = makeMockDb();
  await db.ref('usernames/me').set('u1');
  const r = await claimUsername(db, { uid: 'u1', oldName: 'me', newName: 'me' });
  assert.equal(r.ok, true);
});

test('lookupUidByUsername / lookupUidByUserId', async () => {
  const db = makeMockDb();
  await db.ref('usernames/נחום').set('u1');
  await db.ref('userIds/123456').set('u1');
  assert.equal(await lookupUidByUsername(db, 'נחום'),    'u1');
  assert.equal(await lookupUidByUserId(db,   '123456'),  'u1');
  assert.equal(await lookupUidByUsername(db, 'missing'), null);
});

test('bumpStats: increments numeric fields and respects {set,max}', async () => {
  const db = makeMockDb();
  await bumpStats(db, 'u1', { gamesPlayed: 1, gamesWon: 1, currentStreak: { set: 3 }, highScore: { max: 150 } });
  const stats = (await db.ref('users/u1/profile/stats').get()).val();
  assert.equal(stats.gamesPlayed,   1);
  assert.equal(stats.gamesWon,      1);
  assert.equal(stats.currentStreak, 3);
  assert.equal(stats.highScore,     150);
  // Apply a second delta; max should stay at 150 if the new score is lower
  await bumpStats(db, 'u1', { gamesPlayed: 1, highScore: { max: 80 } });
  const stats2 = (await db.ref('users/u1/profile/stats').get()).val();
  assert.equal(stats2.gamesPlayed, 2);
  assert.equal(stats2.highScore,   150);
});

test('bumpStats: can replace bounded rich-stat collections', async () => {
  const db = makeMockDb();
  await bumpStats(db, 'u1', {
    recentGames: { set: [{ result: 'win' }] },
    boostUsage: { set: { B9: 2 } },
  });
  const stats = (await db.ref('users/u1/profile/stats').get()).val();
  assert.deepEqual(stats.recentGames, [{ result: 'win' }]);
  assert.deepEqual(stats.boostUsage, { B9: 2 });
});
