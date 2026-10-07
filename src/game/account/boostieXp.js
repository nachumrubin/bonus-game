// Boostie XP and levels — pure, no Firebase / no DOM.
//
// XP counts games, nothing else: every finished game gives XP, a win gives more.
// It is NOT the ELO rating (ratingService.js) — rating never feeds XP and XP never
// feeds rating. XP goes to the Boostie the player has equipped; each Boostie keeps
// its own XP and level (profile.boosties = { <id>: { xp, level } }).
//
// Tuning (D-boostie-xp): about 3 games a day reaches level 4 in about a week and
// level 7 in about 6–7 weeks. All numbers below are tunable.

import { BOOSTIE_LEVELS, isBoostieId, nextChainBoostie, DEFAULT_BOOSTIE, boostieAvatarValue, STARTER_BOOSTIES } from './boostieCatalog.js';

export const XP_PER_GAME   = 10;
export const XP_WIN_BONUS  = 10;
export const XP_DRAW_BONUS = 5;
// Total XP needed for level 1..7 (index 0 = level 1).
export const LEVEL_XP = Object.freeze([0, 50, 150, 350, 700, 1200, 2000]);
// The most XP one game can give (the Firebase rule caps a single write at this).
export const MAX_GAME_XP = XP_PER_GAME + XP_WIN_BONUS;

// XP for one finished game. result: 'win' | 'loss' | 'draw'; anything else
// (abandoned, forfeited, unknown) gives nothing.
export function xpForGame(result) {
  if (result === 'win')  return XP_PER_GAME + XP_WIN_BONUS;
  if (result === 'draw') return XP_PER_GAME + XP_DRAW_BONUS;
  if (result === 'loss') return XP_PER_GAME;
  return 0;
}

export function clampXp(xp) {
  return Math.max(0, Math.floor(Number(xp) || 0));
}

export function levelFromXp(xp) {
  const v = clampXp(xp);
  let level = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) if (v >= LEVEL_XP[i]) level = i + 1;
  return Math.min(level, BOOSTIE_LEVELS);
}

// Progress inside the current level, for XP bars.
// { level, xp, into, span, ratio, nextAt } — at the top level span = 0, ratio = 1, nextAt = null.
export function progressToNext(xp) {
  const v = clampXp(xp);
  const level = levelFromXp(v);
  const base = LEVEL_XP[level - 1];
  if (level >= BOOSTIE_LEVELS) return { level, xp: v, into: v - base, span: 0, ratio: 1, nextAt: null };
  const nextAt = LEVEL_XP[level];
  const span = nextAt - base;
  return { level, xp: v, into: v - base, span, ratio: (v - base) / span, nextAt };
}

// XP a player already earned before Boosties existed, from their stats (migration).
export function xpFromPastStats(stats) {
  const played = clampXp(stats?.gamesPlayed);
  const won    = Math.min(played, clampXp(stats?.gamesWon));
  const draws  = Math.min(played - won, clampXp(stats?.gamesDraw));
  return played * XP_PER_GAME + won * XP_WIN_BONUS + draws * XP_DRAW_BONUS;
}

// Safe-read profile.boosties: keeps known ids only, recomputes each level from its XP,
// and always includes the starter Boostie.
export function normalizeBoosties(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [id, v] of Object.entries(raw)) {
      if (!isBoostieId(id)) continue;
      const xp = clampXp(v?.xp);
      out[id] = { xp, level: levelFromXp(xp) };
    }
  }
  for (const id of STARTER_BOOSTIES) if (!out[id]) out[id] = { xp: 0, level: 1 };
  return out;
}

// Apply one finished game to the equipped Boostie.
// Returns { boosties, gained, levelUp: { id, from, to } | null, unlocked: id | null }.
// Reaching the top level unlocks the next Boostie in the chain (at level 1).
export function applyGameXp(boosties, equipped, result) {
  const next = normalizeBoosties(boosties);
  const id = isBoostieId(equipped) && next[equipped] ? equipped : DEFAULT_BOOSTIE;
  const gained = xpForGame(result);
  const before = next[id];
  const xp = before.xp + gained;
  const level = levelFromXp(xp);
  next[id] = { xp, level };
  const levelUp = level > before.level ? { id, from: before.level, to: level } : null;
  let unlocked = null;
  if (levelUp && level >= BOOSTIE_LEVELS) {
    unlocked = nextChainBoostie(next);
    if (unlocked) next[unlocked] = { xp: 0, level: 1 };
  }
  return { boosties: next, gained, levelUp, unlocked };
}

// The Boostie a profile shows: its equipped one if owned, else the starter.
// { id, xp, level }. Old avatar ids (store portraits, emojis) count as the starter.
export function equippedBoostie(profile) {
  const boosties = normalizeBoosties(profile?.boosties);
  const eq = profile?.equippedAvatar;
  const id = isBoostieId(eq) && boosties[eq] ? eq : DEFAULT_BOOSTIE;
  return { id, ...boosties[id] };
}

// The avatar value ('zapi:4') to store on rooms, invites and friend entries.
export function profileAvatarValue(profile) {
  const b = equippedBoostie(profile);
  return boostieAvatarValue(b.id, b.level);
}
