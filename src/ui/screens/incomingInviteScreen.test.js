import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountIncomingInviteScreen,
  II_INTENT, IR_INTENT, II_OPEN, II_CLOSE, IR_OPEN, IR_CLOSE,
} from './incomingInviteScreen.js';

function makeEl(initial = {}) {
  const cl = new Set(initial.classes ?? []);
  const listeners = [];
  return {
    textContent: initial.textContent ?? '',
    classList: {
      contains(c) { return cl.has(c); },
      add(c) { cl.add(c); }, remove(c) { cl.delete(c); },
    },
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
    avatar:  makeEl(),
    body:    makeEl(),
    accept:  makeEl(),
    reject:  makeEl(),
    rejOverlay: makeEl({ classes: ['hidden'] }),
    rejDesc:    makeEl(),
    rejClose:   makeEl(),
  };
  const root = {
    querySelector(sel) {
      switch (sel) {
        case '#ov-incoming-invite':  return els.overlay;
        case '#ii-avatar':           return els.avatar;
        case '#ii-body':             return els.body;
        case 'button[onclick="_acceptIncomingInvite()"]':  return els.accept;
        case 'button[onclick="_dismissIncomingInvite()"]': return els.reject;
        case '#ov-invite-rejected':  return els.rejOverlay;
        case '#invite-rejected-desc':return els.rejDesc;
        case 'button[onclick="closeInviteRejectedNotice()"]': return els.rejClose;
        default: return null;
      }
    },
  };
  return { root, els };
}

test('II_OPEN paints avatar + body + unhides overlay', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountIncomingInviteScreen({ root, bus });
  bus.emit(II_OPEN, { fromName: 'נחום', fromAvatar: '🦁', mode: 'friend-live', inviteId: 'i1' });
  assert.equal(els.avatar.textContent, '🦁');
  assert.match(els.body.textContent, /נחום/);
  assert.match(els.body.textContent, /לייב/);
  assert.equal(els.overlay.classList.contains('hidden'), false);
});

test('II_OPEN with async mode shows async label', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountIncomingInviteScreen({ root, bus });
  bus.emit(II_OPEN, { fromName: 'דני', mode: 'friend-async' });
  assert.match(els.body.textContent, /אסינכרוני/);
});

test('II_OPEN without avatar clears previous avatar to anonymous player image', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountIncomingInviteScreen({ root, bus });
  bus.emit(II_OPEN, { fromName: 'A', fromAvatar: '⭐', mode: 'friend-live' });
  bus.emit(II_OPEN, { fromName: 'B', mode: 'friend-live' });
  assert.match(els.avatar.innerHTML ?? '', /anonymous player/);
});

test('accept emits ACCEPT with the pending invite payload', () => {
  bus._reset();
  const { root, els } = makeDom();
  const accepts = [];
  bus.on(II_INTENT.ACCEPT, (p) => accepts.push(p));
  mountIncomingInviteScreen({ root, bus });
  bus.emit(II_OPEN, { inviteId: 'i7', fromUid: 'u1', fromName: 'X' });
  els.accept.fireClick();
  assert.equal(accepts.length, 1);
  assert.equal(accepts[0].inviteId, 'i7');
  assert.equal(els.overlay.classList.contains('hidden'), true);
});

test('reject emits REJECT with the pending invite payload', () => {
  bus._reset();
  const { root, els } = makeDom();
  const rejects = [];
  bus.on(II_INTENT.REJECT, (p) => rejects.push(p));
  mountIncomingInviteScreen({ root, bus });
  bus.emit(II_OPEN, { inviteId: 'i8', fromUid: 'u2' });
  els.reject.fireClick();
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0].inviteId, 'i8');
  assert.equal(els.overlay.classList.contains('hidden'), true);
});

test('II_CLOSE rehides overlay and clears pending', () => {
  bus._reset();
  const { root, els } = makeDom();
  const screen = mountIncomingInviteScreen({ root, bus });
  bus.emit(II_OPEN, { inviteId: 'i9' });
  bus.emit(II_CLOSE, {});
  assert.equal(els.overlay.classList.contains('hidden'), true);
  assert.equal(screen.getPending(), null);
});

test('IR_OPEN paints message and unhides rejected overlay; IR_CLOSE rehides', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountIncomingInviteScreen({ root, bus });
  bus.emit(IR_OPEN, { message: 'הוא לחץ "לא"' });
  assert.equal(els.rejDesc.textContent, 'הוא לחץ "לא"');
  assert.equal(els.rejOverlay.classList.contains('hidden'), false);
  bus.emit(IR_CLOSE, {});
  assert.equal(els.rejOverlay.classList.contains('hidden'), true);
});

test('IR_OPEN with no message uses the default Hebrew copy', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountIncomingInviteScreen({ root, bus });
  bus.emit(IR_OPEN, {});
  assert.match(els.rejDesc.textContent, /לא זמין/);
});

test('rejected close button emits IR_INTENT.CLOSE', () => {
  bus._reset();
  const { root, els } = makeDom();
  let n = 0;
  bus.on(IR_INTENT.CLOSE, () => { n++; });
  mountIncomingInviteScreen({ root, bus });
  els.rejClose.fireClick();
  assert.equal(n, 1);
});

test('unmount stops further events', () => {
  bus._reset();
  const { root, els } = makeDom();
  let n = 0;
  bus.on(II_INTENT.ACCEPT, () => { n++; });
  const screen = mountIncomingInviteScreen({ root, bus });
  bus.emit(II_OPEN, { inviteId: 'a' });
  els.accept.fireClick();
  screen.unmount();
  bus.emit(II_OPEN, { inviteId: 'b' });
  els.accept.fireClick();
  assert.equal(n, 1);
});
