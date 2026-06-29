// Avatar store catalog — pure data + helpers, no Firebase / no DOM.
//
// The store is a SEPARATE collection from the achievement-unlock avatars in
// avatarScreens.js (SPINE_AVATARS). These avatars live as PNGs under
// assets/avatars_v2/<category>/ and are bought with coins:
//   common (17)   — free to everyone (price 0, always "owned"); the last one
//                   (common_17, "anonymous player") is the default avatar
//   rare (12)     — purchasable
//   epic (10)     — purchasable (avraham removed — white background)
//   legendary (5) — purchasable (the prestige tier)
//
// The catalog id is a clean numeric stem (e.g. 'rare_3'), decoupled from the
// file on disk — STORE_TIERS maps each id to a descriptive filename (which may
// contain spaces / Hebrew / mixed-case extensions). Keeping ids numeric means
// they round-trip safely through Firebase profiles and DOM data-attributes.
// The shared render helpers in avatarScreens.js (avatarIconSrc/avatarText)
// resolve these ids via storeAvatarSrc() so an equipped store avatar displays
// everywhere (profile, game screen, opponent cards).

export const AVATAR_DIR = 'assets/avatars_v2/';

// The coin-currency icon. Used everywhere a coin amount is shown (store prices,
// balances, achievement prizes, daily reward). `.coin-ic` sizes it to 1em so it
// sits inline with the adjacent number.
export const COIN_ICON_SRC = 'assets/rewards/gold coin.png';
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

// Category → { prefix, price, files }. The id is `${prefix}${index+1}`; the file
// at that index supplies the artwork (kept under assets/avatars_v2/<category>/).
// Reordering/removing a file shifts the numeric ids — fine while not in
// production. Adding files just extends the tier.
export const STORE_TIERS = Object.freeze({
  common: {
    prefix: 'common_',
    price: STORE_PRICES.common,
    // Most files live under assets/avatars_v2/common/; an entry may instead be
    // `{ src }` to point at an existing asset elsewhere (used for the default
    // "anonymous player" avatar, appended last — see DEFAULT_STORE_AVATAR_ID).
    files: [
      'basketball_player.png', 'common_1_1.png', 'common_1_2.png', 'common_1_3.png',
      'common_1_4.png', 'common_2_split.png', 'doctor.png', 'fire_dep.png',
      'gamer.png', 'hacker.png', 'police.png', 'shef.png',
      'soccer_fan.png', 'soccer_player.png', 'soldier.png', 'su_shef.png',
      // Default avatar (id common_17): the neutral "anonymous player" art,
      // reused from assets/avatars/ rather than duplicated into avatars_v2/.
      { src: 'assets/avatars/anonymous player.png' },
    ],
  },
  rare: {
    prefix: 'rare_',
    price: STORE_PRICES.rare,
    files: [
      'david_ben_gur.png', 'golda.png', 'hertzel.png', 'ilan_ramon.png',
      'miriam_peretz.png', 'moshe dayan.png', 'ofra_haza.png', 'rabin.png',
      'rare_1_bottom_left.png', 'rare_1_bottom_right.png', 'rare_1_top_left.png',
      'rare_1_top_right.png',
    ],
  },
  epic: {
    prefix: 'epic_',
    price: STORE_PRICES.epic,
    files: [
      'esther.PNG', 'jacob.png', 'rachel.png', 'ruth.PNG', 'shmoel.png',
      'מרדכי היהודי.PNG', 'joshua.png', 'rambam.png', 'adam.png', 'yehuda_hamaccabi.png',
    ],
  },
  legendary: {
    prefix: 'legendary_',
    price: STORE_PRICES.legendary,
    files: [
      'aharon.png', 'david.png', 'joseph.png', 'moses.png', 'samson.png',
    ],
  },
});

export const STORE_AVATAR_NAMES = Object.freeze({
  common_1: 'כדורסלן',
  common_2: 'כדורגלנית',
  common_3: 'אוהדת כדורסל',
  common_4: 'גיימרית',
  common_5: 'אוהדת נבחרת',
  common_6: 'סופר סת"ם',
  common_7: 'רופא',
  common_8: 'לוחם אש',
  common_9: 'גיימר',
  common_10: 'האקר',
  common_11: 'שוטר',
  common_12: 'שף',
  common_13: 'אוהד כדורגל',
  common_14: 'כדורגלן',
  common_15: 'חייל',
  common_16: 'סופר',
  common_17: 'אנונימי',
  rare_1: 'דוד בן גוריון',
  rare_2: 'גולדה מאיר',
  rare_3: 'הרצל',
  rare_4: 'אילן רמון',
  rare_5: 'מרים פרץ',
  rare_6: 'משה דיין',
  rare_7: 'עפרה חזה',
  rare_8: 'יצחק רבין',
  rare_9: 'חנה סנש',
  rare_10: 'אריק איינשטיין',
  rare_11: 'הראי"ה קוק',
  rare_12: 'אלברט איינשטיין',
  epic_1: 'אסתר המלכה',
  epic_2: 'יעקב אבינו',
  epic_3: 'רחל אמנו',
  epic_4: 'רות המואביה',
  epic_5: 'שמואל הנביא',
  epic_6: 'מרדכי היהודי',
  epic_7: 'יהושע בן נון',
  epic_8: 'הרמב"ם',
  epic_9: 'אדם הראשון',
  epic_10: 'יהודה המכבי',
  legendary_1: 'אהרן הכהן',
  legendary_2: 'דוד המלך',
  legendary_3: 'יוסף הצדיק',
  legendary_4: 'משה רבנו',
  legendary_5: 'שמשון הגיבור',
});

// Order categories appear in the store (common first, legendary last).
export const STORE_CATEGORY_ORDER = Object.freeze(['common', 'rare', 'epic', 'legendary']);

// The avatar catalog: { id, category, src, price, nameHe }. `src` is URL-encoded so
// descriptive filenames with spaces / Hebrew / mixed-case load in <img>.
export const STORE_AVATARS = Object.freeze(
  STORE_CATEGORY_ORDER.flatMap((category) => {
    const tier = STORE_TIERS[category];
    return tier.files.map((file, i) => {
      const id = `${tier.prefix}${i + 1}`;
      // A file entry is either a filename under assets/avatars_v2/<category>/
      // or an object `{ src }` carrying an absolute path to reuse elsewhere.
      const src = typeof file === 'string'
        ? `${AVATAR_DIR}${category}/${file}`
        : file.src;
      return Object.freeze({
        id,
        category,
        src: encodeURI(src),
        price: tier.price,
        nameHe: STORE_AVATAR_NAMES[id] ?? id,
      });
    });
  }),
);

// The default avatar new accounts start with (and the migration target for
// existing 'crown' defaults). It's the last common entry — the neutral
// "anonymous player" art. profileService.DEFAULT_AVATAR must equal this.
export const DEFAULT_STORE_AVATAR_ID = 'common_17';

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
