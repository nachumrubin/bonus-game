// skinController — which app skin (skinCatalog.js) is showing, and the store's
// 30-second "נסו עכשיו" try-on.
//
// The skin is the `data-skin` attribute on <html> (absent = Classic); each paid skin's
// stylesheet (e.g. skin-stone.css) is scoped under html[data-skin="<id>"]. An inline
// script in index.html sets the attribute from the saved preference before first
// paint, so a Stone player never sees a Classic flash at boot.
//
// The choice is a per-device UI preference (settingsCompat `skin`); ownership is the
// worker-written profile.ownedSkins. Until the profile arrives the saved choice is
// trusted; once it does, an unowned choice falls back to Classic.
//
// Emits SKIN_CHANGED { active, chosen, owned, preview } after every change, where
// preview = { id, leftMs } while a try-on runs, else null. The try-on shows a banner
// (#skin-preview-bar) with a countdown, a buy button (SKIN_PREVIEW_BUY { id }) and ×.

import { SKINS, DEFAULT_SKIN, SKIN_PREVIEW_MS, isSkinId, ownsSkin, resolveActiveSkin } from '../game/account/skinCatalog.js';
import { loadUiPreferences, mergeUiPreferences } from '../game/settings/settingsCompat.js';
import { COIN_ICON_HTML } from './screens/coinIcon.js';

export const SKIN_CHANGED = 'skin/changed';
export const SKIN_PREVIEW_BUY = 'skin/previewBuy';
export const SKIN_PREVIEW_ENDED = 'skin/previewEnded';   // { id, reason: 'timeout' | 'closed' }

// Paint `id` on the document: the data-skin attribute and the browser chrome colour.
export function applySkinToDocument(doc, id) {
  const html = doc?.documentElement;
  if (!html) return;
  const skin = isSkinId(id) ? id : DEFAULT_SKIN;
  // Each paid skin's sheet is linked with media="not all" (downloaded at low
  // priority, never render-blocking for Classic players); switch on only its own.
  for (const link of doc.querySelectorAll?.('link[data-skin-css]') ?? []) {
    link.media = link.getAttribute('data-skin-css') === skin ? 'all' : 'not all';
  }
  if (skin === DEFAULT_SKIN) html.removeAttribute?.('data-skin');
  else html.setAttribute?.('data-skin', skin);
  const meta = doc.querySelector?.('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', SKINS[skin].themeColor);
}

export function formatPreviewLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createSkinController({
  doc = globalThis.document,
  storage = globalThis.localStorage,
  bus = null,
  previewMs = SKIN_PREVIEW_MS,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  setTick = (fn, ms) => setInterval(fn, ms),
  clearTick = (t) => clearInterval(t),
} = {}) {
  let chosen = loadUiPreferences(storage).skin;
  let owned;              // undefined until the profile arrives
  let preview = null;     // { id, endsAt }
  let endTimer = null;
  let tick = null;
  let bar = null;

  const active = () => preview?.id ?? resolveActiveSkin(chosen, owned);

  function snapshot() {
    return {
      active: active(),
      chosen: resolveActiveSkin(chosen, owned),
      owned: owned ?? [],
      preview: preview ? { id: preview.id, leftMs: Math.max(0, preview.endsAt - now()) } : null,
    };
  }

  function render() {
    applySkinToDocument(doc, active());
    paintBar();
    bus?.emit?.(SKIN_CHANGED, snapshot());
  }

  // ── Try-on banner ──
  function ensureBar() {
    if (bar || !doc?.createElement || !doc.body) return bar;
    bar = doc.createElement('div');
    bar.id = 'skin-preview-bar';
    bar.className = 'skin-preview-bar hidden';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<svg class="gi spb-ic" aria-hidden="true"><use href="#gi-eye"/></svg>'
      + '<span class="spb-t"></span><span class="spb-left g-num" dir="ltr"></span>'
      + '<button type="button" class="spb-buy"></button>'
      + '<button type="button" class="spb-x" aria-label="סיום תצוגה מקדימה">×</button>';
    bar.querySelector('.spb-x')?.addEventListener('click', () => endPreview('closed'));
    bar.querySelector('.spb-buy')?.addEventListener('click', () => {
      if (preview) bus?.emit?.(SKIN_PREVIEW_BUY, { id: preview.id });
    });
    doc.body.appendChild(bar);
    return bar;
  }
  function paintBar() {
    if (!preview) { bar?.classList?.add('hidden'); return; }
    const el = ensureBar();
    if (!el) return;
    const s = SKINS[preview.id];
    el.querySelector('.spb-t').textContent = `תצוגה מקדימה: ${s.name}`;
    el.querySelector('.spb-left').textContent = formatPreviewLeft(preview.endsAt - now());
    el.querySelector('.spb-buy').innerHTML = `${s.price.toLocaleString('en-US')} ${COIN_ICON_HTML}`;
    el.classList.remove('hidden');
  }

  function stopTimers() {
    if (endTimer != null) clearTimer(endTimer);
    if (tick != null) clearTick(tick);
    endTimer = tick = null;
  }

  function startPreview(id) {
    if (!isSkinId(id)) return false;
    if (ownsSkin(id, owned)) return choose(id);   // nothing to try: just use it
    stopTimers();
    preview = { id, endsAt: now() + previewMs };
    endTimer = setTimer(() => endPreview('timeout'), previewMs);
    tick = setTick(paintBar, 1000);
    render();
    return true;
  }

  function endPreview(reason = 'closed') {
    if (!preview) return false;
    const { id } = preview;
    stopTimers();
    preview = null;
    render();
    bus?.emit?.(SKIN_PREVIEW_ENDED, { id, reason });
    return true;
  }

  // Use a skin (Settings, the store's "הפעלה", right after buying). Unowned → false.
  function choose(id) {
    if (!isSkinId(id) || !ownsSkin(id, owned ?? [])) return false;
    if (preview) { stopTimers(); preview = null; }
    chosen = id;
    mergeUiPreferences(storage, { skin: id });
    render();
    return true;
  }

  // The profile's ownedSkins (null/undefined → none). A running try-on of a skin
  // that's now owned (just bought) becomes the choice.
  function setOwnedSkins(list) {
    owned = Array.isArray(list) ? [...list] : [];
    if (preview && ownsSkin(preview.id, owned)) { choose(preview.id); return; }
    render();
  }

  function dispose() {
    stopTimers();
    bar?.remove?.();
    bar = null;
  }

  applySkinToDocument(doc, active());

  return { active, snapshot, startPreview, endPreview, choose, setOwnedSkins, dispose };
}
