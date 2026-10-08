// Coin economy: constants and pure rules, shared by the app and the coin worker
// (worker/src/economy.js, Phase 6a). Since coins can be bought with real money, only
// the worker changes coins and owned items; the client asks it to (economyClient.js)
// and the database rules refuse client writes to these fields. No DOM, no Firebase.
//
// Every apply* function takes a profile (as stored) and returns
//   { next, result }  — the whole new profile to write, and the answer for the client
//   { result }        — nothing to write (result.ok false with a reason, or a no-op)
// so the worker can run it inside a compare-and-set loop and retry on a conflict.

import { parseStoreItem } from './boostieCatalog.js';
import { normalizeBoosties } from './boostieXp.js';
import { nextChainBoostie, BOOSTIE_LEVELS } from './boostieCatalog.js';
import { ACHIEVEMENTS, achievementSnapshot, isAchievementComplete } from './achievements.js';

// ── Constants (tunable) ───────────────────────────────────────────────────
// Coins are earned three ways: a one-time starter grant on sign-up, a daily login +
// consecutive-day streak bonus, and achievement completions. Spent in the store.
// They live at the profile root (siblings of `rating`/`stats`), never inside `stats`.
export const STARTER_GRANT          = 150;
export const DAILY_BASE             = 20;
export const DAILY_STREAK_INCREMENT = 10;
export const DAILY_STREAK_CAP       = 10; // streak-day after which the daily bonus stops growing
export const ACHIEVEMENT_COIN_REWARD = Object.freeze({
  bronze: 50, silver: 100, gold: 250, legend: 750,
});

// Hard ceiling on a coin balance: a safety net against buggy or out-of-band writes.
export const MAX_COIN_BALANCE = 100_000;

// The daily reward's calendar day is the server's, in the players' time zone.
export const ECONOMY_TIME_ZONE = 'Asia/Jerusalem';

// Coin packs sold for real money (Phase 6b). The key is the product id in the Play
// Console; the price is set there (per country), never here. Placeholder sizes until
// the prices are decided.
export const COIN_PACKS = Object.freeze({
  coins_500:  Object.freeze({ coins: 500 }),
  coins_1200: Object.freeze({ coins: 1200 }),
  coins_3000: Object.freeze({ coins: 3000 }),
});

// How many recent request ids a profile remembers (a retried request returns the
// first answer instead of paying twice).
export const RECENT_REQUESTS_MAX = 30;

// ── Pure helpers ──────────────────────────────────────────────────────────

// Coerce any value to a valid, in-range coin balance (integer, 0..MAX).
export function clampCoins(value) {
  return Math.min(MAX_COIN_BALANCE, Math.max(0, Math.floor(Number(value) || 0)));
}

// Safe-read the economy fields from a (possibly old) profile.
export function normalizeProfileEconomy(profile) {
  return {
    coins: clampCoins(profile?.coins),
    lastLoginDate: typeof profile?.lastLoginDate === 'string' ? profile.lastLoginDate : null,
    loginStreak: Math.max(0, Math.floor(Number(profile?.loginStreak) || 0)),
  };
}

// Format a Date as a local 'YYYY-MM-DD' string.
export function ymd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 'YYYY-MM-DD' for `date` in a time zone (the worker's clock is UTC).
export function ymdIn(timeZone = ECONOMY_TIME_ZONE, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Is `prev` ('YYYY-MM-DD') exactly one calendar day before `today`?
export function isYesterday(prev, today) {
  if (!prev || !today) return false;
  const p = new Date(`${prev}T00:00:00`);
  const t = new Date(`${today}T00:00:00`);
  if (Number.isNaN(p.getTime()) || Number.isNaN(t.getTime())) return false;
  return Math.round((t - p) / 86400000) === 1;
}

// Given the last claim date + current streak, what daily reward (if any) is owed
// today? Consecutive day → streak+1; any gap or first-ever → 1; same day → no-op.
// The streak keeps growing for display, but the coin bonus is capped at
// DAILY_STREAK_CAP days.
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

// Coins owed for the Nth consecutive login day (same curve as computeDailyReward).
export function dailyCoinsForDay(day) {
  const d = Math.min(Math.max(1, Math.floor(Number(day) || 1)), DAILY_STREAK_CAP);
  return DAILY_BASE + DAILY_STREAK_INCREMENT * (d - 1);
}

// The 7-day strip shown in the daily-reward popup. The week window rolls with the
// streak (days 1-7, then 8-14, …); each entry is { n, coins, state: 'got' | 'today' |
// 'next' } relative to `streak`.
export function dailyWeek(streak) {
  const s = Math.max(1, Math.floor(Number(streak) || 1));
  const start = s - ((s - 1) % 7);
  return Array.from({ length: 7 }, (_, i) => {
    const n = start + i;
    return { n, coins: dailyCoinsForDay(n), state: n < s ? 'got' : n === s ? 'today' : 'next' };
  });
}

// A client request id: letters, digits, '-' and '_', 8–64 chars (a database key).
export function isRequestId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

// A store order id as a database key ('GPA.1234-5678-…' has dots).
export function orderKey(orderId) {
  return String(orderId ?? '').replace(/[.#$/[\]]/g, '_').slice(0, 120);
}

// ── Apply functions (profile → { next?, result }) ─────────────────────────

function withCoins(p, coins) {
  return { ...p, coins: clampCoins(coins) };
}

// Today's daily login reward; same-day repeat → alreadyClaimedToday, no write.
export function applyDailyClaim(p, today) {
  const e = normalizeProfileEconomy(p);
  const res = computeDailyReward(e.lastLoginDate, e.loginStreak, today);
  if (res.alreadyClaimedToday) return { result: { ok: true, ...res, coins: e.coins } };
  const next = { ...withCoins(p, e.coins + res.coinsAwarded), lastLoginDate: today, loginStreak: res.newStreak };
  return { next, result: { ok: true, ...res, coins: next.coins } };
}

// An achievement's coin reward, once per achievement, only if it is really complete.
export function applyAchievementClaim(p, achId, now = Date.now()) {
  const ach = ACHIEVEMENTS.find((a) => a.id === achId);
  if (!ach) return { result: { ok: false, reason: 'unknown-achievement' } };
  const coins = clampCoins(p?.coins);
  if (p?.achievementsPaid?.[achId]) return { result: { ok: false, reason: 'already-paid', coins } };
  if (!isAchievementComplete(ach, achievementSnapshot(p))) return { result: { ok: false, reason: 'not-complete', coins } };
  const reward = ACHIEVEMENT_COIN_REWARD[ach.tier] ?? 0;
  const next = { ...withCoins(p, coins + reward), achievementsPaid: { ...(p.achievementsPaid ?? {}), [achId]: now } };
  return { next, result: { ok: true, reward, coins: next.coins } };
}

// Buy a store item ('boostie:bubo' | 'reaction:wink'): the price comes from the
// catalog, never from the caller. A Boostie arrives at level 1, a reaction joins
// ownedReactions.
export function applyPurchase(p, item) {
  const it = parseStoreItem(item);
  if (!it) return { result: { ok: false, reason: 'unknown-item' } };
  const coins = clampCoins(p?.coins);
  const boosties = normalizeBoosties(p?.boosties);
  const reactions = Array.isArray(p?.ownedReactions) ? p.ownedReactions : [];
  const owned = it.kind === 'boostie' ? !!boosties[it.id] : reactions.includes(it.id);
  if (owned) return { result: { ok: false, reason: 'already-owned', coins } };
  if (coins < it.price) return { result: { ok: false, reason: 'insufficient', coins } };
  const next = withCoins(p, coins - it.price);
  if (it.kind === 'boostie') next.boosties = { ...(p.boosties ?? {}), [it.id]: { xp: 0, level: 1 } };
  else next.ownedReactions = [...reactions, it.id];
  return { next, result: { ok: true, item, coins: next.coins } };
}

// The chain unlock: a Boostie at the top level earns the next one in CHAIN_ORDER.
export function applyChainClaim(p) {
  const boosties = normalizeBoosties(p?.boosties);
  if (!Object.values(boosties).some((b) => b.level >= BOOSTIE_LEVELS)) return { result: { ok: false, reason: 'no-top-level' } };
  const id = nextChainBoostie(boosties);
  if (!id) return { result: { ok: false, reason: 'nothing-to-unlock' } };
  const next = { ...p, boosties: { ...(p.boosties ?? {}), [id]: { xp: 0, level: 1 } } };
  return { next, result: { ok: true, unlocked: id } };
}

// Credit a verified coin-pack purchase, once per store order.
export function applyCoinCredit(p, { orderId, productId }, now = Date.now()) {
  const pack = COIN_PACKS[productId];
  if (!pack) return { result: { ok: false, reason: 'unknown-product' } };
  const key = orderKey(orderId);
  if (!key) return { result: { ok: false, reason: 'no-order' } };
  const coins = clampCoins(p?.coins);
  if (p?.coinOrders?.[key]) return { result: { ok: true, already: true, coins } };
  const next = { ...withCoins(p, coins + pack.coins), coinOrders: { ...(p.coinOrders ?? {}), [key]: { productId, coins: pack.coins, ts: now } } };
  return { next, result: { ok: true, credited: pack.coins, coins: next.coins } };
}

// Remember a request's answer on the profile (econRecent), keeping the newest few.
export function rememberRequest(next, reqId, result, now = Date.now()) {
  const recent = { ...(next.econRecent ?? {}), [reqId]: { result, ts: now } };
  const ids = Object.keys(recent).sort((a, b) => (recent[b].ts ?? 0) - (recent[a].ts ?? 0));
  for (const id of ids.slice(RECENT_REQUESTS_MAX)) delete recent[id];
  return { ...next, econRecent: recent };
}

// The coin delta of a write (for the audit ledger).
export function coinDelta(before, after) {
  return clampCoins(after?.coins) - clampCoins(before?.coins);
}
