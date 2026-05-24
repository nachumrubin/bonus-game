import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountJoinCodeScreen, readJoinCodeInputs, JC_INTENT,
} from './joinCodeScreen.js';

function makeBtn({ onclick } = {}) {
  const listeners = [];
  return {
    getAttribute(n) { return n === 'onclick' ? (onclick ?? null) : null; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeDom({ code = '', name = '' } = {}) {
  const els = {
    code:    { value: code },
    name:    { value: name },
    error:   { textContent: '' },
    confirm: makeBtn({ onclick: 'jcConfirm()' }),
    cancel:  makeBtn({ onclick: "ovClose('ov-join-code')" }),
  };
  const root = {
    querySelector(sel) {
      switch (sel) {
        case '#jc-code':  return els.code;
        case '#jc-name':  return els.name;
        case '#jc-error': return els.error;
        case 'button[onclick="jcConfirm()"]': return els.confirm;
        case 'button[onclick="ovClose(\'ov-join-code\')"]': return els.cancel;
        default: return null;
      }
    },
  };
  return { root, els };
}

test('readJoinCodeInputs: trims and falls back name to default', () => {
  const { root } = makeDom({ code: ' 123456 ', name: '   ' });
  assert.deepEqual(readJoinCodeInputs(root), { code: '123456', name: 'שחקן 2' });
});

test('confirm with valid 6-digit code emits CONFIRM with payload', () => {
  bus._reset();
  const { root, els } = makeDom({ code: '123456', name: 'דני' });
  const events = [];
  bus.on(JC_INTENT.CONFIRM, (p) => events.push(p));
  mountJoinCodeScreen({ root, bus });
  els.confirm.fireClick();
  assert.deepEqual(events, [{ code: '123456', name: 'דני' }]);
});

test('confirm with non-6-digit code emits ERROR and does NOT confirm', () => {
  bus._reset();
  const { root, els } = makeDom({ code: '12345', name: 'X' });
  const confirms = []; const errors = [];
  bus.on(JC_INTENT.CONFIRM, (p) => confirms.push(p));
  bus.on(JC_INTENT.ERROR,   (p) => errors.push(p));
  mountJoinCodeScreen({ root, bus });
  els.confirm.fireClick();
  assert.equal(confirms.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].reason, 'invalid-code');
  assert.match(els.error.textContent, /6 ספרות/);
});

test('confirm with letters in code rejects (digits-only)', () => {
  bus._reset();
  const { root, els } = makeDom({ code: '12a456' });
  const confirms = [];
  bus.on(JC_INTENT.CONFIRM, (p) => confirms.push(p));
  mountJoinCodeScreen({ root, bus });
  els.confirm.fireClick();
  assert.equal(confirms.length, 0);
});

test('cancel emits CANCEL', () => {
  bus._reset();
  const { root, els } = makeDom();
  let n = 0;
  bus.on(JC_INTENT.CANCEL, () => { n++; });
  mountJoinCodeScreen({ root, bus });
  els.cancel.fireClick();
  assert.equal(n, 1);
});

test('external JC_INTENT.ERROR paints localized message in #jc-error', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountJoinCodeScreen({ root, bus });
  bus.emit(JC_INTENT.ERROR, { reason: 'not-found' });
  assert.match(els.error.textContent, /לא נמצא/);
  bus.emit(JC_INTENT.ERROR, { reason: 'expired' });
  assert.match(els.error.textContent, /פג תוקף/);
  bus.emit(JC_INTENT.ERROR, { reason: 'self-claim' });
  assert.match(els.error.textContent, /שיצרת/);
  bus.emit(JC_INTENT.ERROR, { reason: 'already-claimed' });
  assert.match(els.error.textContent, /כבר הצטרף/);
});

test('unmount stops further confirm events', () => {
  bus._reset();
  const { root, els } = makeDom({ code: '123456' });
  let n = 0;
  bus.on(JC_INTENT.CONFIRM, () => { n++; });
  const screen = mountJoinCodeScreen({ root, bus });
  els.confirm.fireClick();
  screen.unmount();
  els.confirm.fireClick();
  assert.equal(n, 1);
});
