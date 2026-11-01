import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  DICT_INTENT,
  DICT_RENDER,
  formatQueryResult,
  formatWordInfo,
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
    fire(ev) { for (const l of listeners) if (l.ev === ev) l.fn({ preventDefault() {} }); },
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

test('formatWordInfo renders readings, extra-count and source, escaped', () => {
  const html = formatWordInfo({
    status: 'ready',
    info: { word: 'ספרים', sourceText: 'מקור: דיקטה', readings: ['שם עצם, רבים', '<b>x</b>'], more: 2 },
  });
  assert.match(html, /shinfo-word">ספרים</);
  assert.match(html, /<li>שם עצם, רבים<\/li>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /ועוד 2 ניתוחים נוספים/);
  assert.match(html, /shinfo-src">מקור: דיקטה</);
  assert.equal(formatWordInfo({ status: 'hidden' }), '');
  assert.match(formatWordInfo({ status: 'loading' }), /טוען/);
  assert.match(formatWordInfo({ status: 'missing' }), /אין מידע/);
  assert.match(formatWordInfo({ status: 'error' }), /לא ניתן/);
});

function wordInfoRoot() {
  const r = makeRoot();
  for (const id of ['#shinfo', '#settings-shinfo']) r.els[id] = makeEl({ hidden: true });
  for (const id of ['#shinfo-toggle', '#settings-shinfo-toggle']) r.els[id] = makeEl();
  return r;
}

test('word-info toggles start from the stored preference and stay in sync', () => {
  bus._reset();
  const { els, ...root } = wordInfoRoot();
  const events = [];
  bus.on(DICT_INTENT.TOGGLE_WORD_INFO, (p) => events.push(p));
  mountDictionaryScreen({ root, bus, getWordInfoEnabled: () => true });
  assert.equal(els['#shinfo-toggle'].checked, true);
  assert.equal(els['#settings-shinfo-toggle'].checked, true);
  els['#shinfo-toggle'].checked = false;
  els['#shinfo-toggle'].fire('change');
  assert.deepEqual(events, [{ enabled: false }]);
  assert.equal(els['#settings-shinfo-toggle'].checked, false);
});

test('WORD_INFO render fills and hides the panel of its target', () => {
  bus._reset();
  const { els, ...root } = wordInfoRoot();
  mountDictionaryScreen({ root, bus });
  bus.emit(DICT_RENDER.WORD_INFO, { target: 'main', status: 'ready', info: { word: 'בית', readings: ['שם עצם'], more: 0 } });
  assert.match(els['#shinfo'].innerHTML, /בית/);
  assert.equal(els['#shinfo'].classList.contains('hidden'), false);
  assert.equal(els['#settings-shinfo'].classList.contains('hidden'), true);
  bus.emit(DICT_RENDER.WORD_INFO, { target: 'main', status: 'hidden' });
  assert.equal(els['#shinfo'].innerHTML, '');
  assert.equal(els['#shinfo'].classList.contains('hidden'), true);
});
