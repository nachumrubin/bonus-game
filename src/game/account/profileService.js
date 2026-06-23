// Profile service.
//
// Wraps Firebase reads/writes for `users/{uid}/profile` plus the two
// uniqueness indexes the legacy app already maintains:
//   - usernames/{lowercaseDisplayName} → uid
//   - userIds/{userId}                 → uid  (numeric short ID)
//
// Every async function takes `db` so tests inject mockFirebase.

import * as bus from '../../events/bus.js';
import { BDEFS, BONUS_TYPES } from '../boosts/data.js';

export const PATH = Object.freeze({
  users:     'users',
  usernames: 'usernames',
  userIds:   'userIds',
});

export const PROFILE_EVT = Object.freeze({
  CHANGED:        'profile/changed',
  STATS_CHANGED:  'profile/statsChanged',
  AVATAR_UNLOCK:  'profile/avatarUnlock',
});

export const DEFAULT_AVATAR = 'crown';
export const RATING_START   = 800;

// ── Avatar-store economy (coins) ──────────────────────────────────────────
// All tunable. "Grindy / prestige" tuning — a legendary avatar is a long-haul
// goal. Coins are earned three ways: a one-time starter grant on sign-up, a
// daily login + consecutive-day streak bonus, and achievement completions.
// Spent in the avatar store (src/ui/screens/avatarStore.js). These live at the
// profile root (siblings of `rating`/`stats`), never inside `stats`.
export const STARTER_GRANT          = 150;
export const DAILY_BASE             = 20;
export const DAILY_STREAK_INCREMENT = 10;
export const DAILY_STREAK_CAP       = 10; // streak-day after which the daily bonus stops growing
export const ACHIEVEMENT_COIN_REWARD = Object.freeze({
  bronze: 50, silver: 100, gold: 250, legend: 750,
});

export const EMPTY_STATS = Object.freeze({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, gamesDraw: 0,
  highScore: 0, totalScore: 0, currentStreak: 0, longestStreak: 0,
  highestMoveScore: 0,
  bonusesTriggered: 0, wordsPlayed: 0,
  totalMoves: 0, totalTilesPlayed: 0, totalMoveTimeMs: 0,
  comebackWins: 0, lastMoveWins: 0, closeWins: 0,
  boostImpactWins: 0,
  fastestWinMs: 0, longestWord: '', longestWordLength: 0,
  friendsCount: 0, uniqueWordsCount: 0, beatNumberOne: 0, invitesSent: 0,
  wordsAccepted: 0,
  recentGames: [], boostUsage: {}, rivalStats: {}, wordCounts: {}, weekdayStats: {},
  moveSpeedStats: {}, startingLetterCounts: {},
});

function profileRef(db, uid)     { return db.ref(`${PATH.users}/${uid}/profile`); }
function statsRef(db, uid)       { return db.ref(`${PATH.users}/${uid}/profile/stats`); }
function usernameRef(db, name)   { return db.ref(`${PATH.usernames}/${name.toLowerCase()}`); }
function userIdRef(db, userId)   { return db.ref(`${PATH.userIds}/${userId}`); }

// Build a fresh profile object. Pure.
export function buildInitialProfile({ displayName, userId, avatar = DEFAULT_AVATAR } = {}) {
  return {
    userId,
    displayName,
    equippedAvatar: avatar,
    rating: RATING_START,
    stats: { ...EMPTY_STATS },
    // Avatar-store economy. A new player starts with the one-time grant so the
    // store feels reachable from day one. `ownedAvatars` holds purchased store
    // ids only (common store avatars are free / implicitly owned).
    coins: STARTER_GRANT,
    ownedAvatars: [],
    lastLoginDate: null, // 'YYYY-MM-DD' of the last claimed daily reward
    loginStreak: 0,
    createdAt: Date.now(),
  };
}

// Pure: safe-read the economy fields from a (possibly legacy) profile that may
// predate this feature. Use this everywhere economy state is consumed.
export function normalizeProfileEconomy(profile) {
  return {
    coins: Math.max(0, Math.floor(Number(profile?.coins) || 0)),
    ownedAvatars: Array.isArray(profile?.ownedAvatars) ? profile.ownedAvatars.slice() : [],
    lastLoginDate: typeof profile?.lastLoginDate === 'string' ? profile.lastLoginDate : null,
    loginStreak: Math.max(0, Math.floor(Number(profile?.loginStreak) || 0)),
  };
}

// Generate a 6-digit numeric userId. Pure (rng injectable).
export function generateUserId(rng = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += Math.floor(rng() * 10);
  return s;
}

// Read once. Returns null if no profile exists.
export async function readProfile(db, uid) {
  if (!uid) return null;
  const snap = await profileRef(db, uid).get();
  return snap?.val ? snap.val() : null;
}

// Live subscription. cb(profile) fires on every write. Returns unsubscribe.
export function watchProfile(db, uid, cb) {
  if (!uid) { cb(null); return () => {}; }
  const ref = profileRef(db, uid);
  const handler = (snap) => cb(snap?.val ? snap.val() : null);
  ref.on('value', handler);
  return () => ref.off('value', handler);
}

// Update (merge) the user's profile. Used for display-name edits, avatar
// equip, customPhoto, etc. Validation lives in the caller — this just
// writes.
export async function updateProfile(db, uid, patch) {
  if (!uid) throw new Error('updateProfile: uid required');
  await profileRef(db, uid).update(patch);
  bus.emit(PROFILE_EVT.CHANGED, { uid, patch });
}

// Username uniqueness check. Returns { available: bool, uid?: string }.
// `available=true` means no other user has claimed this name (or YOU
// already own it).
export async function checkUsernameAvailable(db, name, ownUid) {
  if (!name) return { available: false, reason: 'empty' };
  const snap = await usernameRef(db, name).get();
  const claimed = snap?.val ? snap.val() : null;
  if (!claimed) return { available: true };
  if (claimed === ownUid) return { available: true, ownedBySelf: true };
  return { available: false, uid: claimed };
}

// Atomically claim a username. Returns { ok, reason? }.
//
// Implementation note: we use a transaction on usernames/{name} so
// concurrent claims fail safely. On success, also writes the new name to
// the profile.
export async function claimUsername(db, { uid, oldName, newName }) {
  if (!uid)     return { ok: false, reason: 'no-uid' };
  if (!newName) return { ok: false, reason: 'no-name' };
  const lc = newName.toLowerCase();
  const result = await usernameRef(db, lc).transaction((current) => {
    if (current && current !== uid) return; // already taken
    return uid;
  });
  if (!result?.committed) return { ok: false, reason: 'taken' };
  // Free old name
  if (oldName && oldName.toLowerCase() !== lc) {
    try {
      const oldRef = usernameRef(db, oldName);
      const oldVal = await oldRef.get();
      if ((oldVal?.val ? oldVal.val() : null) === uid) await oldRef.remove();
    } catch (e) { console.warn('[profileService.claimUsername] release old', e); }
  }
  await profileRef(db, uid).update({ displayName: newName });
  return { ok: true };
}

// Resolve a display name → uid. Used by friend-search.
export async function lookupUidByUsername(db, name) {
  if (!name) return null;
  const snap = await usernameRef(db, name).get();
  return snap?.val ? snap.val() : null;
}

// Resolve a 6-digit userId → uid.
export async function lookupUidByUserId(db, userId) {
  if (!userId) return null;
  const snap = await userIdRef(db, userId).get();
  return snap?.val ? snap.val() : null;
}

// Apply a stats delta atomically. `delta` is an object whose entries are
// added to the current value. Used after every game-end to bump
// gamesPlayed / gamesWon / etc.
export async function bumpStats(db, uid, delta) {
  if (!uid || !delta) return null;
  const result = await statsRef(db, uid).transaction((current) => {
    const base = current ?? { ...EMPTY_STATS };
    const next = { ...base };
    for (const [k, v] of Object.entries(delta)) {
      if (typeof v === 'number') next[k] = (base[k] ?? 0) + v;
      else if (v?.set != null) next[k] = v.set; // explicit override
      else if (v?.max != null) next[k] = Math.max(base[k] ?? 0, v.max);
    }
    return next;
  });
  if (result?.committed) {
    bus.emit(PROFILE_EVT.STATS_CHANGED, { uid, stats: result.snapshot?.val?.() ?? null });
  }
  return result?.snapshot?.val?.() ?? null;
}

// ── Avatar-store economy I/O ──────────────────────────────────────────────

// Add (or subtract, for spends) coins atomically. Floors at zero. Emits
// PROFILE_EVT.CHANGED. Returns the new balance, or null on no-op.
export async function bumpCoins(db, uid, amount) {
  if (!uid || !amount) return null;
  const ref = db.ref(`${PATH.users}/${uid}/profile/coins`);
  const result = await ref.transaction((current) => Math.max(0, (current ?? 0) + amount));
  if (result?.committed) {
    bus.emit(PROFILE_EVT.CHANGED, { uid, patch: { coins: result.snapshot?.val?.() ?? null } });
  }
  return result?.snapshot?.val?.() ?? null;
}

// Atomically purchase a store avatar: verify it isn't already owned and the
// player can afford it, then deduct coins and append to ownedAvatars in a
// single transaction on the whole profile node (so coins-check and append
// can't race). `price` should come from the catalog (priceFor(id)), never a
// client-supplied value. Returns { ok, reason?, coins, ownedAvatars }.
export async function purchaseAvatar(db, uid, avatarId, price) {
  if (!uid)      return { ok: false, reason: 'no-uid' };
  if (!avatarId) return { ok: false, reason: 'no-avatar' };
  const cost = Math.max(0, Math.floor(Number(price) || 0));
  let reason = null;
  const result = await profileRef(db, uid).transaction((p) => {
    if (!p) { reason = 'no-profile'; return; }
    const owned = Array.isArray(p.ownedAvatars) ? p.ownedAvatars : [];
    if (owned.includes(avatarId)) { reason = 'already-owned'; return; }
    const coins = Number(p.coins) || 0;
    if (coins < cost) { reason = 'insufficient'; return; }
    return { ...p, coins: coins - cost, ownedAvatars: [...owned, avatarId] };
  });
  if (result?.committed) {
    const v = result.snapshot?.val?.() ?? null;
    bus.emit(PROFILE_EVT.CHANGED, { uid, patch: { coins: v?.coins, ownedAvatars: v?.ownedAvatars } });
    return { ok: true, coins: v?.coins ?? 0, ownedAvatars: v?.ownedAvatars ?? [] };
  }
  const snap = result?.snapshot?.val?.() ?? null;
  return {
    ok: false,
    reason: reason ?? 'aborted',
    coins: Number(snap?.coins) || 0,
    ownedAvatars: Array.isArray(snap?.ownedAvatars) ? snap.ownedAvatars : [],
  };
}

// Pure: format a Date as a local 'YYYY-MM-DD' string (the daily-reward key).
export function ymd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Pure: is `prev` ('YYYY-MM-DD') exactly one calendar day before `today`?
export function isYesterday(prev, today) {
  if (!prev || !today) return false;
  const p = new Date(`${prev}T00:00:00`);
  const t = new Date(`${today}T00:00:00`);
  if (Number.isNaN(p.getTime()) || Number.isNaN(t.getTime())) return false;
  return Math.round((t - p) / 86400000) === 1;
}

// Pure: given the last claim date + current streak, what daily reward (if any)
// is owed today? Consecutive day → streak+1; any gap or first-ever → 1; same
// day → no-op. The streak keeps growing for display, but the coin bonus is
// capped at DAILY_STREAK_CAP days.
export function computeDailyReward(lastLoginDate, loginStreak, today) {
  const streak = Math.max(0, Math.floor(Number(loginStreak) || 0));
  if (lastLoginDate === today) {
    return { coinsAwarded: 0, newStreak: streak, alreadyClaimedToday: true };
  }
  const newStreak = isYesterday(lastLoginDate, today) ? streak + 1 : 1;
  const cappedDay = Math.min(newStreak, DAILY_STREAK_CAP);
  const coinsAwarded = DAILY_BASE + DAILY_STREAK_INCREMENT * (cappedDay - 1);
  return { coinsAwarded, newStreak, alreadyClaimedToday: false };
}

// Claim today's daily login reward. Idempotent within a day via the
// same-day guard INSIDE the transaction (two boots can't double-grant).
// Returns { coinsAwarded, newStreak, alreadyClaimedToday }.
export async function claimDailyReward(db, uid, today = ymd()) {
  if (!uid) return { coinsAwarded: 0, newStreak: 0, alreadyClaimedToday: false };
  let outcome = { coinsAwarded: 0, newStreak: 0, alreadyClaimedToday: false };
  const result = await profileRef(db, uid).transaction((p) => {
    if (!p) return; // no profile yet — nothing to claim
    const res = computeDailyReward(p.lastLoginDate ?? null, p.loginStreak ?? 0, today);
    outcome = res;
    if (res.alreadyClaimedToday) return; // abort — no write
    return {
      ...p,
      coins: (Number(p.coins) || 0) + res.coinsAwarded,
      lastLoginDate: today,
      loginStreak: res.newStreak,
    };
  });
  if (result?.committed) {
    const v = result.snapshot?.val?.() ?? null;
    bus.emit(PROFILE_EVT.CHANGED, {
      uid,
      patch: { coins: v?.coins, lastLoginDate: v?.lastLoginDate, loginStreak: v?.loginStreak },
    });
  }
  return outcome;
}

// Pure: derive the result label ('win'/'loss'/'draw') from a finished
// game's slot scores and the player's slot.
export function gameResultFor(scores, mySlot) {
  const my  = scores?.[mySlot] ?? 0;
  const opp = scores?.[1 - mySlot] ?? 0;
  if (my > opp)  return 'win';
  if (my < opp)  return 'loss';
  return 'draw';
}

// Pure: compute the stats delta from a finished game.
export function computeStatsDelta({ result, score, currentStreak = 0, longestStreak = 0, highScore = 0, bonusesTriggered = 0, wordsPlayed = 0 }) {
  const isWin  = result === 'win';
  const isLoss = result === 'loss';
  const isDraw = result === 'draw';
  const newStreak = isWin ? (currentStreak + 1) : 0;
  return {
    gamesPlayed: 1,
    gamesWon:    isWin  ? 1 : 0,
    gamesLost:   isLoss ? 1 : 0,
    gamesDraw:   isDraw ? 1 : 0,
    totalScore:  score ?? 0,
    bonusesTriggered: bonusesTriggered,
    wordsPlayed: wordsPlayed,
    currentStreak: { set: newStreak },
    longestStreak: { max: Math.max(longestStreak, newStreak) },
    highScore:     { max: Math.max(highScore,    score ?? 0) },
  };
}

export function isLiveOnlineMode(mode) {
  return typeof mode === 'string' && mode.endsWith('-live');
}

export function computeLiveGameStatsDelta({
  state,
  room,
  mySlot,
  result: overrideResult = null,
  currentStats = {},
  now = Date.now(),
  botTime = null,
} = {}) {
  const mode = room?.mode ?? state?.mode;
  if (!state || !isLiveOnlineMode(mode)) return null;
  if (mySlot !== 0 && mySlot !== 1) return null;

  const scores = state.scores ?? {};
  const myScore = Number(scores?.[mySlot]) || 0;
  const oppScore = Number(scores?.[1 - mySlot]) || 0;
  // Use the authoritative winnerSlot-based result when the caller supplies it
  // (ensures history matches ELO direction). Fall back to score comparison only
  // when no explicit result is provided (offline / test contexts).
  const result = (overrideResult === 'win' || overrideResult === 'loss' || overrideResult === 'draw')
    ? overrideResult
    : (myScore > oppScore ? 'win' : myScore < oppScore ? 'loss' : 'draw');

  const moves = Array.isArray(state.moveHistory) ? state.moveHistory : [];
  const myMoves = moves.filter(m => (m?.slot === mySlot) && Array.isArray(m.tiles));
  const words = myMoves.flatMap(m => Array.isArray(m.words) ? m.words.filter(Boolean).map(String) : []);
  const tileCount = myMoves.reduce((sum, m) => sum + (Array.isArray(m.tiles) ? m.tiles.length : 0), 0);
  const boostHits = collectBoostHits(myMoves, state);
  const bonusCount = boostHits.length;
  const boostUsage = mergeBoostUsage(currentStats.boostUsage, boostHits);
  const wordStats = mergeWordStats(currentStats, words);
  const prevWordCounts = currentStats.wordCounts ?? {};
  const newUniqueWords = new Set(words.filter(w => w && !(w in prevWordCounts))).size;
  const recentGames = appendRecentGame(currentStats.recentGames, {
    ts: now,
    mode,
    result,
    score: myScore,
    opponentScore: oppScore,
    bonusesTriggered: bonusCount,
    opponentUid: opponentFor(state, room, mySlot)?.uid ?? null,
    opponentName: opponentFor(state, room, mySlot)?.displayName ?? null,
  });
  const rivalStats = mergeRivalStats(currentStats.rivalStats, opponentFor(state, room, mySlot), result, myScore, oppScore);
  const weekdayStats = mergeWeekdayStats(currentStats.weekdayStats, now, result, myScore);
  const moveSpeedStats = mergeMoveSpeedStats(currentStats.moveSpeedStats, botTime, result);

  const currentStreak = Number(currentStats.currentStreak) || 0;
  const longestStreak = Number(currentStats.longestStreak) || 0;
  const highScore = Number(currentStats.highScore) || 0;
  const prevHighestMoveScore = Number(currentStats.highestMoveScore) || 0;
  const bestMoveScore = myMoves.reduce((max, m) => Math.max(max, Number(m?.score) || 0), 0);
  const newStreak = result === 'win' ? currentStreak + 1 : 0;
  const gameDurationMs = gameDurationFromMoves(moves);
  const fastestWinMs = result === 'win' && gameDurationMs > 0
    ? fastestPositive(Number(currentStats.fastestWinMs) || 0, gameDurationMs)
    : Number(currentStats.fastestWinMs) || 0;

  return {
    gamesPlayed: 1,
    gamesWon: result === 'win' ? 1 : 0,
    gamesLost: result === 'loss' ? 1 : 0,
    gamesDraw: result === 'draw' ? 1 : 0,
    totalScore: myScore,
    bonusesTriggered: bonusCount,
    wordsPlayed: words.length,
    uniqueWordsCount: newUniqueWords,
    totalMoves: myMoves.length,
    totalTilesPlayed: tileCount,
    totalMoveTimeMs: 0,
    comebackWins: isComebackWin(result, moves, mySlot) ? 1 : 0,
    lastMoveWins: isLastMoveWin(result, moves, mySlot) ? 1 : 0,
    closeWins: result === 'win' && Math.abs(myScore - oppScore) <= 10 ? 1 : 0,
    boostImpactWins: result === 'win' && bonusCount > 0 ? 1 : 0,
    currentStreak: { set: newStreak },
    longestStreak: { max: Math.max(longestStreak, newStreak) },
    highScore: { max: Math.max(highScore, myScore) },
    highestMoveScore: { max: Math.max(prevHighestMoveScore, bestMoveScore) },
    fastestWinMs: { set: fastestWinMs },
    longestWord: { set: wordStats.longestWord },
    longestWordLength: { set: wordStats.longestWordLength },
    recentGames: { set: recentGames },
    boostUsage: { set: boostUsage },
    rivalStats: { set: rivalStats },
    wordCounts: { set: wordStats.wordCounts },
    startingLetterCounts: { set: wordStats.startingLetterCounts },
    weekdayStats: { set: weekdayStats },
    moveSpeedStats: { set: moveSpeedStats },
  };
}

function collectBoostHits(moves, state) {
  const out = [];
  for (const move of moves) {
    for (const tile of move.tiles ?? []) {
      const idx = BDEFS.findIndex(b => b.br === tile.r && b.bc === tile.c);
      if (idx < 0) continue;
      const type = state?.bonusAssignment?.[idx]?.type ?? BONUS_TYPES[idx % BONUS_TYPES.length]?.type ?? 'bonus';
      out.push(type);
    }
  }
  return out;
}

function mergeMoveSpeedStats(current = {}, botTime, result) {
  if (!botTime || ![20, 40, 60].includes(Number(botTime))) return { ...(current ?? {}) };
  const next = { ...(current ?? {}) };
  const key = String(botTime);
  const entry = { played: Number(next[key]?.played) || 0, won: Number(next[key]?.won) || 0 };
  entry.played += 1;
  if (result === 'win') entry.won += 1;
  next[key] = entry;
  return next;
}

function mergeBoostUsage(current = {}, hits = []) {
  const next = { ...(current ?? {}) };
  for (const type of hits) next[type] = (Number(next[type]) || 0) + 1;
  return trimObjectByValue(next, 20);
}

function mergeWordStats(currentStats = {}, words = []) {
  const wordCounts = { ...(currentStats.wordCounts ?? {}) };
  // Per starting-letter tally — unlike wordCounts (trimmed to the top words),
  // this is a complete count of how many words you've built from each letter.
  const startingLetterCounts = { ...(currentStats.startingLetterCounts ?? {}) };
  let longestWord = String(currentStats.longestWord ?? '');
  let longestWordLength = Number(currentStats.longestWordLength) || longestWord.length;
  for (const word of words) {
    if (!word) continue;
    wordCounts[word] = (Number(wordCounts[word]) || 0) + 1;
    const first = word[0];
    if (first) startingLetterCounts[first] = (Number(startingLetterCounts[first]) || 0) + 1;
    if (word.length > longestWordLength) {
      longestWord = word;
      longestWordLength = word.length;
    }
  }
  return {
    longestWord,
    longestWordLength,
    wordCounts: trimObjectByValue(wordCounts, 30),
    startingLetterCounts,
  };
}

function appendRecentGame(current = [], game) {
  return [game, ...(Array.isArray(current) ? current : [])].slice(0, 20);
}

function mergeRivalStats(current = {}, opponent, result, myScore, oppScore) {
  if (!opponent?.uid) return { ...(current ?? {}) };
  const next = { ...(current ?? {}) };
  const prev = next[opponent.uid] ?? {};
  next[opponent.uid] = {
    uid: opponent.uid,
    name: opponent.displayName ?? prev.name ?? opponent.uid,
    avatar: opponent.avatar ?? prev.avatar ?? null,
    played: (Number(prev.played) || 0) + 1,
    won: (Number(prev.won) || 0) + (result === 'win' ? 1 : 0),
    lost: (Number(prev.lost) || 0) + (result === 'loss' ? 1 : 0),
    draw: (Number(prev.draw) || 0) + (result === 'draw' ? 1 : 0),
    pointsFor: (Number(prev.pointsFor) || 0) + myScore,
    pointsAgainst: (Number(prev.pointsAgainst) || 0) + oppScore,
  };
  return trimObjectByField(next, 'played', 20);
}

function mergeWeekdayStats(current = {}, now, result, score) {
  const day = String(new Date(now).getDay());
  const prev = current?.[day] ?? {};
  return {
    ...(current ?? {}),
    [day]: {
      played: (Number(prev.played) || 0) + 1,
      won: (Number(prev.won) || 0) + (result === 'win' ? 1 : 0),
      totalScore: (Number(prev.totalScore) || 0) + score,
    },
  };
}

function opponentFor(state, room, mySlot) {
  return room?.players?.[1 - mySlot] ?? state?.players?.[1 - mySlot] ?? null;
}

function isComebackWin(result, moves, mySlot) {
  if (result !== 'win') return false;
  let mine = 0;
  let opp = 0;
  for (const move of moves) {
    if (!Array.isArray(move?.tiles)) continue;
    const score = Number(move.score) || 0;
    if (move.slot === mySlot) mine += score;
    else if (move.slot === 1 - mySlot) opp += score;
    if (opp - mine >= 20) return true;
  }
  return false;
}

function isLastMoveWin(result, moves, mySlot) {
  if (result !== 'win') return false;
  const lastScoring = [...moves].reverse().find(m => Array.isArray(m?.tiles));
  return lastScoring?.slot === mySlot;
}

function gameDurationFromMoves(moves) {
  const ts = moves.map(m => Number(m?.ts) || 0).filter(Boolean);
  if (ts.length < 2) return 0;
  return Math.max(0, Math.max(...ts) - Math.min(...ts));
}

function fastestPositive(current, candidate) {
  if (!candidate) return current || 0;
  if (!current) return candidate;
  return Math.min(current, candidate);
}

function trimObjectByValue(obj, limit) {
  return Object.fromEntries(
    Object.entries(obj ?? {})
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .slice(0, limit),
  );
}

function trimObjectByField(obj, field, limit) {
  return Object.fromEntries(
    Object.entries(obj ?? {})
      .sort((a, b) => (Number(b[1]?.[field]) || 0) - (Number(a[1]?.[field]) || 0))
      .slice(0, limit),
  );
}
