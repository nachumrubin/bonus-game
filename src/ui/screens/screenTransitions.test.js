// Unit tests for BOOST GLIDE's DOM wiring (screenTransitions.showScreen).
//
// Covers the transition lifecycle: which classes land on the outgoing /
// incoming screens, glide direction (forward, back, RTL), Cascading Reveal on
// meaningful entries only, cleanup, interruption by rapid navigation, the
// reduced-motion path and the home topbar travelling with #sh.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  showScreen, revealCurrentScreen, SCREEN_IDS, _resetTransitionState, _getTransitionState,
  armCardMorph,
} from './screenTransitions.js';
import { REVEAL, BOOST_GLIDE, MAX_TOTAL_ENTRANCE, CARD_MORPH } from '../boostGlide.js';

// ── Minimal DOM fake ─────────────────────────────────────────────────────
function makeEl({ id = '', classes = [] } = {}) {
  const cls = new Set(classes);
  const props = new Map();
  const children = [];
  const el = {
    id,
    style: {
      display: '',
      setProperty(k, v) { props.set(k, v); },
      removeProperty(k) { props.delete(k); },
      getPropertyValue(k) { return props.get(k) ?? ''; },
    },
    attrs: {},
    setAttribute(k, v) { el.attrs[k] = v; },
    removeAttribute(k) { delete el.attrs[k]; },
    get className() { return Array.from(cls).join(' '); },
    classList: {
      add(...c) { c.forEach(x => cls.add(x)); },
      remove(...c) { c.forEach(x => cls.delete(x)); },
      contains(c) { return cls.has(c); },
    },
    children,
    append(...c) { children.push(...c); return el; },
    appendChild(c) { children.push(c); return c; },
    // Crude selector engine: comma lists of `.cls`, `#id` or `#id .cls`.
    querySelectorAll(sel) {
      const out = [];
      const all = [];
      (function walk(n) { for (const c of n.children) { all.push(c); walk(c); } })(el);
      for (const part of sel.split(',').map(p => p.trim())) {
        const last = part.split(/\s+/).pop();
        for (const c of all) {
          if ((last.startsWith('.') && c.classList.contains(last.slice(1)))
            || (last.startsWith('#') && c.id === last.slice(1))) {
            if (!out.includes(c)) out.push(c);
          }
        }
      }
      return out;
    },
    get offsetWidth() { return 1; },
  };
  return el;
}

function makeDoc({ dir = 'rtl', reduced = false } = {}) {
  const elements = new Map();
  for (const id of SCREEN_IDS) elements.set(id, makeEl({ id, classes: ['screen', 'hidden'] }));
  // Home markup (subset of partials/screens/home.html).
  const sh = elements.get('sh');
  const hlogo = makeEl({ classes: ['hlogo'] });
  const cards = makeEl({ classes: ['hm-cards'] });
  const nav = makeEl({ id: 'home-bottom-nav' });
  sh.append(hlogo, cards, nav);
  // Topbar lives outside #sh.
  const topbar = makeEl({ id: 'global-topbar' });
  const profile = makeEl({ classes: ['em-profile-btn'] });
  const icons = makeEl({ classes: ['em-topbar-icons'] });
  topbar.append(profile, icons);
  topbar.style.display = 'none';
  elements.set('global-topbar', topbar);
  // A glass screen with header + content (Statistics).
  const st = elements.get('sstats');
  const hdr = makeEl({ classes: ['g-hdr'] });
  const hero = makeEl({ classes: ['stats-hero'] });
  const feed = makeEl({ classes: ['stats-feed'] });
  st.append(hdr, hero, feed);

  const root = makeEl({});
  root.dir = dir;
  root.hasAttribute = (k) => k === 'data-reduced-motion' && reduced;
  const docRoot = makeEl({});
  docRoot.append(topbar);
  return {
    elements,
    parts: { hlogo, nav, topbar, profile, icons, hdr, hero, feed },
    doc: {
      documentElement: root,
      getElementById: (id) => elements.get(id) ?? null,
      querySelectorAll: (sel) => docRoot.querySelectorAll(sel),
    },
  };
}

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimeoutFn: (fn, ms) => { timers.push({ fn, ms, alive: true }); return timers.length; },
    clearTimeoutFn: (h) => { if (timers[h - 1]) timers[h - 1].alive = false; },
    runAll() { for (const t of timers) if (t.alive) { t.alive = false; t.fn(); } },
  };
}

beforeEach(() => _resetTransitionState());

const has = (el, c) => el.classList.contains(c);

// ── Visibility contract (unchanged legacy behaviour) ─────────────────────
test('showScreen marks target screen visible and others hidden', () => {
  const { doc, elements } = makeDoc();
  showScreen('sg', { doc, ...fakeTimers() });
  assert.ok(!has(elements.get('sg'), 'hidden'));
  assert.ok(has(elements.get('sh'), 'hidden'));
  assert.ok(has(elements.get('ss'), 'hidden'));
});

test('showScreen returns null when no matching screen element exists', () => {
  const result = showScreen('sg', { doc: { getElementById: () => null } });
  assert.equal(result, null);
});

test('topbar is shown only on the home screen', () => {
  const { doc, parts } = makeDoc();
  const t = fakeTimers();
  showScreen('sh', { doc, ...t });
  assert.equal(parts.topbar.style.display, '');
  showScreen('sstats', { doc, ...t });
  t.runAll();
  assert.equal(parts.topbar.style.display, 'none');
});

// ── Launch: Cascading Reveal only ─────────────────────────────────────────
test('launch → home: no glide, main-menu groups reveal in order', () => {
  const { doc, elements, parts } = makeDoc();
  showScreen('sh', { doc, ...fakeTimers() });
  assert.ok(!has(elements.get('sh'), 'glide-in'), 'nothing to glide from on launch');
  const delay = (el) => parseInt(el.style.getPropertyValue('--reveal-delay'), 10);
  for (const el of [parts.hlogo, parts.profile, parts.nav, parts.icons]) {
    assert.ok(has(el, 'reveal-item'), 'group gets reveal-item');
  }
  assert.equal(delay(parts.hlogo), 0);
  assert.equal(delay(parts.profile), REVEAL.staggerDelay);
  assert.ok(delay(parts.nav) > delay(parts.profile));
  assert.ok(delay(parts.icons) > delay(parts.nav), 'secondary controls come last');
  assert.ok(delay(parts.icons) + REVEAL.elementDuration <= MAX_TOTAL_ENTRANCE);
});

// ── Forward / back glide ─────────────────────────────────────────────────
test('forward: outgoing gets glide-out, incoming glide-in + reveal; RTL enters from the left', () => {
  const { doc, elements, parts } = makeDoc({ dir: 'rtl' });
  const t = fakeTimers();
  showScreen('sh', { doc, ...t });
  t.runAll();
  showScreen('sstats', { doc, ...t });
  const sh = elements.get('sh');
  const st = elements.get('sstats');
  assert.ok(has(sh, 'glide-out') && has(sh, 'hidden'), 'outgoing stays layered while hidden');
  assert.ok(has(st, 'glide-in') && !has(st, 'hidden'));
  assert.equal(st.style.getPropertyValue('--glide-dir'), '-1', 'RTL forward = from the left');
  assert.ok(has(parts.hdr, 'reveal-item') && has(parts.feed, 'reveal-item'));
  assert.ok(parseInt(parts.hdr.style.getPropertyValue('--reveal-delay'), 10) >= REVEAL.glideLead,
    'reveal overlaps the glide but starts just after it');
  // Topbar leaves with home rather than vanishing mid-glide.
  assert.ok(has(parts.topbar, 'glide-out'));
  assert.equal(parts.topbar.style.display, '');
});

test('LTR document uses the physical convention (forward enters from the right)', () => {
  const { doc, elements } = makeDoc({ dir: 'ltr' });
  const t = fakeTimers();
  showScreen('sh', { doc, ...t });
  showScreen('sstats', { doc, ...t });
  assert.equal(elements.get('sstats').style.getPropertyValue('--glide-dir'), '1');
});

test('back to an already visited screen reverses direction and does NOT replay the reveal', () => {
  const { doc, elements, parts } = makeDoc({ dir: 'rtl' });
  const t = fakeTimers();
  showScreen('sh', { doc, ...t });
  showScreen('sstats', { doc, ...t });
  t.runAll();
  assert.ok(!has(parts.hlogo, 'reveal-item'));
  showScreen('sh', { doc, ...t });
  const sh = elements.get('sh');
  assert.ok(has(sh, 'glide-in'));
  assert.equal(sh.style.getPropertyValue('--glide-dir'), '1', 'RTL back = from the right');
  assert.ok(has(elements.get('sstats'), 'glide-out'));
  assert.ok(!has(parts.hlogo, 'reveal-item'), 'no stagger when returning');
  assert.ok(has(parts.topbar, 'glide-in'), 'topbar returns with home');
});

test('explicit direction (popstate) wins over inference', () => {
  const { doc, elements } = makeDoc({ dir: 'ltr' });
  const t = fakeTimers();
  showScreen('sh', { doc, ...t });
  showScreen('sstats', { doc, ...t, direction: 'back' });
  assert.equal(elements.get('sstats').style.getPropertyValue('--glide-dir'), '-1');
});

// ── Cleanup / interruption ───────────────────────────────────────────────
test('cleanup timer strips every glide/reveal artefact after the entrance', () => {
  const { doc, elements, parts } = makeDoc();
  const t = fakeTimers();
  showScreen('sh', { doc, ...t });
  t.runAll();
  showScreen('sstats', { doc, ...t });
  const glideTimer = t.timers.filter(x => x.alive).find(x => x.ms !== 380);
  assert.ok(glideTimer, 'a single entrance cleanup is scheduled');
  assert.ok(glideTimer.ms >= BOOST_GLIDE.forwardDuration && glideTimer.ms <= MAX_TOTAL_ENTRANCE + 40);
  t.runAll();
  for (const el of [elements.get('sh'), elements.get('sstats'), parts.topbar]) {
    assert.ok(!has(el, 'glide-in') && !has(el, 'glide-out'));
    assert.equal(el.style.getPropertyValue('--glide-dir'), '');
  }
  assert.ok(!has(parts.hdr, 'reveal-item'));
  assert.equal(parts.topbar.style.display, 'none', 'topbar hidden once home has left');
  assert.equal(_getTransitionState().gliding, false);
});

test('rapid forward → back interrupts the running glide cleanly', () => {
  const { doc, elements, parts } = makeDoc();
  const t = fakeTimers();
  showScreen('sh', { doc, ...t });
  t.runAll();
  showScreen('sstats', { doc, ...t });          // forward, still running
  showScreen('sh', { doc, ...t });              // back before it settles
  const sh = elements.get('sh');
  const st = elements.get('sstats');
  assert.ok(!has(sh, 'hidden') && has(sh, 'glide-in') && !has(sh, 'glide-out'));
  assert.ok(has(st, 'hidden') && has(st, 'glide-out') && !has(st, 'glide-in'));
  assert.ok(!has(parts.hdr, 'reveal-item'), 'interrupted reveal flushed');
  assert.equal(parts.topbar.style.display, '', 'topbar back on home');
  t.runAll();
  assert.equal(parts.topbar.style.display, '', 'stale settle must not hide the topbar');
  assert.deepEqual(_getTransitionState().history, ['sh']);
});

test('re-showing the visible screen (re-render) does not replay anything', () => {
  const { doc, elements, parts } = makeDoc();
  const t = fakeTimers();
  showScreen('sh', { doc, ...t });
  showScreen('sstats', { doc, ...t });
  t.runAll();
  const before = t.timers.length;
  showScreen('sstats', { doc, ...t });
  assert.equal(t.timers.length, before, 'no timers scheduled');
  assert.ok(!has(elements.get('sstats'), 'glide-in'));
  assert.ok(!has(parts.hdr, 'reveal-item'));
});

test('new screen is pointer-blocked during its entrance (double-tap guard)', () => {
  const { doc, elements } = makeDoc();
  const t = fakeTimers();
  showScreen('sh', { doc, ...t });
  showScreen('sstats', { doc, ...t });
  assert.ok(has(elements.get('sstats'), 'screen-transitioning'));
  t.runAll();
  assert.ok(!has(elements.get('sstats'), 'screen-transitioning'));
});

// ── Reduced motion ───────────────────────────────────────────────────────
test('reduced motion: no glide, no reveal, no entrance timer', () => {
  const { doc, elements, parts } = makeDoc({ reduced: true });
  const t = fakeTimers();
  showScreen('sh', { doc, ...t });
  showScreen('sstats', { doc, ...t });
  assert.ok(!has(elements.get('sstats'), 'glide-in'));
  assert.ok(!has(elements.get('sh'), 'glide-out'));
  assert.ok(!has(parts.hdr, 'reveal-item'));
  assert.equal(parts.topbar.style.display, 'none', 'topbar hides immediately');
  assert.ok(t.timers.every(x => x.ms === 380), 'only the legacy click-block timer');
});

test('reducedMotion predicate overrides the root attribute', () => {
  const { doc, elements } = makeDoc({ reduced: false });
  const t = fakeTimers();
  showScreen('sh', { doc, ...t, reducedMotion: () => true });
  showScreen('sstats', { doc, ...t, reducedMotion: () => true });
  assert.ok(!has(elements.get('sstats'), 'glide-in'));
});

// ── Game screen ──────────────────────────────────────────────────────────
test('setup → gameplay glides but never staggers gameplay content', () => {
  const { doc, elements } = makeDoc();
  const t = fakeTimers();
  showScreen('sh', { doc, ...t });
  showScreen('ss', { doc, ...t });
  t.runAll();
  showScreen('sg', { doc, ...t });
  assert.ok(has(elements.get('sg'), 'glide-in'));
  assert.equal(_getTransitionState().revealing, false);
});

// ── Cold launch replay ───────────────────────────────────────────────────
test('revealCurrentScreen replays the home reveal once the loader lifts', () => {
  const { doc, parts } = makeDoc();
  const t = fakeTimers();
  showScreen('sh', { doc, ...t });
  t.runAll();
  assert.ok(!has(parts.hlogo, 'reveal-item'));
  assert.equal(revealCurrentScreen({ doc, ...t }), true);
  assert.ok(has(parts.hlogo, 'reveal-item'));
  t.runAll();
  assert.ok(!has(parts.hlogo, 'reveal-item'));
  assert.equal(revealCurrentScreen({ doc, ...t, reducedMotion: () => true }), false);
});

// ── Card morph (home game-mode card → its screen, and back) ──────────────
function morphDoc(opts) {
  const d = makeDoc(opts);
  const sh = d.elements.get('sh');
  const card = makeEl({ id: 'btn-online-lobby', classes: ['hm-card'] });
  card.getBoundingClientRect = () => ({ left: 16, top: 300, right: 396, bottom: 400, width: 380, height: 100 });
  card.cloneNode = () => {
    const g = makeEl({ id: 'btn-online-lobby', classes: ['hm-card'] });
    g.style.cssText = '';
    g.remove = () => { g.removed = true; };
    return g;
  };
  sh.append(card);
  sh.contains = (n) => sh.querySelectorAll('.hm-card').includes(n);
  for (const el of d.elements.values()) {
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 412, bottom: 860, width: 412, height: 860 });
  }
  d.doc.defaultView = { getComputedStyle: () => ({ borderRadius: '18px' }) };
  return { ...d, card, sh };
}
const ghostsOf = (el) => el.children.filter(c => c.classList.contains('ct-ghost') && !c.removed);

test('card morph: a tapped card grows into the screen it opens (no glide, no stagger)', () => {
  const { doc, elements, parts, card, sh } = morphDoc();
  const t = fakeTimers();
  showScreen('sh', { doc, ...t }); t.runAll();
  armCardMorph(card, { now: () => 1000 });
  showScreen('so', { doc, now: () => 1100, ...t });
  const so = elements.get('so');
  assert.ok(has(so, 'morph-in') && !has(so, 'glide-in'));
  assert.ok(has(sh, 'morph-out') && !has(sh, 'glide-out'));
  assert.ok(has(parts.topbar, 'morph-out'), 'topbar leaves with home');
  assert.equal(so.style.getPropertyValue('--ct-clip'), 'inset(300px 16px 460px 16px round 18px)');
  assert.equal(so.style.getPropertyValue('--ct-dur'), `${CARD_MORPH.openDuration}ms`);
  const [ghost] = ghostsOf(so);
  assert.ok(ghost, 'card copy on the growing screen');
  assert.equal(ghost.attrs.id, undefined, 'no duplicate id');
  assert.match(ghost.style.cssText, /left:16px;top:300px;width:380px;height:100px/);
  assert.ok(!_getTransitionState().revealing, 'the morph brings the content in itself');
  assert.ok(CARD_MORPH.openDuration <= MAX_TOTAL_ENTRANCE && CARD_MORPH.closeDuration <= MAX_TOTAL_ENTRANCE);
  assert.equal(Math.max(...t.timers.filter(x => x.alive).map(x => x.ms)), CARD_MORPH.openDuration + 20);
  t.runAll();
  assert.ok(!has(so, 'morph-in') && !has(sh, 'morph-out'));
  assert.equal(so.style.getPropertyValue('--ct-clip'), '');
  assert.ok(ghost.removed);
});

test('card morph: back to home from that screen shrinks it into the card again', () => {
  const { doc, elements, parts, card, sh } = morphDoc();
  const t = fakeTimers();
  showScreen('sh', { doc, ...t }); t.runAll();
  armCardMorph(card, { now: () => 0 });
  showScreen('so', { doc, now: () => 50, ...t }); t.runAll();
  showScreen('sh', { doc, ...t });
  const so = elements.get('so');
  assert.ok(has(so, 'morph-close') && has(so, 'hidden'));
  assert.ok(has(sh, 'morph-under') && !has(sh, 'glide-in'));
  assert.ok(has(parts.topbar, 'morph-under'));
  assert.equal(so.style.getPropertyValue('--ct-dur'), `${CARD_MORPH.closeDuration}ms`);
  assert.equal(ghostsOf(so).length, 1, 'the card fades back in where it was');
  t.runAll();
  // Only once: the next trip to `so` from elsewhere glides.
  showScreen('so', { doc, ...t });
  showScreen('sh', { doc, ...t });
  assert.ok(has(sh, 'glide-in') && !has(sh, 'morph-under'));
});

test('card morph: only for the navigation the tap triggered, forward, with motion', () => {
  const { doc, elements, card } = morphDoc();
  const t = fakeTimers();
  showScreen('sh', { doc, ...t }); t.runAll();
  // A stale tap (the card opened an overlay instead) does not hijack a later navigation.
  armCardMorph(card, { now: () => 0 });
  showScreen('sstats', { doc, now: () => CARD_MORPH.armWindow + 1, ...t });
  assert.ok(has(elements.get('sstats'), 'glide-in'));
  t.runAll();
  showScreen('sh', { doc, ...t }); t.runAll();
  // The arm is used up by the first navigation.
  armCardMorph(card, { now: () => 0 });
  showScreen('so', { doc, now: () => 10, ...t }); t.runAll();
  showScreen('sstats', { doc, now: () => 20, ...t });
  assert.ok(has(elements.get('sstats'), 'glide-in'));
  t.runAll();
  // Leaving the card's screen for another one drops the way back into the card.
  showScreen('sh', { doc, ...t });
  assert.ok(!has(elements.get('sh'), 'morph-under'));
});

test('card morph: reduced motion is a plain swap', () => {
  const { doc, elements, card, sh } = morphDoc({ reduced: true });
  const t = fakeTimers();
  showScreen('sh', { doc, ...t }); t.runAll();
  armCardMorph(card, { now: () => 0 });
  showScreen('so', { doc, now: () => 1, ...t });
  assert.ok(!has(elements.get('so'), 'morph-in') && !has(sh, 'morph-out'));
  assert.equal(ghostsOf(elements.get('so')).length, 0);
});

test('card morph: interrupted by the next navigation, everything is flushed at once', () => {
  const { doc, elements, card, sh } = morphDoc();
  const t = fakeTimers();
  showScreen('sh', { doc, ...t }); t.runAll();
  armCardMorph(card, { now: () => 0 });
  showScreen('so', { doc, now: () => 1, ...t });
  const so = elements.get('so');
  const [ghost] = ghostsOf(so);
  showScreen('sstats', { doc, ...t });
  assert.ok(!has(so, 'morph-in') && !has(sh, 'morph-out'));
  assert.ok(ghost.removed);
});
