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
import { applyGameXp, normalizeBoosties } from './boostieXp.js';
import { DEFAULT_BOOSTIE } from './boostieCatalog.js';

export const PATH = Object.freeze({
  users:     'users',
  usernames: 'usernames',
  userIds:   'userIds',
});

export const PROFILE_EVT = Object.freeze({
  CHANGED:        'profile/changed',
  STATS_CHANGED:  'profile/statsChanged',
  AVATAR_UNLOCK:  'profile/avatarUnlock',
  // { levelUp: { id, from, to } | null, unlocked: id | null } after a game's XP lands
  BOOSTIE_LEVEL_UP: 'profile/boostieLevelUp',
});

// New accounts start with the starter Boostie (boostieCatalog.DEFAULT_BOOSTIE).
// Older avatar ids on dev profiles render as the starter too (no migration: the app
// isn't in production yet).
export const DEFAULT_AVATAR = DEFAULT_BOOSTIE;
export const RATING_START   = 800;

// ── Coin economy ──────────────────────────────────────────────────────────
// Constants and pure rules live in economy.js (shared with the coin worker). Coins and
// owned items change only through the worker (economyClient.js); see D-coin-economy.
export {
  STARTER_GRANT, DAILY_BASE, DAILY_STREAK_INCREMENT, DAILY_STREAK_CAP, ACHIEVEMENT_COIN_REWARD,
  MAX_COIN_BALANCE, clampCoins, normalizeProfileEconomy, ymd, isYesterday, computeDailyReward,
  dailyCoinsForDay, dailyWeek,
} from './economy.js';
import { STARTER_GRANT } from './economy.js';

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
    // Store economy. A new player starts with the one-time grant so the store
    // feels reachable from day one.
    coins: STARTER_GRANT,
    lastLoginDate: null, // 'YYYY-MM-DD' of the last claimed daily reward
    loginStreak: 0,
    // Boosties (boostieCatalog.js): XP and level per owned Boostie; the starter is
    // owned from the start. ownedReactions holds Boostie reactions bought in the store.
    boosties: normalizeBoosties(null),
    ownedReactions: [],
    createdAt: Date.now(),
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

// Add one finished game's XP to the equipped Boostie (boostieXp.applyGameXp), atomically
// on profile/boosties. XP counts games, not the rating. `result` is 'win' | 'loss' |
// 'draw'; anything else gives nothing. Reaching the top level unlocks the next Boostie
// in the chain: `unlocked` names it, and the caller asks the coin worker to grant it
// (economyClient.claimChain). Returns { ok, gained, levelUp, unlocked, boosties }.
export async function bumpBoostieXp(db, uid, equipped, result) {
  if (!uid) return { ok: false, reason: 'no-uid' };
  let outcome = null;
  const tx = await db.ref(`${PATH.users}/${uid}/profile/boosties`).transaction((current) => {
    outcome = applyGameXp(current, equipped, result);
    if (!outcome.gained) return;   // abort: nothing to add
    // A chain unlock is granted by the coin worker (economyClient.claimChain); the
    // rules refuse a client-created Boostie that isn't a starter.
    const { [outcome.unlocked]: _unlocked, ...boosties } = outcome.boosties;
    return outcome.unlocked ? boosties : outcome.boosties;
  });
  if (!tx?.committed || !outcome) return { ok: false, reason: 'aborted', gained: 0, levelUp: null, unlocked: null };
  const boosties = normalizeBoosties(tx.snapshot?.val?.() ?? outcome.boosties);
  bus.emit(PROFILE_EVT.CHANGED, { uid, patch: { boosties } });
  return { ok: true, gained: outcome.gained, levelUp: outcome.levelUp, unlocked: outcome.unlocked, boosties };
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

export function isAsyncOnlineMode(mode) {
  return typeof mode === 'string' && mode.endsWith('-async');
}

// Any real online game — live OR async. Both count toward stats + recent games
// (July 2026). Async games were previously excluded; the only stats that don't
// apply to them are wall-clock-based (a turn can be days apart) — those are
// guarded individually below.
export function isOnlineMode(mode) {
  return isLiveOnlineMode(mode) || isAsyncOnlineMode(mode);
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
  // Both live AND async online games count now (July 2026). Async games span
  // real-world days, so wall-clock-derived stats (fastestWinMs, moveSpeedStats)
  // are guarded below; everything else — win/loss, scores, words, rivals,
  // recent-games history — applies equally.
  if (!state || !isOnlineMode(mode)) return null;
  if (mySlot !== 0 && mySlot !== 1) return null;
  const asyncGame = isAsyncOnlineMode(mode);

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
  // fastestWinMs is wall-clock: an async game's turns can be days apart, so its
  // "duration" is meaningless as a fastest-win. Only live games contribute.
  // (moveSpeedStats self-excludes too — async games carry no botTime.)
  const fastestWinMs = !asyncGame && result === 'win' && gameDurationMs > 0
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
