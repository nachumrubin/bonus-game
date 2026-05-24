import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountWaitingRoomScreen,
  buildWhatsAppShareUrl,
  WR_INTENT, WR_OPEN, WR_CLOSE,
} from './waitingRoomScreen.js';

function makeEl(initial = {}) {
  const cl = new Set(initial.classes ?? []);
  const listeners = [];
  return {
    textContent: initial.textContent ?? '',
    classList: {
      contains(c) { return cl.has(c); },
      add(c) { cl.add(c); }, remove(c) { cl.delete(c); },
    },
    getAttribute(n) { return n === 'onclick' ? (initial.onclick ?? null) : null; },
    removeAttribute() {},
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeDom() {
  const els = {
    overlay: makeEl({ classes: ['hidden'] }),
    code:    makeEl(),
    mode:    makeEl(),
    cancel:  makeEl({ onclick: 'crCancelRoom()' }),
    share:   makeEl({ onclick: 'crShareWhatsApp()' }),
  };
  const root = {
    querySelector(sel) {
      switch (sel) {
        case '#ov-waiting-room':  return els.overlay;
        case '#wr-code':          return els.code;
        case '#wr-mode-label':    return els.mode;
        case 'button[onclick="crCancelRoom()"]':    return els.cancel;
        case 'button[onclick="crShareWhatsApp()"]': return els.share;
        default: return null;
      }
    },
  };
  return { root, els };
}

test('WR_OPEN unhides overlay + paints code + mode label', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountWaitingRoomScreen({ root, bus });

  bus.emit(WR_OPEN, { code: 'AB1234', mode: 'friend-live' });

  assert.equal(els.code.textContent, 'AB1234');
  assert.equal(els.mode.textContent, '⚡ משחק לייב');
  assert.equal(els.overlay.classList.contains('hidden'), false);
});

test('WR_OPEN with async mode shows async label', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountWaitingRoomScreen({ root, bus });
  bus.emit(WR_OPEN, { code: 'X', mode: 'friend-async' });
  assert.equal(els.mode.textContent, '📬 משחק אסינכרוני');
});

test('WR_CLOSE re-hides the overlay', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountWaitingRoomScreen({ root, bus });
  bus.emit(WR_OPEN,  { code: 'C', mode: 'friend-live' });
  bus.emit(WR_CLOSE, {});
  assert.equal(els.overlay.classList.contains('hidden'), true);
});

test('cancel button emits WR_INTENT.CANCEL', () => {
  bus._reset();
  const { root, els } = makeDom();
  let n = 0;
  bus.on(WR_INTENT.CANCEL, () => { n++; });
  mountWaitingRoomScreen({ root, bus });
  els.cancel.fireClick();
  assert.equal(n, 1);
});

test('share button emits WR_INTENT.SHARE_WHATSAPP', () => {
  bus._reset();
  const { root, els } = makeDom();
  let n = 0;
  bus.on(WR_INTENT.SHARE_WHATSAPP, () => { n++; });
  mountWaitingRoomScreen({ root, bus });
  els.share.fireClick();
  assert.equal(n, 1);
});

test('unmount stops further events', () => {
  bus._reset();
  const { root, els } = makeDom();
  let n = 0;
  bus.on(WR_INTENT.CANCEL, () => { n++; });
  const screen = mountWaitingRoomScreen({ root, bus });
  els.cancel.fireClick();
  screen.unmount();
  els.cancel.fireClick();
  assert.equal(n, 1);
});

test('buildWhatsAppShareUrl encodes code into wa.me link', () => {
  const url = buildWhatsAppShareUrl('ZX9999');
  assert.match(url, /^https:\/\/wa\.me\/\?text=/);
  assert.match(decodeURIComponent(url), /ZX9999/);
});
