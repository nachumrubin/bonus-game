import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSkinController, applySkinToDocument, formatPreviewLeft,
  SKIN_CHANGED, SKIN_PREVIEW_BUY, SKIN_PREVIEW_ENDED,
} from './skinController.js';
import { SKIN_PREVIEW_MS } from '../game/account/skinCatalog.js';

// ── a tiny document: <html>, theme-color meta, skin <link>s, and <body> ──
function makeClassList() {
  const set = new Set();
  return {
    set,
    add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c),
    toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)),
  };
}
function makeEl(tag = 'div') {
  const kids = {};
  const listeners = {};
  const el = {
    tagName: tag, id: '', textContent: '', attrs: {}, classList: makeClassList(), removed: false,
    set className(v) { for (const c of v.split(/\s+/).filter(Boolean)) el.classList.add(c); },
    _html: '',
    get innerHTML() { return el._html; },
    set innerHTML(v) {
      el._html = v;
      for (const m of v.matchAll(/class="([^"]+)"/g)) {
        for (const c of m[1].split(' ')) kids[c] ??= makeEl();
      }
    },
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return el.attrs[k] ?? null; },
    querySelector(sel) { return kids[sel.replace(/^\./, '')] ?? null; },
    addEventListener(ev, fn) { (listeners[ev] ??= []).push(fn); },
    fire(ev) { for (const fn of listeners[ev] ?? []) fn({}); },
    remove() { el.removed = true; },
  };
  return el;
}
function makeDoc() {
  const html = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const meta = makeEl('meta');
  const stoneLink = makeEl('link');
  stoneLink.setAttribute('data-skin-css', 'stone');
  stoneLink.media = 'not all';
  const body = { children: [], appendChild(c) { this.children.push(c); } };
  return {
    html, meta, stoneLink, body,
    documentElement: html,
    querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null),
    querySelectorAll: (sel) => (sel === 'link[data-skin-css]' ? [stoneLink] : []),
    createElement: (tag) => makeEl(tag),
  };
}
function makeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
function makeBus() {
  const log = [];
  return { log, emit: (ev, p) => log.push([ev, p]), last: (ev) => log.filter(([e]) => e === ev).at(-1)?.[1] };
}
function makeClock() {
  let t = 1_000_000;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms, live: true }; timers.push(h); return h; },
    clearTimer: (h) => { if (h) h.live = false; },
    setTick: () => ({ tick: true }),
    clearTick: () => {},
    advance(ms) { t += ms; for (const h of timers) if (h.live && h.at <= t) { h.live = false; h.fn(); } },
  };
}
function make({ prefs, owned } = {}) {
  const doc = makeDoc();
  const storage = makeStorage(prefs ? { 'spine.uiPreferences': JSON.stringify(prefs) } : {});
  const bus = makeBus();
  const clock = makeClock();
  const ctl = createSkinController({ doc, storage, bus, ...clock });
  if (owned !== undefined) ctl.setOwnedSkins(owned);
  return { doc, storage, bus, clock, ctl };
}
const savedSkin = (storage) => JSON.parse(storage.getItem('spine.uiPreferences') || '{}').skin;

test('applySkinToDocument: stone sets data-skin, switches its sheet on, recolours the browser chrome', () => {
  const doc = makeDoc();
  applySkinToDocument(doc, 'stone');
  assert.equal(doc.html.attrs['data-skin'], 'stone');
  assert.equal(doc.stoneLink.media, 'all');
  assert.equal(doc.meta.getAttribute('content'), '#f8f2e6');
  applySkinToDocument(doc, 'classic');
  assert.equal(doc.html.attrs['data-skin'], undefined);
  assert.equal(doc.stoneLink.media, 'not all');
  assert.equal(doc.meta.getAttribute('content'), '#04081a');
});

test('applySkinToDocument: an unknown id paints Classic', () => {
  const doc = makeDoc();
  applySkinToDocument(doc, 'stone');
  applySkinToDocument(doc, 'neon');
  assert.equal(doc.html.attrs['data-skin'], undefined);
});

test('formatPreviewLeft: m:ss, rounded up, never negative', () => {
  assert.equal(formatPreviewLeft(30_000), '0:30');
  assert.equal(formatPreviewLeft(24_100), '0:25');
  assert.equal(formatPreviewLeft(61_000), '1:01');
  assert.equal(formatPreviewLeft(-5), '0:00');
});

test('boot: the saved choice is trusted until the profile arrives; unowned then falls back to Classic', () => {
  const { doc, ctl } = make({ prefs: { skin: 'stone' } });
  assert.equal(ctl.active(), 'stone');
  assert.equal(doc.html.attrs['data-skin'], 'stone');
  ctl.setOwnedSkins([]);
  assert.equal(ctl.active(), 'classic');
  assert.equal(doc.html.attrs['data-skin'], undefined);
});

test('boot: an owned saved choice stays on', () => {
  const { ctl } = make({ prefs: { skin: 'stone' }, owned: ['stone'] });
  assert.equal(ctl.active(), 'stone');
});

test('choose: only an owned skin; saves the preference and emits SKIN_CHANGED', () => {
  const { ctl, storage, bus } = make({ owned: [] });
  assert.equal(ctl.choose('stone'), false);
  assert.equal(ctl.active(), 'classic');
  ctl.setOwnedSkins(['stone']);
  assert.equal(ctl.choose('stone'), true);
  assert.equal(ctl.active(), 'stone');
  assert.equal(savedSkin(storage), 'stone');
  assert.deepEqual(bus.last(SKIN_CHANGED), { active: 'stone', chosen: 'stone', owned: ['stone'], preview: null });
  assert.equal(ctl.choose('classic'), true);   // free skins are always owned
  assert.equal(savedSkin(storage), 'classic');
});

test('try-on: paints the skin with a countdown bar, then reverts after 30 s', () => {
  const { doc, ctl, bus, clock } = make({ owned: [] });
  assert.equal(ctl.startPreview('stone'), true);
  assert.equal(ctl.active(), 'stone');
  assert.equal(doc.html.attrs['data-skin'], 'stone');
  const bar = doc.body.children[0];
  assert.equal(bar.id, 'skin-preview-bar');
  assert.equal(bar.classList.contains('hidden'), false);
  assert.match(bar.querySelector('.spb-t').textContent, /אבן ירושלים/);
  assert.equal(bar.querySelector('.spb-left').textContent, '0:30');
  assert.match(bar.querySelector('.spb-buy').innerHTML, /1,500/);
  assert.equal(bus.last(SKIN_CHANGED).preview.id, 'stone');

  clock.advance(SKIN_PREVIEW_MS - 1);
  assert.equal(ctl.active(), 'stone');
  clock.advance(1);
  assert.equal(ctl.active(), 'classic');
  assert.equal(doc.html.attrs['data-skin'], undefined);
  assert.equal(bar.classList.contains('hidden'), true);
  assert.deepEqual(bus.last(SKIN_PREVIEW_ENDED), { id: 'stone', reason: 'timeout' });
});

test('try-on: × ends it early and the choice is untouched', () => {
  const { doc, ctl, bus, storage } = make({ owned: [] });
  ctl.startPreview('stone');
  doc.body.children[0].querySelector('.spb-x').fire('click');
  assert.equal(ctl.active(), 'classic');
  assert.deepEqual(bus.last(SKIN_PREVIEW_ENDED), { id: 'stone', reason: 'closed' });
  assert.equal(savedSkin(storage), undefined);
});

test('try-on: the bar\'s price button asks to buy', () => {
  const { doc, ctl, bus } = make({ owned: [] });
  ctl.startPreview('stone');
  doc.body.children[0].querySelector('.spb-buy').fire('click');
  assert.deepEqual(bus.last(SKIN_PREVIEW_BUY), { id: 'stone' });
});

test('try-on: buying mid-preview keeps the skin on as the new choice (no revert at 30 s)', () => {
  const { ctl, clock, storage, bus } = make({ owned: [] });
  ctl.startPreview('stone');
  ctl.setOwnedSkins(['stone']);
  assert.equal(ctl.snapshot().preview, null);
  assert.equal(savedSkin(storage), 'stone');
  clock.advance(SKIN_PREVIEW_MS);
  assert.equal(ctl.active(), 'stone');
  assert.equal(bus.last(SKIN_PREVIEW_ENDED), undefined);
});

test('try-on of an owned skin just uses it', () => {
  const { ctl } = make({ owned: ['stone'] });
  ctl.startPreview('stone');
  assert.equal(ctl.snapshot().preview, null);
  assert.equal(ctl.active(), 'stone');
});

test('try-on: unknown ids are ignored; dispose removes the bar and stops the timer', () => {
  const { doc, ctl, clock, bus } = make({ owned: [] });
  assert.equal(ctl.startPreview('neon'), false);
  ctl.startPreview('stone');
  ctl.dispose();
  assert.equal(doc.body.children[0].removed, true);
  clock.advance(SKIN_PREVIEW_MS);
  assert.equal(bus.last(SKIN_PREVIEW_ENDED), undefined);
});

test('warmSkinArt: fetches a paid skin\'s logo + loading tiles once, never Classic', async () => {
  const { warmSkinArt } = await import('./skinController.js');
  const got = [];
  class Img { set src(v) { got.push(v); } }
  assert.deepEqual(warmSkinArt('classic', Img), []);
  const srcs = warmSkinArt('marble', Img);
  assert.equal(srcs.length, 5);
  assert.ok(got.includes('assets/ui/logo_tiles_marble/row_bet.webp'));
  assert.ok(got.includes('assets/ui/boost-logo-marble.webp'));
  assert.deepEqual(warmSkinArt('marble', Img), [], 'only once per page');
});
