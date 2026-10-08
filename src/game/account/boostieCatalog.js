// Boostie catalog — pure data + helpers, no Firebase / no DOM.
//
// Boosties are the players' 3D avatars (docs-md/AVATAR_EVOLUTION.md). Each one has
// 7 evolution levels; the level comes from XP (boostieXp.js), kept per Boostie in
// profile.boosties = { <id>: { xp, level } }. Owning a Boostie = having an entry there.
//
// Assets (built in Blender designs/boosties/, see the boostie-evolution skill):
//   assets/boosties/<id>_l<N>.glb                    live 3D (scoreboard, level-up scene)
//   assets/avatars/boosties/<id>/l<N>_bust.webp      256 px still (lists, cards, fallback)
//   assets/avatars/boosties/<id>/l<N>_full.webp      512 px still (store, level-up fallback)
//
// How a Boostie is unlocked:
//   'starter' — every player owns it from the start (the plan: 4–5 starters)
//   'chain'   — free when another Boostie reaches the top level (CHAIN_ORDER), or bought
//   'store'   — only bought with coins
// `price` is the coin price in the store (0 = not for sale).

export const BOOSTIE_LEVELS = 7;
export const DEFAULT_BOOSTIE = 'zapi';

export const BOOSTIES = Object.freeze({
  zapi: Object.freeze({ id: 'zapi', name: 'זאפי', species: 'fox', unlock: 'starter', price: 0 }),
  bubo: Object.freeze({ id: 'bubo', name: 'בובו', species: 'owl', unlock: 'starter', price: 0 }),
  rocco: Object.freeze({ id: 'rocco', name: 'רוקו', species: 'ram', unlock: 'starter', price: 0 }),
  lumi: Object.freeze({ id: 'lumi', name: 'לומי', species: 'axolotl', unlock: 'starter', price: 0 }),
  drako: Object.freeze({ id: 'drako', name: 'דרקו', species: 'dragon', unlock: 'store', price: 1500 }),
});

// Every player owns these from the start.
export const STARTER_BOOSTIES = Object.freeze(Object.keys(BOOSTIES).filter((id) => BOOSTIES[id].unlock === 'starter'));

// Reaching the top level with any Boostie unlocks the first Boostie in this list the
// player doesn't own yet. Only 'chain' Boosties belong here; empty until one exists.
export const CHAIN_ORDER = Object.freeze(Object.keys(BOOSTIES).filter((id) => BOOSTIES[id].unlock === 'chain'));

export function isBoostieId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BOOSTIES, id);
}

export function clampLevel(level) {
  const n = Math.floor(Number(level) || 1);
  return Math.min(BOOSTIE_LEVELS, Math.max(1, n));
}

export function boostieName(id) {
  return isBoostieId(id) ? BOOSTIES[id].name : BOOSTIES[DEFAULT_BOOSTIE].name;
}

// Still image for a Boostie at a level. kind: 'bust' (default) | 'full'.
export function boostieStillSrc(id, level, kind = 'bust') {
  const b = isBoostieId(id) ? id : DEFAULT_BOOSTIE;
  const k = kind === 'full' ? 'full' : 'bust';
  return `assets/avatars/boosties/${b}/l${clampLevel(level)}_${k}.webp`;
}

// Rigged 3D model for a Boostie at a level (meshopt-compressed .glb).
export function boostieModelSrc(id, level) {
  const b = isBoostieId(id) ? id : DEFAULT_BOOSTIE;
  return `assets/boosties/${b}_l${clampLevel(level)}.glb`;
}

// The Boostie a top-level Boostie unlocks: the first in `order` not owned, or null.
// `owned` is an array of ids or a { id: … } map.
export function nextChainBoostie(owned, order = CHAIN_ORDER) {
  const has = Array.isArray(owned) ? new Set(owned) : new Set(Object.keys(owned || {}));
  return order.find((id) => !has.has(id)) ?? null;
}

// Avatar value: the string that travels wherever an avatar is stored or sent (room
// players, invites, queue entries, friend lists): '<id>:<level>', e.g. 'zapi:4'.
// A bare id means level 1. Profiles keep only the id in `equippedAvatar`; the level
// comes from profile.boosties (boostieXp.profileAvatarValue builds the full value).
export function boostieAvatarValue(id, level) {
  const b = isBoostieId(id) ? id : DEFAULT_BOOSTIE;
  return `${b}:${clampLevel(level)}`;
}

// { id, level } for a Boostie avatar value ('zapi', 'zapi:4' or { id|char, level }),
// else null (old store ids, emojis, bot ids, empty).
export function parseBoostieAvatar(value) {
  if (value && typeof value === 'object') {
    const id = value.id ?? value.char;
    return isBoostieId(id) ? { id, level: clampLevel(value.level) } : null;
  }
  if (typeof value !== 'string') return null;
  const m = /^([a-z]+)(?::(\d+))?$/.exec(value);
  if (!m || !isBoostieId(m[1])) return null;
  return { id: m[1], level: clampLevel(m[2] ?? 1) };
}

// Reactions a player can play on their own Boostie (D-boostie-reactions). The free set
// is always owned; the rest are store items kept in profile.ownedReactions. `clip` is the
// model's animation clip; wink also keys the lids (a live lid controller must let the
// clip's lid tracks through while it plays). `emoji` stands in for the clip wherever the
// Boostie is a still (tray, store tile, the bubble fallback). Prices are tunable.
export const BOOSTIE_REACTIONS = Object.freeze([
  Object.freeze({ id: 'laugh', name: 'צחוק',          clip: 'laugh', emoji: '😂', price: 0 }),
  Object.freeze({ id: 'wow',   name: 'וואו!',          clip: 'wow',   emoji: '😮', price: 0 }),
  Object.freeze({ id: 'stare', name: 'עיניים גדולות', clip: 'stare', emoji: '👀', price: 0 }),
  Object.freeze({ id: 'wink',  name: 'קריצה',         clip: 'wink',  emoji: '😉', price: 250 }),
  Object.freeze({ id: 'yawn',  name: 'פיהוק',         clip: 'yawn',  emoji: '🥱', price: 250 }),
]);

export function findReaction(id) {
  return BOOSTIE_REACTIONS.find((r) => r.id === id) ?? null;
}

export function ownsReaction(id, ownedReactions) {
  const r = findReaction(id);
  if (!r) return false;
  return r.price === 0 || (Array.isArray(ownedReactions) && ownedReactions.includes(id));
}

// Store items are 'boostie:<id>' or 'reaction:<id>'. { kind, id, price } or null.
export function parseStoreItem(item) {
  const m = /^(boostie|reaction):([a-z]+)$/.exec(typeof item === 'string' ? item : '');
  if (!m) return null;
  const [, kind, id] = m;
  if (kind === 'boostie') return isBoostieId(id) && BOOSTIES[id].price > 0 ? { kind, id, price: BOOSTIES[id].price } : null;
  const r = findReaction(id);
  return r && r.price > 0 ? { kind, id, price: r.price } : null;
}
