import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffEvolutions, evolutionCopy, levelName, flashAt, EVO_T, CHANGE_LINES, LEVEL_NAMES, SEEN_KEY_PREFIX, EVO_SHOW, EVO_CLOSED } from './evolutionData.js';
import { BOOSTIES, BOOSTIE_LEVELS } from '../../game/account/boostieCatalog.js';
import { LEVEL_XP } from '../../game/account/boostieXp.js';
import { mountEvolutionScreen } from './evolutionScreen.js';
import { STORE_INTENT, boostieCardHtml, normalizeStoreState } from '../screens/avatarStoreScreen.js';

const xpFor = (level) => LEVEL_XP[level - 1];

test('diffEvolutions: first sight records the levels and shows nothing', () => {
  const r = diffEvolutions(null, { zapi: { xp: xpFor(4) } });
  assert.deepEqual(r.events, []);
  assert.equal(r.seen.zapi, 4);
  assert.equal(r.seen.bubo, 1, 'starters are always there');
});

test('diffEvolutions: a level-up (even several levels at once) is one event from the last seen level', () => {
  const r = diffEvolutions({ zapi: 2, bubo: 1 }, { zapi: { xp: xpFor(4) }, bubo: { xp: 0 } });
  assert.deepEqual(r.events, [{ kind: 'level', id: 'zapi', from: 2, to: 4 }]);
  assert.equal(r.seen.zapi, 4);
  assert.deepEqual(diffEvolutions(r.seen, { zapi: { xp: xpFor(4) } }).events, [], 'never twice');
});

test('diffEvolutions: a stale snapshot never lowers what was seen', () => {
  const r = diffEvolutions({ zapi: 5, bubo: 1 }, { zapi: { xp: xpFor(3) } });
  assert.deepEqual(r.events, []);
  assert.equal(r.seen.zapi, 5);
});

test('diffEvolutions: a new Boostie counts as a chain unlock only next to a top-level level-up', () => {
  // Pretend a chain Boostie exists by using an id the catalog knows: bubo absent from `seen`.
  const top = diffEvolutions({ zapi: BOOSTIE_LEVELS - 1 }, { zapi: { xp: xpFor(BOOSTIE_LEVELS) }, bubo: { xp: 0 } });
  assert.deepEqual(top.events, [
    { kind: 'level', id: 'zapi', from: BOOSTIE_LEVELS - 1, to: BOOSTIE_LEVELS },
    { kind: 'unlock', id: 'bubo' },
  ]);
  const bought = diffEvolutions({ zapi: 2 }, { zapi: { xp: xpFor(2) }, bubo: { xp: 0 } });
  assert.deepEqual(bought.events, [], 'a purchase alone is not an evolution');
});

test('evolution copy: every Boostie has a line for each new form; names follow §1', () => {
  assert.equal(LEVEL_NAMES.length, BOOSTIE_LEVELS);
  for (const id of Object.keys(BOOSTIES)) {
    for (let lv = 2; lv <= BOOSTIE_LEVELS; lv++) assert.ok(CHANGE_LINES[id]?.[lv], `${id} L${lv}`);
  }
  const c = evolutionCopy('zapi', 4);
  assert.match(c.title, /4/);
  assert.equal(c.levelName, levelName(4));
  assert.ok(c.change.length > 0);
  assert.equal(levelName(99), LEVEL_NAMES.at(-1));
});

test('flashAt: builds during the charge, peaks at the swap, gone after', () => {
  assert.equal(flashAt(0), 0);
  assert.ok(flashAt(EVO_T.charge * 0.8) < 0.4);
  assert.ok(Math.abs(flashAt(EVO_T.flashPeak) - 1) < 1e-9);
  assert.ok(flashAt(EVO_T.flashEnd) < 1e-9);
  assert.ok(EVO_T.charge < EVO_T.flashPeak && EVO_T.flashPeak < EVO_T.flashEnd && EVO_T.flashEnd < EVO_T.card);
});

// ---------- the overlay queue, on a tiny fake DOM ----------
function fakeEl() {
  const classes = new Set();
  const kids = new Map();
  const el = {
    attrs: {}, textContent: '', innerHTML: '', hidden: false, src: '', alt: '',
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
    setAttribute(k, v) { el.attrs[k] = v; }, getAttribute: (k) => el.attrs[k],
    querySelector: (sel) => { if (!kids.has(sel)) kids.set(sel, fakeEl()); return kids.get(sel); },
    addEventListener(t, fn) { el.onclickFn = fn; }, remove() { el.removed = true; }, focus() {},
  };
  return el;
}
function fakeDoc() {
  const body = { kids: [], append(e) { this.kids.push(e); }, contains(e) { return this.kids.includes(e); } };
  return { body, createElement: () => fakeEl(), addEventListener() {}, removeEventListener() {} };
}
function fakeBus() {
  const subs = new Map();
  const emitted = [];
  return {
    emitted,
    on(t, fn) { (subs.get(t) ?? subs.set(t, []).get(t)).push(fn); return () => {}; },
    emit(t, p) { emitted.push([t, p]); (subs.get(t) ?? []).forEach((fn) => fn(p)); },
  };
}
function memStorage() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; }

test('evolution screen: a level-up waits while a game is played, then shows (stills when no 3D)', async () => {
  const bus = fakeBus();
  const storage = memStorage();
  let busy = true;
  const scr = mountEvolutionScreen({ bus, doc: fakeDoc(), storage, isBusy: () => busy, canUse3d: () => false });
  scr.noteProfile('u1', { zapi: { xp: 0 } });                 // first sight
  assert.equal(JSON.parse(storage.getItem(SEEN_KEY_PREFIX + 'u1')).zapi, 1);
  scr.noteProfile('u1', { zapi: { xp: xpFor(2) } });
  assert.equal(scr._state().showing, null, 'held while the game runs');
  assert.equal(scr._state().queue.length, 1);
  busy = false;
  await new Promise((r) => setTimeout(r, 1600));
  assert.deepEqual(scr._state().showing, { kind: 'level', id: 'zapi', from: 1, to: 2 });
  scr._close();
  assert.equal(bus.emitted.find(([t]) => t === EVO_CLOSED)?.[1].id, 'zapi');
  scr.unmount();
});

test('evolution screen: replays from EVO_SHOW and the unlock card offers to equip', () => {
  const bus = fakeBus();
  const scr = mountEvolutionScreen({ bus, doc: fakeDoc(), storage: memStorage(), canUse3d: () => false });
  bus.emit(EVO_SHOW, { id: 'bubo', from: 3, to: 4 });
  assert.deepEqual(scr._state().showing, { kind: 'level', id: 'bubo', from: 3, to: 4 });
  scr._close();
  bus.emit(EVO_SHOW, { id: 'bubo', from: 4, to: 4 });
  assert.equal(scr._state().queue.length, 0, 'no fake level-ups');
  scr.unmount();
  // Equip from an unlock card.
  const bus2 = fakeBus();
  const doc = fakeDoc();
  const storage2 = memStorage();
  // Seen before bubo was owned (stands in for a chain Boostie; every Boostie is a starter today).
  storage2.setItem(SEEN_KEY_PREFIX + 'u2', JSON.stringify({ zapi: BOOSTIE_LEVELS - 1 }));
  const scr2 = mountEvolutionScreen({ bus: bus2, doc, storage: storage2, canUse3d: () => false });
  scr2.noteProfile('u2', { zapi: { xp: xpFor(BOOSTIE_LEVELS) }, bubo: { xp: 0 } });
  scr2._close();                                              // the level-up card
  return new Promise((r) => setTimeout(r, 400)).then(() => {
    assert.deepEqual(scr2._state().showing, { kind: 'unlock', id: 'bubo' });
    const el = doc.body.kids[0];
    el.onclickFn({ target: { closest: () => ({ classList: { contains: () => false }, getAttribute: () => 'equip' }) } });
    assert.deepEqual(bus2.emitted.find(([t]) => t === STORE_INTENT.EQUIP)?.[1], { id: 'bubo' });
    assert.equal(scr2._state().showing, null);
    scr2.unmount();
  });
});

test('store card: owned Boosties above level 1 get a replay button', () => {
  const st = normalizeStoreState({ boosties: { zapi: { xp: xpFor(3) }, bubo: { xp: 0 } }, equippedAvatar: 'zapi' });
  assert.match(boostieCardHtml('zapi', st), /data-store-action="watch"[^>]*data-level="3"/);
  assert.doesNotMatch(boostieCardHtml('bubo', st), /data-store-action="watch"/);
});
