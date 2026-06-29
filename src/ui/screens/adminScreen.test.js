// adminScreen unit tests. Hand-built DOM stub - no jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { mountAdminScreen, ADMIN_INTENT, ADMIN_RENDER } from './adminScreen.js';

function makeEl({ id = '', dataset = {}, value = '' } = {}) {
  const listeners = [];
  const classes = new Set();
  return {
    id,
    dataset,
    _listeners: listeners,
    value,
    style: {},
    textContent: '',
    innerHTML: '',
    disabled: false,
    checked: false,
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      toggle(c, on) { on ? classes.add(c) : classes.delete(c); },
      contains(c) { return classes.has(c); },
    },
    setAttribute(name, v) { this[name] = v; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex((l) => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    click() {
      for (const l of listeners.filter((l) => l.ev === 'click')) l.fn({ target: this });
    },
    change() {
      for (const l of listeners.filter((l) => l.ev === 'change')) l.fn({ target: this });
    },
    input() {
      for (const l of listeners.filter((l) => l.ev === 'input')) l.fn({ target: this });
    },
    dispatch(ev, event = { target: this }) {
      for (const l of listeners.filter((l) => l.ev === ev)) l.fn(event);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function makeDom() {
  const tabs = ['stats', 'players', 'words', 'reports', 'debug'].map((name) =>
    makeEl({ dataset: { admTab: name } })
  );
  const byId = new Map();
  const suggestionCheckboxes = [];
  const reportCheckboxes = [];
  for (const id of [
    'sadmin',
    'adm-panel-stats',
    'adm-panel-players',
    'adm-panel-words',
    'adm-panel-reports',
    'adm-panel-debug',
    'adm-select-all',
    'adm-bulk-bar',
    'adm-bulk-approve-btn',
    'adm-bulk-reject-btn',
    'adm-sugg-loading',
    'adm-sugg-empty',
    'adm-sugg-list',
    'adm-report-search',
    'adm-report-reason',
    'adm-report-status',
    'adm-report-load-btn',
    'adm-report-select-all',
    'adm-report-respond-btn',
    'adm-report-close-btn',
    'adm-report-list',
    'adm-report-count',
    'adm-report-response-modal',
    'adm-report-response-outcome',
    'adm-report-response-message',
    'adm-report-response-count',
    'adm-report-response-cancel',
    'adm-report-response-send',
    'adm-debug-games',
    'adm-debug-detail',
  ]) {
    byId.set(id, makeEl({ id }));
  }
  byId.get('adm-report-reason').value = 'all';
  byId.get('adm-report-status').value = 'open';
  byId.get('adm-report-response-outcome').value = 'handled';
  byId.get('adm-report-response-modal').classList.add('hidden');
  const screen = byId.get('sadmin');
  screen.querySelector = (sel) => {
    if (sel.startsWith('#')) return byId.get(sel.slice(1)) ?? null;
    return null;
  };
  screen.querySelectorAll = (sel) => {
    if (sel === '.adm-tab') return tabs;
    if (sel === '.adm-sugg-cb') return suggestionCheckboxes;
    if (sel === '.adm-sugg-cb:checked') return suggestionCheckboxes.filter((cb) => cb.checked);
    if (sel === '.adm-report-cb') return reportCheckboxes;
    if (sel === '.adm-report-cb:checked') return reportCheckboxes.filter((cb) => cb.checked);
    if (sel === '.adm-report-cb:not(:disabled)') return reportCheckboxes.filter((cb) => !cb.disabled);
    return [];
  };
  const root = {
    querySelector(sel) {
      if (sel === '#sadmin') return screen;
      return screen.querySelector(sel);
    },
    querySelectorAll(sel) {
      return screen.querySelectorAll(sel);
    },
  };
  return { root, byId, tabs, suggestionCheckboxes, reportCheckboxes };
}

test('reports tab loads, renders, filters, and opens linked debug timeline', () => {
  bus._reset();
  const { root, byId, tabs } = makeDom();
  const loads = [];
  const timelines = [];
  bus.on(ADMIN_INTENT.LOAD_DEBUG_REPORTS, (payload) => loads.push(payload));
  bus.on(ADMIN_INTENT.LOAD_DEBUG_TIMELINE, (payload) => timelines.push(payload));

  mountAdminScreen({ root, bus });
  tabs[3].click();

  assert.equal(loads.length, 1);
  assert.equal(byId.get('adm-panel-reports').style.display, '');

  bus.emit(ADMIN_RENDER.DEBUG_REPORTS, {
    reports: [
      { key: 'r1', reason: 'game-bug', userMessage: 'board froze', playerName: 'Dana', gameId: 'game-1', appVersion: '1' },
      { key: 'r2', reason: 'dictionary', userMessage: 'missing word', playerName: 'Noam', appVersion: '1' },
      { key: 'r3', reason: 'feedback', userMessage: 'done already', playerName: 'Gil', status: 'resolved', appVersion: '1' },
    ],
  });

  assert.match(byId.get('adm-report-list').innerHTML, /board froze/);
  assert.match(byId.get('adm-report-list').innerHTML, /missing word/);
  assert.doesNotMatch(byId.get('adm-report-list').innerHTML, /done already/);
  assert.equal(byId.get('adm-report-count').textContent, '2 / 3');

  byId.get('adm-report-reason').value = 'dictionary';
  byId.get('adm-report-reason').change();

  assert.doesNotMatch(byId.get('adm-report-list').innerHTML, /board froze/);
  assert.match(byId.get('adm-report-list').innerHTML, /missing word/);
  assert.equal(byId.get('adm-report-count').textContent, '1 / 3');

  byId.get('adm-report-list').onclick({
    target: {
      closest(sel) {
        return sel === '[data-report-game]' ? { dataset: { reportGame: 'game-1' } } : null;
      },
    },
  });

  assert.deepEqual(timelines, [{ gameId: 'game-1' }]);
  assert.equal(byId.get('adm-panel-debug').style.display, '');
});

test('bulk reject emits REJECT_SUGGESTION for each checked suggestion', () => {
  bus._reset();
  const { root, byId, suggestionCheckboxes } = makeDom();
  const rejected = [];
  bus.on(ADMIN_INTENT.REJECT_SUGGESTION, (payload) => rejected.push(payload));

  mountAdminScreen({ root, bus });
  bus.emit(ADMIN_RENDER.DATA, {
    suggestions: [
      { key: 's1', word: 'נאצר', status: 'pending', type: 'remove' },
      { key: 's2', word: 'מילה', status: 'pending', type: 'add' },
      { key: 's3', word: 'ישן', status: 'approved', type: 'add' },
    ],
  });

  suggestionCheckboxes.splice(
    0,
    suggestionCheckboxes.length,
    makeEl({ dataset: { admKey: 's1' } }),
    makeEl({ dataset: { admKey: 's2' } }),
  );
  suggestionCheckboxes[0].checked = true;
  suggestionCheckboxes[1].checked = true;
  byId.get('adm-sugg-list').dispatch('change', {
    target: { classList: { contains: (name) => name === 'adm-sugg-cb' } },
  });

  assert.equal(byId.get('adm-bulk-reject-btn').disabled, false);
  assert.match(byId.get('adm-bulk-reject-btn').textContent, /הסר 2 נבחרים/);

  byId.get('adm-bulk-reject-btn').click();

  assert.deepEqual(rejected, [{ key: 's1' }, { key: 's2' }]);
});

test('report checkboxes enable close button and emit CLOSE_DEBUG_REPORTS', () => {
  bus._reset();
  const { root, byId, reportCheckboxes } = makeDom();
  const closed = [];
  bus.on(ADMIN_INTENT.CLOSE_DEBUG_REPORTS, (payload) => closed.push(payload));

  mountAdminScreen({ root, bus });
  bus.emit(ADMIN_RENDER.DEBUG_REPORTS, {
    reports: [
      { key: 'r1', reason: 'game-bug', userMessage: 'first' },
      { key: 'r2', reason: 'feedback', userMessage: 'second' },
    ],
  });

  assert.match(byId.get('adm-report-list').innerHTML, /adm-report-cb/);
  reportCheckboxes.splice(
    0,
    reportCheckboxes.length,
    makeEl({ dataset: { reportKey: 'r1' } }),
    makeEl({ dataset: { reportKey: 'r2' } }),
  );
  reportCheckboxes[0].checked = true;
  reportCheckboxes[1].checked = true;
  byId.get('adm-report-list').dispatch('change', {
    target: { classList: { contains: (name) => name === 'adm-report-cb' } },
  });

  assert.equal(byId.get('adm-report-close-btn').disabled, false);
  assert.match(byId.get('adm-report-close-btn').textContent, /סגור 2 פניות/);

  byId.get('adm-report-close-btn').click();

  assert.deepEqual(closed, [{ keys: ['r1', 'r2'] }]);
  assert.equal(byId.get('adm-report-close-btn').disabled, true);
});

test('report response modal emits RESPOND_DEBUG_REPORTS with outcome and message', () => {
  bus._reset();
  const { root, byId, reportCheckboxes } = makeDom();
  const responses = [];
  bus.on(ADMIN_INTENT.RESPOND_DEBUG_REPORTS, (payload) => responses.push(payload));

  mountAdminScreen({ root, bus });
  bus.emit(ADMIN_RENDER.DEBUG_REPORTS, {
    reports: [
      { key: 'r1', reason: 'game-bug', userMessage: 'first', userId: 'u1' },
      { key: 'r2', reason: 'feedback', userMessage: 'second', userId: 'u2' },
    ],
  });

  reportCheckboxes.splice(
    0,
    reportCheckboxes.length,
    makeEl({ dataset: { reportKey: 'r1' } }),
    makeEl({ dataset: { reportKey: 'r2' } }),
  );
  reportCheckboxes[0].checked = true;
  reportCheckboxes[1].checked = true;
  byId.get('adm-report-list').dispatch('change', {
    target: { classList: { contains: (name) => name === 'adm-report-cb' } },
  });

  assert.equal(byId.get('adm-report-respond-btn').disabled, false);
  assert.match(byId.get('adm-report-respond-btn').textContent, /השב וסגור 2/);

  byId.get('adm-report-respond-btn').click();
  assert.equal(byId.get('adm-report-response-modal').classList.contains('hidden'), false);

  byId.get('adm-report-response-outcome').value = 'appreciated';
  byId.get('adm-report-response-message').value = 'תודה רבה על ההצעה';
  byId.get('adm-report-response-send').click();

  assert.deepEqual(responses, [{
    keys: ['r1', 'r2'],
    outcome: 'appreciated',
    message: 'תודה רבה על ההצעה',
  }]);
  assert.equal(byId.get('adm-report-response-modal').classList.contains('hidden'), true);
});
