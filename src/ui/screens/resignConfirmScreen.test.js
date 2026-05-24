import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { mountResignConfirmScreen, RESIGN_INTENT, RESIGN_OPEN, RESIGN_CLOSE } from './resignConfirmScreen.js';

function makeEl() {
  const listeners = [];
  const cls = new Set(['hidden']);
  return {
    textContent: '',
    classList: {
      add(c) { cls.add(c); },
      remove(c) { cls.delete(c); },
      contains(c) { return cls.has(c); },
    },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    click() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeRoot(overlay, yes, no, msg) {
  overlay.querySelector = (sel) => {
    if (sel === '#resign-confirm-yes') return yes;
    if (sel === '#resign-confirm-no') return no;
    if (sel === '#resign-confirm-msg') return msg;
    return null;
  };
  return { querySelector: (sel) => sel === '#ov-resign-confirm' ? overlay : null };
}

test('opens, confirms, and cancels through bus intents', () => {
  bus._reset();
  const overlay = makeEl();
  const yes = makeEl();
  const no = makeEl();
  const msg = makeEl();
  const root = makeRoot(overlay, yes, no, msg);
  const events = [];
  bus.on(RESIGN_INTENT.CONFIRM, (p) => events.push(['confirm', p.slot]));
  bus.on(RESIGN_INTENT.CANCEL, (p) => events.push(['cancel', p.slot]));
  mountResignConfirmScreen({ root, bus });

  bus.emit(RESIGN_OPEN, { slot: 1, playerName: 'Bob' });
  assert.ok(!overlay.classList.contains('hidden'));
  assert.ok(msg.textContent.includes('Bob'));
  yes.click();
  assert.ok(overlay.classList.contains('hidden'));

  bus.emit(RESIGN_OPEN, { slot: 0 });
  no.click();
  assert.deepEqual(events, [['confirm', 1], ['cancel', 0]]);
});

test('RESIGN_CLOSE hides overlay', () => {
  bus._reset();
  const overlay = makeEl();
  const root = makeRoot(overlay, makeEl(), makeEl(), makeEl());
  mountResignConfirmScreen({ root, bus });
  bus.emit(RESIGN_OPEN, {});
  bus.emit(RESIGN_CLOSE, {});
  assert.ok(overlay.classList.contains('hidden'));
});
