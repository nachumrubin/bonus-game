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
  STARTER_GRANT, DAILY_BASE, DAILY_STREAK_INCREMENT, DAILY_STREAK_CAP,
  normalizeProfileEconomy, bumpCoins, purchaseAvatar,
  computeDailyReward, claimDailyReward, isYesterday, ymd,
  MAX_COIN_BALANCE, clampCoins, clampCoinsBalance,
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
  assert.deepEqual(d.highestMoveScore, { max: 40 });
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

test('computeLiveGameStatsDelta: counts uniqueWordsCount for new words only', () => {
  const baseState = {
    mode: 'friend-live',
    scores: { 0: 30, 1: 20 },
    players: { 0: { uid: 'u1' }, 1: { uid: 'u2' } },
    moveHistory: [
      { slot: 0, tiles: [{ r: 0, c: 0, letter: 'א' }], words: ['שלום', 'גם'], score: 30, ts: 1000 },
    ],
  };
  // No prior word history → both words are new
  const d1 = computeLiveGameStatsDelta({
    state: baseState,
    room: { mode: 'friend-live', players: baseState.players },
    mySlot: 0,
    currentStats: {},
  });
  assert.equal(d1.uniqueWordsCount, 2);

  // One word already seen → only the other counts
  const d2 = computeLiveGameStatsDelta({
    state: baseState,
    room: { mode: 'friend-live', players: baseState.players },
    mySlot: 0,
    currentStats: { wordCounts: { שלום: 3 } },
  });
  assert.equal(d2.uniqueWordsCount, 1);

  // All words already seen → zero new
  const d3 = computeLiveGameStatsDelta({
    state: baseState,
    room: { mode: 'friend-live', players: baseState.players },
    mySlot: 0,
    currentStats: { wordCounts: { שלום: 1, גם: 2 } },
  });
  assert.equal(d3.uniqueWordsCount, 0);
});

test('computeLiveGameStatsDelta: deduplicates repeated words within one game', () => {
  const state = {
    mode: 'random-live',
    scores: { 0: 40, 1: 10 },
    players: { 0: { uid: 'u1' }, 1: { uid: 'u2' } },
    moveHistory: [
      { slot: 0, tiles: [{ r: 0, c: 0, letter: 'א' }], words: ['שלום', 'שלום'], score: 20, ts: 1 },
      { slot: 0, tiles: [{ r: 1, c: 0, letter: 'ב' }], words: ['שלום'], score: 20, ts: 2 },
    ],
  };
  const d = computeLiveGameStatsDelta({
    state,
    room: { mode: 'random-live', players: state.players },
    mySlot: 0,
    currentStats: {},
  });
  // 'שלום' appears 3 times but is only 1 unique new word
  assert.equal(d.uniqueWordsCount, 1);
});

// ── Avatar-store economy ─────────────────────────────────────

test('buildInitialProfile: seeds the economy fields with the starter grant', () => {
  const p = buildInitialProfile({ displayName: 'נחום', userId: '123456' });
  assert.equal(p.coins, STARTER_GRANT);
  assert.deepEqual(p.ownedAvatars, []);
  assert.equal(p.lastLoginDate, null);
  assert.equal(p.loginStreak, 0);
});

test('normalizeProfileEconomy: safe defaults for a legacy profile', () => {
  assert.deepEqual(normalizeProfileEconomy(null), { coins: 0, ownedAvatars: [], lastLoginDate: null, loginStreak: 0 });
  assert.deepEqual(
    normalizeProfileEconomy({ coins: '40', ownedAvatars: ['rare_1'], lastLoginDate: '2026-06-22', loginStreak: 3 }),
    { coins: 40, ownedAvatars: ['rare_1'], lastLoginDate: '2026-06-22', loginStreak: 3 },
  );
  // junk fields → zero/empty
  assert.deepEqual(normalizeProfileEconomy({ coins: -5, ownedAvatars: 'x' }).ownedAvatars, []);
  assert.equal(normalizeProfileEconomy({ coins: -5 }).coins, 0);
});

test('bumpCoins: adds and subtracts atomically, flooring at zero', async () => {
  const db = makeMockDb();
  await updateProfile(db, 'u1', { coins: 100 });
  assert.equal(await bumpCoins(db, 'u1', 50), 150);
  assert.equal(await bumpCoins(db, 'u1', -40), 110);
  assert.equal(await bumpCoins(db, 'u1', -999), 0); // floor
});

test('bumpCoins: clamps the balance at MAX_COIN_BALANCE', async () => {
  const db = makeMockDb();
  await updateProfile(db, 'u1', { coins: MAX_COIN_BALANCE - 100 });
  assert.equal(await bumpCoins(db, 'u1', 5000), MAX_COIN_BALANCE); // capped, not 104,900
});

test('clampCoins: coerces to an in-range integer balance', () => {
  assert.equal(clampCoins(1185490), MAX_COIN_BALANCE);
  assert.equal(clampCoins(-5), 0);
  assert.equal(clampCoins('250'), 250);
  assert.equal(clampCoins(12.9), 12);
  assert.equal(clampCoins(undefined), 0);
});

test('normalizeProfileEconomy: clamps a corrupted (over-cap) balance', () => {
  assert.equal(normalizeProfileEconomy({ coins: 1185490 }).coins, MAX_COIN_BALANCE);
});

test('clampCoinsBalance: pulls an over-cap balance down to the cap; no-op otherwise', async () => {
  const db = makeMockDb();
  await updateProfile(db, 'u1', { coins: 1185490 });
  assert.equal(await clampCoinsBalance(db, 'u1'), MAX_COIN_BALANCE);
  assert.equal((await readProfile(db, 'u1')).coins, MAX_COIN_BALANCE);
  // Already at/under cap → transaction aborts, balance untouched.
  await updateProfile(db, 'u2', { coins: 500 });
  assert.equal(await clampCoinsBalance(db, 'u2'), null); // not committed
  assert.equal((await readProfile(db, 'u2')).coins, 500);
});

test('purchaseAvatar: success deducts coins and records ownership', async () => {
  const db = makeMockDb();
  await updateProfile(db, 'u1', { coins: 500, ownedAvatars: ['rare_1'] });
  // epic costs 700 but the player only has 500 → insufficient, no charge
  const r = await purchaseAvatar(db, 'u1', 'epic_2', 700);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient');

  const r2 = await purchaseAvatar(db, 'u1', 'rare_3', 250);
  assert.equal(r2.ok, true);
  assert.equal(r2.coins, 250);
  assert.deepEqual(r2.ownedAvatars, ['rare_1', 'rare_3']);
  const p = await readProfile(db, 'u1');
  assert.equal(p.coins, 250);
  assert.deepEqual(p.ownedAvatars, ['rare_1', 'rare_3']);
});

test('purchaseAvatar: rejects an already-owned avatar without charging', async () => {
  const db = makeMockDb();
  await updateProfile(db, 'u1', { coins: 1000, ownedAvatars: ['epic_1'] });
  const r = await purchaseAvatar(db, 'u1', 'epic_1', 700);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'already-owned');
  const p = await readProfile(db, 'u1');
  assert.equal(p.coins, 1000); // untouched
});

test('computeDailyReward: first claim, consecutive growth, cap, gap reset, same-day no-op', () => {
  // first ever
  assert.deepEqual(computeDailyReward(null, 0, '2026-06-22'),
    { coinsAwarded: DAILY_BASE, newStreak: 1, alreadyClaimedToday: false });
  // consecutive day → streak 2, base + 1*increment
  assert.deepEqual(computeDailyReward('2026-06-21', 1, '2026-06-22'),
    { coinsAwarded: DAILY_BASE + DAILY_STREAK_INCREMENT, newStreak: 2, alreadyClaimedToday: false });
  // beyond the cap: coins stop growing, streak keeps counting
  const atCap = computeDailyReward('2026-06-21', DAILY_STREAK_CAP + 4, '2026-06-22');
  assert.equal(atCap.coinsAwarded, DAILY_BASE + DAILY_STREAK_INCREMENT * (DAILY_STREAK_CAP - 1));
  assert.equal(atCap.newStreak, DAILY_STREAK_CAP + 5);
  // gap (missed a day) → reset to 1
  assert.deepEqual(computeDailyReward('2026-06-19', 9, '2026-06-22'),
    { coinsAwarded: DAILY_BASE, newStreak: 1, alreadyClaimedToday: false });
  // same day → no-op
  assert.deepEqual(computeDailyReward('2026-06-22', 4, '2026-06-22'),
    { coinsAwarded: 0, newStreak: 4, alreadyClaimedToday: true });
});

test('isYesterday: across month boundary', () => {
  assert.equal(isYesterday('2026-05-31', '2026-06-01'), true);
  assert.equal(isYesterday('2026-06-01', '2026-06-01'), false);
  assert.equal(isYesterday('2026-06-01', '2026-06-03'), false);
});

test('ymd: zero-pads month and day', () => {
  assert.equal(ymd(new Date(2026, 0, 5)), '2026-01-05');
});

test('claimDailyReward: grants once per day, idempotent on a repeat boot', async () => {
  const db = makeMockDb();
  await updateProfile(db, 'u1', { coins: 0, lastLoginDate: null, loginStreak: 0 });
  const first = await claimDailyReward(db, 'u1', '2026-06-22');
  assert.equal(first.coinsAwarded, DAILY_BASE);
  assert.equal(first.newStreak, 1);
  let p = await readProfile(db, 'u1');
  assert.equal(p.coins, DAILY_BASE);
  assert.equal(p.lastLoginDate, '2026-06-22');

  // Second call same day must not double-grant.
  const again = await claimDailyReward(db, 'u1', '2026-06-22');
  assert.equal(again.alreadyClaimedToday, true);
  assert.equal(again.coinsAwarded, 0);
  p = await readProfile(db, 'u1');
  assert.equal(p.coins, DAILY_BASE); // unchanged

  // Next day → streak 2, larger reward.
  const day2 = await claimDailyReward(db, 'u1', '2026-06-23');
  assert.equal(day2.newStreak, 2);
  assert.equal(day2.coinsAwarded, DAILY_BASE + DAILY_STREAK_INCREMENT);
});
