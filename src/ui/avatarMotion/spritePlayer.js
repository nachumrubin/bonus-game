// spritePlayer — plays a pose clip (poseClips.js) on an avatar / achievement <img>.
//
//   await playOnImg(img, 'yourTurn')         → true if it animated, false if not
//   await playOnHost(el, 'win')              → same, for a container holding an .av-img
//   stopOnImg(img)                           → back to the static PNG
//   preloadFor(src)                          → warm the manifest + atlas image
//
// How it works: a <canvas> is laid exactly over the <img> (same offset box,
// same object-fit), the img is hidden with `visibility` so layout never moves,
// and each rAF tick draws the atlas frame(s) for the sampled pose plus CSS
// transforms/filters for the css tracks. Non-hold clips remove the canvas when
// they finish — frame 'rest' matches the source PNG, so the swap is invisible.
//
// Never animates when reduced motion is on (motionPreference.js), when there is
// no atlas for the image, or without a usable DOM. Presentation only: nothing
// here may gate gameplay, so callers must not await it on a gameplay path.

import { getMotionPreference } from '../motionPreference.js';
import { getAtlasManifest, normalizeAssetPath } from './atlasManifest.js';
import {
  getClip, sampleClip, resolveFrames, isClipDone, clipSuitsAtlas,
  TIER_STYLE, tierFromPath, clipNameForTier,
} from './poseClips.js';

const active = new WeakMap();      // img → controller
const sheetCache = new Map();      // atlas url → Promise<HTMLImageElement|null>
const sheetReady = new Set();      // atlas urls whose image has finished loading

function loadSheet(url, doc = globalThis.document) {
  if (!sheetCache.has(url)) {
    sheetCache.set(url, new Promise((resolve) => {
      if (!doc?.createElement) { resolve(null); return; }
      const im = doc.createElement('img');
      im.decoding = 'async';
      im.onload = () => { sheetReady.add(url); resolve(im); };
      im.onerror = () => { sheetCache.delete(url); resolve(null); };
      im.src = url;
    }));
  }
  return sheetCache.get(url);
}

export async function preloadFor(src) {
  const atlas = await getAtlasManifest().atlasFor(src);
  if (atlas) await loadSheet(atlas.atlas);
  return !!atlas;
}

// Synchronous "would playOnImg animate right now?" — lets a screen pick the 3D
// clip or its existing CSS cue in the same frame (never both). True only when
// motion is allowed, the manifest is loaded, and the atlas image is decoded,
// so call preloadFor(src) early (e.g. when the avatar is first rendered).
export function canPlayNow(img, clipName) {
  const clip = getClip(clipNameForTier(clipName, tierFromPath(normalizeAssetPath(img?.getAttribute?.('src')))));
  if (!clip || !img?.getAttribute || !img.isConnected) return false;
  if (typeof globalThis.requestAnimationFrame !== 'function' || !motionAllowed()) return false;
  const atlas = getAtlasManifest().lookup(img.getAttribute('src'));
  return !!atlas && clipSuitsAtlas(clip, atlas) && sheetReady.has(atlas.atlas);
}

export function canPlayNowOnHost(hostEl, clipName) {
  const img = hostEl?.querySelector?.('img.av-img, img');
  return img ? canPlayNow(img, clipName) : false;
}

// Rect of the drawn image inside a box of (bw, bh) for a given object-fit.
export function fitRect(fit, bw, bh, iw, ih) {
  if (fit === 'fill' || !iw || !ih) return { x: 0, y: 0, w: bw, h: bh };
  const s = fit === 'cover' ? Math.max(bw / iw, bh / ih) : Math.min(bw / iw, bh / ih);
  const w = iw * s, h = ih * s;
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}

export function cssFilter(css, style = TIER_STYLE.default) {
  const parts = [];
  if (css.bright !== 1) parts.push(`brightness(${css.bright.toFixed(3)})`);
  const g = css.glow * style.glowScale;
  if (g > 0.01) {
    parts.push(`drop-shadow(0 0 ${(g * 9).toFixed(1)}px rgba(${style.rgb},${Math.min(1, g * 0.9).toFixed(2)}))`);
  }
  return parts.join(' ') || 'none';
}

// Small radial spark burst around an avatar (epic / legendary moments).
function sparkleBurst(img, rgb, count = 12) {
  const doc = img.ownerDocument;
  const host = img.parentElement;
  if (!host || !doc?.createElement) return;
  const layer = doc.createElement('div');
  layer.className = 'av-sparkles';
  layer.style.cssText = `left:${img.offsetLeft}px;top:${img.offsetTop}px;width:${img.offsetWidth}px;height:${img.offsetHeight}px;`;
  for (let i = 0; i < count; i++) {
    const s = doc.createElement('i');
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const r = (0.38 + Math.random() * 0.22) * Math.max(img.offsetWidth, img.offsetHeight); // px
    s.style.cssText = `--sx:${(Math.cos(a) * r).toFixed(1)}px;--sy:${(Math.sin(a) * r).toFixed(1)}px;`
      + `--sc:rgb(${rgb});animation-delay:${(Math.random() * 0.12).toFixed(2)}s;`;
    layer.appendChild(s);
  }
  host.appendChild(layer);
  setTimeout(() => { try { layer.remove(); } catch { /* swallow */ } }, 1100);
}

export function cssTransform(css) {
  return `translate(${css.tx.toFixed(2)}%, ${css.ty.toFixed(2)}%) scale(${css.scale.toFixed(4)}) rotate(${css.rot.toFixed(2)}deg)`;
}

function motionAllowed() {
  try { return getMotionPreference().animationsEnabled(); } catch { return false; }
}

function makeCanvas(img) {
  const doc = img.ownerDocument;
  const c = doc.createElement('canvas');
  c.className = 'av-motion-canvas';
  c.setAttribute('aria-hidden', 'true');
  c.style.cssText = 'position:absolute;pointer-events:none;will-change:transform,filter;';
  img.insertAdjacentElement('afterend', c);
  return c;
}

function layoutCanvas(c, img) {
  const w = img.offsetWidth, h = img.offsetHeight;
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  c.style.left = `${img.offsetLeft}px`;
  c.style.top = `${img.offsetTop}px`;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  return { w: pw, h: ph };
}

function drawFrames(ctx, sheet, atlas, frames, box, fit) {
  const [cw, ch] = atlas.cell;
  const r = fitRect(fit, box.w, box.h, cw, ch);
  ctx.clearRect(0, 0, box.w, box.h);
  const blit = (idx, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.drawImage(sheet, (idx % atlas.cols) * cw, Math.floor(idx / atlas.cols) * ch, cw, ch, r.x, r.y, r.w, r.h);
  };
  blit(frames.a, 1);
  if (frames.mix > 0.01 && frames.b !== frames.a) blit(frames.b, frames.mix);
  ctx.globalAlpha = 1;
}

function teardown(img, ctl) {
  if (active.get(img) !== ctl) return;
  active.delete(img);
  try { ctl.canvas.remove(); } catch { /* swallow */ }
  img.style.visibility = ctl.prevVisibility;
}

export function stopOnImg(img) {
  const ctl = img && active.get(img);
  if (!ctl) return;
  ctl.cancelled = true;
  globalThis.cancelAnimationFrame?.(ctl.raf);
  ctl.resolve?.(false);
  teardown(img, ctl);
}

export async function playOnImg(img, clipName, { onDone } = {}) {
  const tier = tierFromPath(normalizeAssetPath(img?.getAttribute?.('src')));
  const style = TIER_STYLE[tier] ?? TIER_STYLE.default;
  const clip = getClip(clipNameForTier(clipName, tier));
  if (!clip || !img?.ownerDocument || !img.getAttribute || typeof globalThis.requestAnimationFrame !== 'function') return false;
  if (!motionAllowed()) return false;
  const atlas = await getAtlasManifest().atlasFor(img.getAttribute('src'));
  if (!atlas || !clipSuitsAtlas(clip, atlas)) return false;
  const sheet = await loadSheet(atlas.atlas, img.ownerDocument);
  if (!sheet || !img.isConnected) return false;

  // Reuse the canvas of a clip already running on this img (no flash between clips).
  const prev = active.get(img);
  let canvas;
  if (prev) {
    prev.cancelled = true;
    globalThis.cancelAnimationFrame?.(prev.raf);
    prev.resolve?.(false);
    canvas = prev.canvas;
  } else {
    canvas = makeCanvas(img);
  }
  const ctl = { canvas, raf: 0, cancelled: false, resolve: null, prevVisibility: prev ? prev.prevVisibility : img.style.visibility };
  active.set(img, ctl);
  img.style.visibility = 'hidden';
  const ctx = canvas.getContext('2d');
  const fit = globalThis.getComputedStyle?.(img)?.objectFit || 'contain';
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const t0 = now();
  let burstDone = false;

  return new Promise((resolve) => {
    ctl.resolve = resolve;
    const tick = () => {
      if (ctl.cancelled) return;
      // Gone, or (for endless loops) no longer rendered — don't burn frames/battery.
      if (!img.isConnected || (clip.loop && img.offsetParent === null && canvas.offsetParent === null)) {
        teardown(img, ctl); resolve(false); return;
      }
      const elapsed = now() - t0;
      const { pose, css } = sampleClip(clip, elapsed);
      const box = layoutCanvas(canvas, img);
      drawFrames(ctx, sheet, atlas, resolveFrames(atlas, pose), box, fit);
      canvas.style.transform = cssTransform(css);
      canvas.style.filter = cssFilter(css, style);
      if (clip.burstAt != null && !burstDone && elapsed >= clip.burstAt) {
        burstDone = true;
        if (style.sparkles) sparkleBurst(img, style.rgb);
      }
      if (isClipDone(clip, elapsed)) {
        if (!clip.hold) teardown(img, ctl);
        ctl.resolve = null;
        try { onDone?.(); } catch { /* swallow */ }
        resolve(true);
        return;
      }
      ctl.raf = globalThis.requestAnimationFrame(tick);
    };
    ctl.raf = globalThis.requestAnimationFrame(tick);
  });
}

export function playOnHost(hostEl, clipName, opts) {
  const img = hostEl?.querySelector?.('img.av-img, img');
  return img ? playOnImg(img, clipName, opts) : Promise.resolve(false);
}

export function stopOnHost(hostEl) {
  const img = hostEl?.querySelector?.('img.av-img, img');
  if (img) stopOnImg(img);
}
