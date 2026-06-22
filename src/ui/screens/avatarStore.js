// Avatar store catalog — pure data + helpers, no Firebase / no DOM.
//
// The store is a SEPARATE collection from the achievement-unlock avatars in
// avatarScreens.js (SPINE_AVATARS). These 36 avatars live as PNGs under
// images/icons/avatars/ and are bought with coins:
//   common_1..16   — free to everyone (price 0, always "owned")
//   rare_1..8      — purchasable
//   epic_1..8      — purchasable
//   legendary_1..4 — purchasable (the prestige tier)
//
// A store-avatar id (e.g. 'rare_3') is the filename stem, so it round-trips
// to images/icons/avatars/<id>.png. The shared render helpers in
// avatarScreens.js (avatarIconSrc/avatarText) resolve these ids so an equipped
// store avatar displays everywhere (profile, game screen, opponent cards).

export const AVATAR_DIR = 'images/icons/avatars/';

// The coin-currency icon. Used everywhere a coin amount is shown (store prices,
// balances, achievement prizes, daily reward). `.coin-ic` sizes it to 1em so it
// sits inline with the adjacent number.
export const COIN_ICON_SRC = 'images/icons/gold coin.png';
export const COIN_ICON_HTML = `<img src="${COIN_ICON_SRC}" class="coin-ic" alt="">`;

// Flat per-tier prices. Tunable — "grindy / prestige" economy: a legendary is
// a long-haul goal (~1-2 months of play). Common is free.
export const STORE_PRICES = Object.freeze({
  common: 0,
  rare: 250,
  epic: 700,
  legendary: 2500,
});

// Hebrew labels per category, for section headers in the store UI.
export const CATEGORY_LABELS = Object.freeze({
  common: 'רגיל',
  rare: 'נדיר',
  epic: 'אפי',
  legendary: 'אגדי',
});

// Category → { count, prefix, price }. Prefix + index (1..count) builds the id.
export const STORE_TIERS = Object.freeze({
  common:    { count: 16, prefix: 'common_',    price: STORE_PRICES.common },
  rare:      { count: 8,  prefix: 'rare_',       price: STORE_PRICES.rare },
  epic:      { count: 8,  prefix: 'epic_',       price: STORE_PRICES.epic },
  legendary: { count: 4,  prefix: 'legendary_',  price: STORE_PRICES.legendary },
});

// Order categories appear in the store (common first, legendary last).
export const STORE_CATEGORY_ORDER = Object.freeze(['common', 'rare', 'epic', 'legendary']);

// The 36-entry catalog: { id, category, src, price }.
export const STORE_AVATARS = Object.freeze(
  STORE_CATEGORY_ORDER.flatMap((category) => {
    const tier = STORE_TIERS[category];
    return Array.from({ length: tier.count }, (_, i) => {
      const id = `${tier.prefix}${i + 1}`;
      return Object.freeze({
        id,
        category,
        src: `${AVATAR_DIR}${id}.png`,
        price: tier.price,
      });
    });
  }),
);

const STORE_BY_ID = new Map(STORE_AVATARS.map((a) => [a.id, a]));

export function findStoreAvatar(id) {
  return STORE_BY_ID.get(id) ?? null;
}

export function isStoreAvatarId(id) {
  return STORE_BY_ID.has(id);
}

// Resolve a store-avatar id to its PNG path, else null (so avatarScreens.js can
// chain this into avatarIconSrc without depending on the catalog's shape).
export function storeAvatarSrc(id) {
  return STORE_BY_ID.get(id)?.src ?? null;
}

export function priceFor(id) {
  return STORE_BY_ID.get(id)?.price ?? 0;
}

// A store avatar is "owned" if it's a free common, or it's in the player's
// purchased list. Unknown ids are not owned.
export function isOwned(id, ownedAvatars = []) {
  const av = STORE_BY_ID.get(id);
  if (!av) return false;
  if (av.category === 'common') return true;
  return Array.isArray(ownedAvatars) && ownedAvatars.includes(id);
}

// Catalog grouped by category, in display order.
export function storeAvatarsByCategory() {
  const out = {};
  for (const category of STORE_CATEGORY_ORDER) out[category] = [];
  for (const a of STORE_AVATARS) out[a.category].push(a);
  return out;
}
