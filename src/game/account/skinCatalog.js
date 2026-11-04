// App skins (colour palettes) sold in the store's "ערכות צבע" tab. Pure data + rules,
// shared by the app and the coin worker (via parseStoreItem). No DOM, no Firebase.
//
// Ownership is a worker-only profile field (`ownedSkins: ['stone']`); which skin is
// showing is a per-device UI preference (settingsCompat `skin`), checked against
// ownership by resolveActiveSkin — an unowned choice falls back to Classic.

export const DEFAULT_SKIN = 'classic';

export const SKINS = Object.freeze({
  classic: Object.freeze({
    id: 'classic', price: 0, light: false,
    name: 'קלאסי',
    desc: 'כחול חשמלי, ציאן וזהב · אריחי עץ',
    // Swatches for the store card / settings row.
    swatches: Object.freeze(['#07123d', '#28d4ff', '#ffc93d', '#d9ad73']),
    themeColor: '#04081a',
    // The home logo: single image + the per-tile layers the build animates (render_logo_tiles.py).
    logo: 'assets/ui/boost-logo.webp',
    logoTiles: 'assets/ui/logo_tiles/',
  }),
  stone: Object.freeze({
    id: 'stone', price: 1500, light: true,
    name: 'אבן ירושלים',
    desc: 'ערכה בהירה · טורקיז, כתום שרוף ואוכרה · אריחי אבן לבנה',
    swatches: Object.freeze(['#f6efe2', '#12607a', '#a8480f', '#e0a030']),
    themeColor: '#f8f2e6',
    logo: 'assets/ui/boost-logo-stone.webp',
    logoTiles: 'assets/ui/logo_tiles_stone/',
  }),
  marble: Object.freeze({
    id: 'marble', price: 1500, light: false,
    name: 'שיש וזהב',
    desc: 'ערכה כהה · שחור, זהב ותכלת פנינה · אריחי שיש שחור',
    swatches: Object.freeze(['#111114', '#d8b25a', '#9fb8dc', '#2a2a30']),
    themeColor: '#0f0f12',
    logo: 'assets/ui/boost-logo-marble.webp',
    logoTiles: 'assets/ui/logo_tiles_marble/',
  }),
});

export const SKIN_IDS = Object.freeze(Object.keys(SKINS));

// How long "נסו עכשיו" shows a skin before switching back.
export const SKIN_PREVIEW_MS = 30_000;

export function isSkinId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKINS, id);
}

export function findSkin(id) {
  return isSkinId(id) ? SKINS[id] : null;
}

// Free skins are always owned; paid ones need to be in the profile's ownedSkins.
export function ownsSkin(id, ownedSkins) {
  const s = findSkin(id);
  if (!s) return false;
  return s.price === 0 || (Array.isArray(ownedSkins) && ownedSkins.includes(id));
}

// The skin to show for a saved choice. `ownedSkins === undefined` means the profile
// hasn't loaded yet: trust the saved choice rather than flash Classic at boot.
export function resolveActiveSkin(chosen, ownedSkins) {
  if (!isSkinId(chosen)) return DEFAULT_SKIN;
  if (ownedSkins === undefined) return chosen;
  return ownsSkin(chosen, ownedSkins) ? chosen : DEFAULT_SKIN;
}
