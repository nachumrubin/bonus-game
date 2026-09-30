import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireGameMenu } from './gameMenu.js';

function fakeEl(name) {
  const listeners = {};
  const classes = new Set();
  const attrs = {};
  const el = {
    name,
    children: [],
    classList: {
      toggle(c, on) { on ? classes.add(c) : classes.delete(c); },
      contains(c) { return classes.has(c); },
    },
    setAttribute(k, v) { attrs[k] = v; },
    getAttribute(k) { return attrs[k]; },
    addEventListener(ev, fn) { (listeners[ev] ??= []).push(fn); },
    removeEventListener(ev, fn) { listeners[ev] = (listeners[ev] ?? []).filter(f => f !== fn); },
    fire(ev, e = {}) { for (const fn of listeners[ev] ?? []) fn({ target: el, ...e }); },
    contains(t) { return t === el || el.children.includes(t); },
    closest(sel) { return sel === 'button' && name.startsWith('btn') ? el : null; },
    listenerCount(ev) { return (listeners[ev] ?? []).length; },
  };
  return el;
}

function setup() {
  const doc = fakeEl('doc');
  const btn = fakeEl('btn-menu');
  const menu = fakeEl('menu');
  const item = fakeEl('btn-item');
  menu.children.push(item);
  btn.ownerDocument = doc;
  const root = { querySelector: (s) => ({ '#btn-game-menu': btn, '#gm-menu': menu })[s] ?? null };
  return { doc, btn, menu, item, root };
}

test('menu toggles open/closed from the ☰ button and syncs aria-expanded', () => {
  const { btn, menu, root } = setup();
  wireGameMenu(root);
  assert.equal(menu.classList.contains('open'), false);
  btn.fire('click');
  assert.equal(menu.classList.contains('open'), true);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  btn.fire('click');
  assert.equal(menu.classList.contains('open'), false);
});

test('clicking an item, tapping outside, or Escape closes the menu', () => {
  const { doc, btn, menu, item, root } = setup();
  wireGameMenu(root);
  btn.fire('click');
  menu.fire('click', { target: item });
  assert.equal(menu.classList.contains('open'), false);

  btn.fire('click');
  doc.fire('pointerdown', { target: item }); // inside → stays open
  assert.equal(menu.classList.contains('open'), true);
  doc.fire('pointerdown', { target: fakeEl('board') });
  assert.equal(menu.classList.contains('open'), false);

  btn.fire('click');
  doc.fire('keydown', { key: 'Escape' });
  assert.equal(menu.classList.contains('open'), false);
});

test('missing markup is a no-op; cleanup removes document listeners', () => {
  assert.equal(typeof wireGameMenu({ querySelector: () => null }), 'function');
  const { doc, root } = setup();
  const off = wireGameMenu(root);
  assert.equal(doc.listenerCount('pointerdown'), 1);
  off();
  assert.equal(doc.listenerCount('pointerdown'), 0);
  assert.equal(doc.listenerCount('keydown'), 0);
});
