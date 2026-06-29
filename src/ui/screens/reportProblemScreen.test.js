import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { MENU_INTENT } from './menuScreen.js';
import { mountReportProblemScreen, REPORT_DONE, REPORT_SUBMIT } from './reportProblemScreen.js';

function makeEl({ classes = [] } = {}) {
  const classSet = new Set(classes);
  const listeners = [];
  return {
    value: '',
    textContent: '',
    _listeners: listeners,
    classList: {
      add(c) { classSet.add(c); },
      remove(c) { classSet.delete(c); },
      contains(c) { return classSet.has(c); },
    },
    focusCalled: false,
    focus() { this.focusCalled = true; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    click() {
      for (const l of listeners) {
        if (l.ev === 'click') l.fn({ preventDefault() {}, stopPropagation() {} });
      }
    },
  };
}

function makeDom() {
  const overlay = makeEl({ classes: ['hidden'] });
  const reason = makeEl();
  const input = makeEl();
  const status = makeEl();
  const send = makeEl();
  const cancel = makeEl();
  const bySelector = new Map([
    ['#report-reason', reason],
    ['#report-message', input],
    ['#report-status', status],
    ['#report-send', send],
    ['#report-cancel', cancel],
  ]);
  overlay.querySelector = (sel) => bySelector.get(sel) ?? null;
  const root = {
    querySelector(sel) {
      if (sel === '#ov-report') return overlay;
      return null;
    },
  };
  return { root, overlay, reason, input, status, send, cancel };
}

test('OPEN_REPORT_PROBLEM opens contact overlay and defaults to game-bug reason', () => {
  bus._reset();
  const { root, overlay, reason } = makeDom();
  mountReportProblemScreen({ root, bus });

  reason.value = 'feedback';
  bus.emit(MENU_INTENT.OPEN_REPORT_PROBLEM);

  assert.equal(overlay.classList.contains('hidden'), false);
  assert.equal(reason.value, 'game-bug');
  assert.equal(reason.focusCalled, true);
});

test('send emits reason and trimmed user message', () => {
  bus._reset();
  const { root, reason, input, send } = makeDom();
  const seen = [];
  bus.on(REPORT_SUBMIT, (payload) => seen.push(payload));
  mountReportProblemScreen({ root, bus });

  bus.emit(MENU_INTENT.OPEN_REPORT_PROBLEM);
  reason.value = 'dictionary';
  input.value = '  חסרה מילה במילון  ';
  send.click();

  assert.deepEqual(seen[0], { reason: 'dictionary', userMessage: 'חסרה מילה במילון' });
});

test('REPORT_DONE paints success and failure statuses', () => {
  bus._reset();
  const { root, status } = makeDom();
  mountReportProblemScreen({ root, bus });

  bus.emit(REPORT_DONE, { ok: false });
  assert.match(status.textContent, /נכשלה/);

  bus.emit(REPORT_DONE, { ok: true });
  assert.match(status.textContent, /נשלחה/);
});
