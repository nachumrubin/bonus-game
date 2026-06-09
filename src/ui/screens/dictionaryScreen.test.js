import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  DICT_INTENT,
  DICT_RENDER,
  formatQueryResult,
  mountDictionaryScreen,
} from './dictionaryScreen.js';

function makeEl({ value = '', onclick = null, hidden = false } = {}) {
  const listeners = [];
  const attrs = onclick ? { onclick } : {};
  const cls = new Set(hidden ? ['hidden'] : []);
  return {
    value,
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    classList: {
      add(c) { cls.add(c); },
      remove(c) { cls.delete(c); },
      contains(c) { return cls.has(c); },
    },
    getAttribute(n) { return attrs[n] ?? null; },
    setAttribute(n, v) { attrs[n] = v; },
    removeAttribute(n) { delete attrs[n]; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    click() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
    keydown(key) { for (const l of listeners) if (l.ev === 'keydown') l.fn({ key, preventDefault() {} }); },
    focus() { this.focused = true; },
    select() { this.selected = true; },
    querySelector(sel) { return this._children?.[sel] ?? null; },
  };
}

function makeRoot() {
  const els = {
    '#ov-shailta':         makeEl({ hidden: true }),
    '#shin':               makeEl(),
    '#shres':              makeEl(),
    '#settings-shin':      makeEl(),
    '#settings-shres':     makeEl(),
    '#dict-word-input':    makeEl(),
    '#dict-word-status':   makeEl(),
    '#dict-remove-input':  makeEl(),
    '#dict-remove-status': makeEl(),
    'button[onclick="openShailta()"]':                 makeEl({ onclick: 'openShailta()' }),
    'button[onclick="checkSettingsShailta()"]':        makeEl({ onclick: 'checkSettingsShailta()' }),
    'button[onclick="suggestDictionaryWord()"]':       makeEl({ onclick: 'suggestDictionaryWord()' }),
    'button[onclick="suggestDictionaryRemoval()"]':    makeEl({ onclick: 'suggestDictionaryRemoval()' }),
  };
  els['#ov-shailta']._children = {
    'button[onclick="checkShailta()"]':            makeEl({ onclick: 'checkShailta()' }),
    'button[onclick="ovClose(\'ov-shailta\')"]':   makeEl({ onclick: "ovClose('ov-shailta')" }),
  };
  return { els, querySelector(sel) { return els[sel] ?? null; } };
}

test('formatQueryResult renders empty, loading, valid, and invalid states', () => {
  assert.match(formatQueryResult({ reason: 'empty' }).text, /הקלד/);
  assert.match(formatQueryResult({ reason: 'loading' }).text, /נטען/);
  assert.equal(formatQueryResult({ word: 'בית', valid: true }).className, 'shres ok');
  assert.equal(formatQueryResult({ word: 'בייתת', valid: false }).className, 'shres bad');
});

test('query check cleans input and emits CHECK_QUERY', () => {
  bus._reset();
  const { els, ...root } = makeRoot();
  els['#shin'].value = ' אבג! ';
  const events = [];
  bus.on(DICT_INTENT.CHECK_QUERY, (p) => events.push(p));
  mountDictionaryScreen({ root, bus });
  els['#ov-shailta']._children['button[onclick="checkShailta()"]'].click();
  assert.deepEqual(events, [{ word: 'אבג', target: 'main' }]);
  assert.equal(els['#shin'].value, '');
});

test('add-word submit parses input and emits SUBMIT_SUGGEST', () => {
  bus._reset();
  const { els, ...root } = makeRoot();
  els['#dict-word-input'].value = 'חדש, חדש2,אחר';
  const events = [];
  bus.on(DICT_INTENT.SUBMIT_SUGGEST, (p) => events.push(p));
  mountDictionaryScreen({ root, bus });
  els['button[onclick="suggestDictionaryWord()"]'].click();
  assert.deepEqual(events, [{ words: ['חדש', 'אחר'] }]);
});

test('remove-word submit parses input and emits SUBMIT_REMOVAL', () => {
  bus._reset();
  const { els, ...root } = makeRoot();
  els['#dict-remove-input'].value = 'מחק, מחק2,אחר';
  const events = [];
  bus.on(DICT_INTENT.SUBMIT_REMOVAL, (p) => events.push(p));
  mountDictionaryScreen({ root, bus });
  els['button[onclick="suggestDictionaryRemoval()"]'].click();
  assert.deepEqual(events, [{ words: ['מחק', 'אחר'] }]);
});

test('REMOVAL_STATUS render paints status into dict-remove-status', () => {
  bus._reset();
  const { els, ...root } = makeRoot();
  mountDictionaryScreen({ root, bus });
  bus.emit(DICT_RENDER.REMOVAL_STATUS, { message: 'הוסרה', isError: false });
  assert.equal(els['#dict-remove-status'].textContent, 'הוסרה');
});

test('render events paint query and suggestion status', () => {
  bus._reset();
  const { els, ...root } = makeRoot();
  mountDictionaryScreen({ root, bus });
  bus.emit(DICT_RENDER.QUERY_RESULT, { target: 'settings', word: 'בית', valid: true });
  assert.match(els['#settings-shres'].textContent, /בית/);
  assert.equal(els['#settings-shres'].className, 'shres ok');
  bus.emit(DICT_RENDER.SUGGESTION_STATUS, { message: 'נוספה', isError: false });
  assert.equal(els['#dict-word-status'].textContent, 'נוספה');
});
