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
  normalizeProfileEconomy,
  computeDailyReward, dailyCoinsForDay, dailyWeek, isYesterday, ymd,
  MAX_COIN_BALANCE, clampCoins, bumpBoostieXp,
} from './profileService.js';
import { xpForGame, LEVEL_XP } from './boostieXp.js';

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

test('computeLiveGameStatsDelta: excludes offline/bot modes only (async now counts)', () => {
  const base = { scores: { 0: 1, 1: 0 }, moveHistory: [] };
  assert.equal(computeLiveGameStatsDelta({ state: { ...base, mode: 'offline-solo' }, mySlot: 0 }), null);
  assert.equal(computeLiveGameStatsDelta({ state: { ...base, mode: 'offline-2p' }, mySlot: 0 }), null);
  // Async is no longer excluded.
  assert.ok(computeLiveGameStatsDelta({ state: { ...base, mode: 'friend-async' }, mySlot: 0 }));
});

// July 2026: async friend games must count toward stats + recent games. They
// were previously dropped entirely.
test('computeLiveGameStatsDelta: records an async game (win, recent-games, rivals)', () => {
  const state = {
    mode: 'friend-async',
    scores: { 0: 478, 1: 395 },
    players: { 0: { uid: 'me', displayName: 'Me' }, 1: { uid: 'opp', displayName: 'Opp' } },
    moveHistory: [
      { slot: 0, tiles: [{ r: 4, c: 4, letter: 'א' }], words: ['אב'], score: 12, ts: 1_000 },
      // A day later — realistic async gap.
      { slot: 1, tiles: [{ r: 5, c: 5, letter: 'ג' }], words: ['גד'], score: 8, ts: 86_400_000 },
    ],
  };
  const d = computeLiveGameStatsDelta({
    state,
    room: { mode: 'friend-async', players: state.players },
    mySlot: 0,
    result: 'win',
    currentStats: {},
    now: 90_000_000,
  });
  assert.ok(d, 'async game produces a stats delta');
  assert.equal(d.gamesPlayed, 1);
  assert.equal(d.gamesWon, 1);
  assert.equal(d.totalScore, 478);
  assert.equal(d.recentGames.set.length, 1, 'the async game lands in recent games');
  assert.equal(d.recentGames.set[0].mode, 'friend-async');
  assert.equal(d.rivalStats.set.opp.won, 1);
  // Wall-clock stats must NOT be polluted by the multi-day span.
  assert.equal(d.fastestWinMs.set, 0, 'async duration does not set a fastest-win');
  assert.deepEqual(d.moveSpeedStats.set, {}, 'async carries no botTime, so no move-speed bucket');
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
  assert.equal(p.ownedAvatars, undefined);
  assert.equal(p.lastLoginDate, null);
  assert.equal(p.loginStreak, 0);
});

test('normalizeProfileEconomy: safe defaults for a legacy profile', () => {
  assert.deepEqual(normalizeProfileEconomy(null), { coins: 0, lastLoginDate: null, loginStreak: 0 });
  assert.deepEqual(
    normalizeProfileEconomy({ coins: '40', lastLoginDate: '2026-06-22', loginStreak: 3 }),
    { coins: 40, lastLoginDate: '2026-06-22', loginStreak: 3 },
  );
  // junk fields → zero/empty
  assert.equal(normalizeProfileEconomy({ coins: -5 }).coins, 0);
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

test('dailyCoinsForDay: same curve as computeDailyReward, capped', () => {
  assert.equal(dailyCoinsForDay(1), DAILY_BASE);
  assert.equal(dailyCoinsForDay(4), DAILY_BASE + DAILY_STREAK_INCREMENT * 3);
  assert.equal(dailyCoinsForDay(99), DAILY_BASE + DAILY_STREAK_INCREMENT * (DAILY_STREAK_CAP - 1));
  assert.equal(dailyCoinsForDay(0), DAILY_BASE);
});

test('dailyWeek: 7 entries with got / today / next relative to the streak', () => {
  const w = dailyWeek(4);
  assert.equal(w.length, 7);
  assert.deepEqual(w.map((d) => d.state), ['got', 'got', 'got', 'today', 'next', 'next', 'next']);
  assert.deepEqual(w.map((d) => d.n), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(w[3].coins, DAILY_BASE + DAILY_STREAK_INCREMENT * 3);
});

test('dailyWeek: the window rolls after day 7', () => {
  const w = dailyWeek(9);
  assert.equal(w[0].n, 8);
  assert.equal(w[1].state, 'today');
  assert.equal(dailyWeek(7)[6].state, 'today');
  assert.equal(dailyWeek(1)[0].state, 'today');
});

// ── Boosties ────────────────────────────────────────────────────────────────

test('buildInitialProfile: owns every starter Boostie at level 1, no reactions bought', () => {
  const p = buildInitialProfile({ displayName: 'x', userId: '1' });
  assert.deepEqual(p.boosties, { zapi: { xp: 0, level: 1 }, bubo: { xp: 0, level: 1 } });
  assert.deepEqual(p.ownedReactions, []);
});

test('bumpBoostieXp: adds game XP to the equipped Boostie', async () => {
  const db = makeMockDb();
  await updateProfile(db, 'u1', { boosties: { zapi: { xp: 0, level: 1 } } });
  const r = await bumpBoostieXp(db, 'u1', 'zapi', 'win');
  assert.equal(r.ok, true);
  assert.equal(r.gained, xpForGame('win'));
  assert.equal(r.levelUp, null);
  const stored = (await db.ref('users/u1/profile/boosties').get()).val();
  assert.deepEqual(stored.zapi, { xp: xpForGame('win'), level: 1 });
});

test('bumpBoostieXp: works on a legacy profile without boosties', async () => {
  const db = makeMockDb();
  await updateProfile(db, 'u1', { coins: 5 });
  const r = await bumpBoostieXp(db, 'u1', 'common_17', 'loss');
  assert.equal(r.ok, true);
  assert.equal(r.boosties.zapi.xp, xpForGame('loss'));
});

test('bumpBoostieXp: the level-up is reported', async () => {
  const db = makeMockDb();
  await updateProfile(db, 'u1', { boosties: { zapi: { xp: LEVEL_XP[6] - 1, level: 6 } } });
  const r = await bumpBoostieXp(db, 'u1', 'zapi', 'loss');
  assert.deepEqual(r.levelUp, { id: 'zapi', from: 6, to: 7 });
  assert.equal(r.unlocked, null); // no locked Boosties yet: both are starters
});

test('bumpBoostieXp: an unfinished game writes nothing', async () => {
  const db = makeMockDb();
  await updateProfile(db, 'u1', { boosties: { zapi: { xp: 7, level: 1 } } });
  const r = await bumpBoostieXp(db, 'u1', 'zapi', 'abandoned');
  assert.equal(r.ok, false);
  assert.equal((await db.ref('users/u1/profile/boosties/zapi/xp').get()).val(), 7);
});

test('DEFAULT_AVATAR is the starter Boostie', () => {
  assert.equal(DEFAULT_AVATAR, 'zapi');
});

