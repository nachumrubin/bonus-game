import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  buildAdminSuggestionsHtml,
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
    checked: false,
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
    change(target) { for (const l of listeners) if (l.ev === 'change') l.fn({ target }); },
    focus() { this.focused = true; },
    select() { this.selected = true; },
    querySelector(sel) { return this._children?.[sel] ?? null; },
  };
}

function makeRoot() {
  const els = {
    '#ov-shailta': makeEl({ hidden: true }),
    '#ov-dict-login': makeEl({ hidden: true }),
    '#ov-dict-admin': makeEl({ hidden: true }),
    '#ov-dict-confirm': makeEl({ hidden: true }),
    '#shin': makeEl(),
    '#shres': makeEl(),
    '#settings-shin': makeEl(),
    '#settings-shres': makeEl(),
    '#dict-word-input': makeEl(),
    '#dict-word-status': makeEl(),
    '#dict-admin-password': makeEl(),
    '#dict-login-status': makeEl(),
    '#dict-admin-suggestions': makeEl(),
    '#dict-admin-confirm-text': makeEl(),
    '#dict-admin-logout-btn': makeEl({ hidden: true }),
    'button[onclick="openShailta()"]': makeEl({ onclick: 'openShailta()' }),
  };
  els['#ov-shailta']._children = {
    'button[onclick="checkShailta()"]': makeEl({ onclick: 'checkShailta()' }),
    'button[onclick="ovClose(\'ov-shailta\')"]': makeEl({ onclick: "ovClose('ov-shailta')" }),
  };
  els['#ov-dict-login']._children = {
    'button[onclick="dictionaryAdminSignIn()"]': makeEl({ onclick: 'dictionaryAdminSignIn()' }),
    'button[onclick="closeDictionaryAdvancedSettings()"]': makeEl({ onclick: 'closeDictionaryAdvancedSettings()' }),
  };
  els['#ov-dict-admin']._children = {
    'button[onclick="approveDictionaryWord()"]': makeEl({ onclick: 'approveDictionaryWord()' }),
    'button[onclick="rejectDictionaryWord()"]': makeEl({ onclick: 'rejectDictionaryWord()' }),
    'button[onclick="dictionaryAdminSignOut()"]': els['#dict-admin-logout-btn'],
    'button[onclick="closeAdminWindow()"]': makeEl({ onclick: 'closeAdminWindow()' }),
  };
  els['#ov-dict-confirm']._children = {
    'button[onclick="confirmDictionaryDecision()"]': makeEl({ onclick: 'confirmDictionaryDecision()' }),
    'button[onclick="cancelDictionaryDecision()"]': makeEl({ onclick: 'cancelDictionaryDecision()' }),
  };
  els['button[onclick="checkSettingsShailta()"]'] = makeEl({ onclick: 'checkSettingsShailta()' });
  els['button[onclick="suggestDictionaryWord()"]'] = makeEl({ onclick: 'suggestDictionaryWord()' });
  els['button[onclick="openDictionaryAdvancedSettings()"]'] = makeEl({ onclick: 'openDictionaryAdvancedSettings()' });

  return {
    els,
    querySelector(sel) {
      return els[sel] ?? null;
    },
  };
}

test('formatQueryResult renders empty, loading, valid, and invalid states', () => {
  assert.match(formatQueryResult({ reason: 'empty' }).text, /הקלד/);
  assert.match(formatQueryResult({ reason: 'loading' }).text, /נטען/);
  assert.equal(formatQueryResult({ word: 'בית', valid: true }).className, 'shres ok');
  assert.equal(formatQueryResult({ word: 'בייתת', valid: false }).className, 'shres bad');
});

test('buildAdminSuggestionsHtml renders escaped rows and empty state', () => {
  assert.match(buildAdminSuggestionsHtml([]), /אין הצעות/);
  const html = buildAdminSuggestionsHtml([{ id: 'x<1', word: '<אב>' }], new Set(['x<1']));
  assert.match(html, /x&lt;1/);
  assert.match(html, /&lt;אב&gt;/);
  assert.match(html, /checked/);
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

test('settings suggestion submit parses words and emits SUBMIT_SUGGEST', () => {
  bus._reset();
  const { els, ...root } = makeRoot();
  els['#dict-word-input'].value = 'חדש, חדש2,אחר';
  const events = [];
  bus.on(DICT_INTENT.SUBMIT_SUGGEST, (p) => events.push(p));
  mountDictionaryScreen({ root, bus });
  els['button[onclick="suggestDictionaryWord()"]'].click();
  assert.deepEqual(events, [{ words: ['חדש', 'אחר'] }]);
});

test('render events paint query and suggestion status', () => {
  bus._reset();
  const { els, ...root } = makeRoot();
  mountDictionaryScreen({ root, bus });
  bus.emit(DICT_RENDER.QUERY_RESULT, { target: 'settings', word: 'בית', valid: true });
  assert.match(els['#settings-shres'].textContent, /בית/);
  assert.equal(els['#settings-shres'].className, 'shres ok');
  bus.emit(DICT_RENDER.SUGGESTION_STATUS, { message: 'נשלח', isError: false });
  assert.equal(els['#dict-word-status'].textContent, 'נשלח');
});

test('admin approval requires selection then emits selected ids', () => {
  bus._reset();
  const { els, ...root } = makeRoot();
  const approvals = [];
  bus.on(DICT_INTENT.ADMIN_APPROVE, (p) => approvals.push(p));
  mountDictionaryScreen({ root, bus });
  bus.emit(DICT_RENDER.ADMIN_RENDER, { suggestions: [{ id: 's1', word: 'חדש' }] });

  els['#dict-admin-suggestions'].change({
    checked: true,
    getAttribute(name) { return name === 'data-dict-suggestion-id' ? 's1' : null; },
  });
  els['#ov-dict-admin']._children['button[onclick="approveDictionaryWord()"]'].click();

  assert.deepEqual(approvals, [{ ids: ['s1'], suggestions: [{ id: 's1', word: 'חדש' }] }]);
});
