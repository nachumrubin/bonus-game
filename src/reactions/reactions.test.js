import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReactionPayload, getReactionDisplay, getBoostieClip } from './reactionsConfig.js';
import { mountReactionController } from './reactionController.js';
import { EV } from '../events/eventTypes.js';
import { BOOSTIE_REACTIONS } from '../game/account/boostieCatalog.js';

test('reactionsConfig: Boostie reactions validate against the catalog and show their emoji', () => {
  for (const r of BOOSTIE_REACTIONS) {
    assert.ok(validateReactionPayload({ type: 'boostie', id: r.id }), r.id);
    assert.equal(getReactionDisplay({ type: 'boostie', id: r.id }), r.emoji);
    assert.equal(getBoostieClip({ type: 'boostie', id: r.id }), r.clip);
  }
  assert.equal(validateReactionPayload({ type: 'boostie', id: 'dance' }), false);
  assert.equal(getBoostieClip({ type: 'emoji', id: 'laugh' }), null, 'the emoji "laugh" is a bubble, not a clip');
  assert.equal(getReactionDisplay({ type: 'emoji', id: 'laugh' }), '😂');
});

// ---------- the controller on a tiny fake DOM ----------
function fakeEl(id) {
  const listeners = {};
  const classes = new Set();
  return {
    id, style: {}, dataset: {}, innerHTML: '', disabled: false,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    setAttribute() {}, removeAttribute() {},
    addEventListener(t, fn) { (listeners[t] ??= []).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn); },
    fire(t, e) { (listeners[t] ?? []).forEach((fn) => fn(e)); },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 10, right: 60, top: 10, bottom: 60, width: 50, height: 50 }),
    appendChild() {}, remove() {},
  };
}
function fakeRoot() {
  const els = Object.fromEntries(['rxn-overlay', 'rxn-panel', 'rxn-btn-slot0', 'rxn-btn-slot1', 'is-av1', 'is-av2', 'is-sb1', 'is-sb2']
    .map((id) => [id, fakeEl(id)]));
  const bubbles = [];
  return {
    els, bubbles,
    getElementById: (id) => els[id] ?? null,
    createElement: () => { const e = fakeEl(); e.appendChild = (c) => { e.child = c; }; return e; },
    body: { appendChild: (e) => bubbles.push(e.child?.textContent) },
    documentElement: { clientWidth: 360 },
    addEventListener() {}, removeEventListener() {},
  };
}
function fakeBus() {
  const subs = new Map();
  return {
    on(t, fn) { (subs.get(t) ?? subs.set(t, []).get(t)).push(fn); return () => {}; },
    emit(t, p) { (subs.get(t) ?? []).forEach((fn) => fn(p)); },
  };
}
const fakeDb = () => { const writes = []; return { writes, ref: () => ({ set: async (v) => { writes.push(v); } }) }; };
const panelTarget = (type, id) => ({ closest: (sel) => (sel === '[data-rxn-type][data-rxn-id]' ? { dataset: { rxnType: type, rxnId: id } } : null) });

globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

test('reaction tray: the Boostie row offers the free set plus owned ones', () => {
  const root = fakeRoot();
  const ctrl = mountReactionController({ bus: fakeBus(), db: fakeDb(), roomId: 'r1', mySlot: 0, storage: null, root, getOwnedReactions: () => ['wink'] });
  root.els['rxn-btn-slot0'].fire('click', { stopPropagation() {} });
  const html = root.els['rxn-panel'].innerHTML;
  for (const id of ['laugh', 'wow', 'stare', 'wink']) assert.match(html, new RegExp(`data-rxn-type="boostie" data-rxn-id="${id}"`));
  assert.doesNotMatch(html, /data-rxn-type="boostie" data-rxn-id="yawn"/, 'not bought');
  assert.match(html, /data-rxn-type="emoji"/, 'the emoji and message reactions stay');
  ctrl.dispose();
});

test('reaction tray: sending plays on my live Boostie, else the emoji bubble; the receiver plays it on the sender', async () => {
  const root = fakeRoot();
  const bus = fakeBus();
  const db = fakeDb();
  const played = [];
  let live = true;
  const ctrl = mountReactionController({ bus, db, roomId: 'r1', mySlot: 0, storage: null, root,
    playBoostie: (slot, clip) => { played.push([slot, clip]); return live; } });
  root.els['rxn-panel'].fire('click', { target: panelTarget('boostie', 'laugh') });
  await Promise.resolve();
  assert.deepEqual(played, [[0, 'laugh']]);
  assert.equal(root.bubbles.length, 0, '3D carried it, no bubble');
  assert.deepEqual({ ...db.writes[0], ts: 0 }, { type: 'boostie', id: 'laugh', senderSlot: 0, ts: 0 });

  // The opponent's (paid) wink arrives; their slot is a still here → the emoji bubble.
  live = false;
  bus.emit(EV.REACTION_RECEIVED, { reaction: { type: 'boostie', id: 'wink', senderSlot: 1 } });
  assert.deepEqual(played.at(-1), [1, 'wink'], 'played whether or not I own it');
  assert.deepEqual(root.bubbles, ['😉']);
  // My own echo is ignored; unknown ids never play.
  bus.emit(EV.REACTION_RECEIVED, { reaction: { type: 'boostie', id: 'laugh', senderSlot: 0 } });
  bus.emit(EV.REACTION_RECEIVED, { reaction: { type: 'boostie', id: 'dance', senderSlot: 1 } });
  assert.equal(played.length, 2);
  ctrl.dispose();
});
