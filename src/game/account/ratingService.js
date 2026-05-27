// Rating service — Elo calculation + applier.
//
// Pure helpers (tested):
//   expectedScore(my, opp, scale)
//   applyDelta(myRating, oppRating, score, k)
//
// `score` is the Elo outcome score: 1.0 = win, 0.5 = draw, 0.0 = loss.
//
// The applier `applyEloForFinishedGame(db, ...)` reads both player
// profiles, computes new ratings, writes them back, and returns the
// before/after pair for downstream UI / animations.

import { PATH } from './profileService.js';
import { RATING_START } from './profileService.js';
import * as bus from '../../events/bus.js';

const DEFAULT_K = 24;
const SCALE = 400;
export const RATINGS_PATH = 'globalRatings';
export const RATINGS_LIMIT = 10;

export const RATING_EVT = Object.freeze({
  CHANGED: 'rating/changed',
});

export function expectedScore(my, opp, scale = SCALE) {
  return 1 / (1 + Math.pow(10, (opp - my) / scale));
}

export function applyDelta(my, opp, score, k = DEFAULT_K) {
  const e = expectedScore(my, opp);
  return Math.round(my + k * (score - e));
}

// Map game result string to Elo outcome score.
export function scoreFromResult(result) {
  if (result === 'win')  return 1.0;
  if (result === 'draw') return 0.5;
  if (result === 'loss') return 0.0;
  return null;
}

function profileRef(db, uid) {
  return db.ref(`${PATH.users}/${uid}/profile`);
}

function ratingRef(db, uid) {
  return db.ref(`${RATINGS_PATH}/${uid}`);
}

// Read a single user's numeric rating from globalRatings (publicly readable).
export async function readRating(db, uid) {
  if (!db || !uid) return null;
  const snap = await ratingRef(db, uid).get().catch(() => null);
  const val = snap?.val ? snap.val() : null;
  return val?.rating != null ? Number(val.rating) : null;
}

export function normalizeRatingEntry(entry, uid) {
  const rating = Number(entry?.rating ?? RATING_START);
  if (!entry || !Number.isFinite(rating)) return null;
  return {
    uid: entry.uid ?? uid ?? null,
    name: String(entry.name ?? entry.displayName ?? 'שחקן').trim().slice(0, 30) || 'שחקן',
    rating,
    avatar: entry.avatar ?? entry.equippedAvatar ?? null,
    updatedAt: Number(entry.updatedAt ?? entry.lastRatedAt ?? 0) || 0,
  };
}

export function rankRatings(raw, { limit = RATINGS_LIMIT } = {}) {
  const entries = raw && typeof raw === 'object' ? Object.entries(raw) : [];
  return entries
    .map(([uid, entry]) => normalizeRatingEntry(entry, uid))
    .filter(Boolean)
    .sort((a, b) => (b.rating - a.rating) || (b.updatedAt - a.updatedAt) || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
}

export async function listTopRatings(db, { limit = RATINGS_LIMIT } = {}) {
  if (!db) throw new Error('listTopRatings: db required');
  const snap = await db.ref(RATINGS_PATH).get();
  return rankRatings(snap?.val ? snap.val() : null, { limit });
}

export async function upsertRatingLeaderboardEntry(db, {
  uid,
  profile,
  rating = profile?.rating ?? RATING_START,
  updatedAt = Date.now(),
} = {}) {
  if (!db) throw new Error('upsertRatingLeaderboardEntry: db required');
  if (!uid) return;
  await ratingRef(db, uid).set({
    uid,
    name: String(profile?.displayName ?? profile?.name ?? 'שחקן').trim().slice(0, 30) || 'שחקן',
    avatar: profile?.equippedAvatar ?? profile?.avatar ?? null,
    rating,
    updatedAt,
  });
}

// Read both players' profiles, compute new ratings for the slot=mySlot
// player AND the opponent, and write them back. Returns
// { myBefore, myAfter, oppBefore, oppAfter, delta }.
//
// Result is from `mySlot`'s perspective (`win` means mySlot won).
export async function applyEloForFinishedGame(db, {
  myUid, oppUid, result, k = DEFAULT_K, now = Date.now(),
} = {}) {
  if (!myUid || !oppUid)         return { ok: false, reason: 'missing-uid' };
  if (myUid === oppUid)          return { ok: false, reason: 'same-uid' };
  const score = scoreFromResult(result);
  if (score == null)             return { ok: false, reason: 'bad-result' };

  const [mySnap, oppSnap] = await Promise.all([
    profileRef(db, myUid).get(),
    profileRef(db, oppUid).get(),
  ]);
  const my  = mySnap?.val  ? mySnap.val()  : null;
  const opp = oppSnap?.val ? oppSnap.val() : null;
  if (!my || !opp) return { ok: false, reason: 'no-profile' };

  const myBefore  = my.rating  ?? RATING_START;
  const oppBefore = opp.rating ?? RATING_START;

  const myAfter  = applyDelta(myBefore,  oppBefore, score,        k);
  const oppAfter = applyDelta(oppBefore, myBefore,  1 - score,    k);

  await Promise.all([
    profileRef(db, myUid).update({ rating: myAfter, lastRatedAt: now }),
    profileRef(db, oppUid).update({ rating: oppAfter, lastRatedAt: now }),
    upsertRatingLeaderboardEntry(db, { uid: myUid, profile: my, rating: myAfter, updatedAt: now }),
    upsertRatingLeaderboardEntry(db, { uid: oppUid, profile: opp, rating: oppAfter, updatedAt: now }),
  ]);

  bus.emit(RATING_EVT.CHANGED, { myUid, oppUid, myBefore, myAfter, oppBefore, oppAfter });
  return { ok: true, myBefore, myAfter, oppBefore, oppAfter, delta: myAfter - myBefore };
}
