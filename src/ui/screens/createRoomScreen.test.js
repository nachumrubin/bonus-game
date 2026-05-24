import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountCreateRoomScreen,
  readCreateRoomFilters,
  CR_INTENT,
} from './createRoomScreen.js';

function makeBtn({ onclick, classes = [] } = {}) {
  const cl = new Set(classes);
  const listeners = [];
  return {
    classList: {
      contains(c) { return cl.has(c); },
      add(c) { cl.add(c); }, remove(c) { cl.delete(c); },
    },
    getAttribute(n) { return n === 'onclick' ? (onclick ?? null) : null; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeDom({
  modeAsync = false, tlNo = false, botTime = '20', name = 'שחקן 1',
} = {}) {
  const els = {
    modeLive:  makeBtn({ classes: !modeAsync ? ['active'] : [] }),
    modeAsync: makeBtn({ classes: modeAsync  ? ['active'] : [] }),
    tlYes:     makeBtn({ classes: !tlNo ? ['active'] : [] }),
    tlNo:      makeBtn({ classes: tlNo  ? ['active'] : [] }),
    timeVal:   { textContent: botTime },
    nameInput: { value: name },
    confirm:   makeBtn({ onclick: 'crConfirm()' }),
    cancel:    makeBtn({ onclick: "ovClose('ov-create-room')" }),
  };
  const root = {
    querySelector(sel) {
      switch (sel) {
        case '#cr-mode-live':  return els.modeLive;
        case '#cr-mode-async': return els.modeAsync;
        case '#cr-tl-yes':     return els.tlYes;
        case '#cr-tl-no':      return els.tlNo;
        case '#cr-time-val':   return els.timeVal;
        case '#cr-name':       return els.nameInput;
        case 'button[onclick="crConfirm()"]': return els.confirm;
        case 'button[onclick="ovClose(\'ov-create-room\')"]': return els.cancel;
        default: return null;
      }
    },
  };
  return { root, els };
}

test('readCreateRoomFilters: live defaults', () => {
  const { root } = makeDom();
  assert.deepEqual(readCreateRoomFilters(root), {
    legacyMode: 'live',
    spineMode: 'friend-live',
    timelimit: true,
    botTime: 20,
    name: 'שחקן 1',
  });
});

test('readCreateRoomFilters: async forces timelimit=false', () => {
  const { root } = makeDom({ modeAsync: true, tlNo: false });
  const f = readCreateRoomFilters(root);
  assert.equal(f.spineMode, 'friend-async');
  assert.equal(f.timelimit, false);
});

test('readCreateRoomFilters: tl-no honored in live', () => {
  const { root } = makeDom({ tlNo: true });
  assert.equal(readCreateRoomFilters(root).timelimit, false);
});

test('readCreateRoomFilters: parses botTime, falls back on NaN', () => {
  assert.equal(readCreateRoomFilters(makeDom({ botTime: '45' }).root).botTime, 45);
  assert.equal(readCreateRoomFilters(makeDom({ botTime: 'xx' }).root).botTime, 20);
});

test('readCreateRoomFilters: trims name; empty falls back to default', () => {
  assert.equal(readCreateRoomFilters(makeDom({ name: '  ' }).root).name, 'שחקן 1');
  assert.equal(readCreateRoomFilters(makeDom({ name: 'נחום ' }).root).name, 'נחום');
});

test('mount: confirm click emits CONFIRM with filters; cancel emits CANCEL', () => {
  bus._reset();
  const { root, els } = makeDom({ modeAsync: true, name: 'דני' });
  const confirms = []; const cancels = [];
  bus.on(CR_INTENT.CONFIRM, (p) => confirms.push(p));
  bus.on(CR_INTENT.CANCEL,  () => cancels.push(1));
  mountCreateRoomScreen({ root, bus });

  els.confirm.fireClick();
  els.cancel.fireClick();

  assert.equal(confirms.length, 1);
  assert.equal(confirms[0].spineMode, 'friend-async');
  assert.equal(confirms[0].name, 'דני');
  assert.equal(cancels.length, 1);
});

test('mount: missing root buttons are tolerated', () => {
  bus._reset();
  const root = { querySelector: () => null };
  const screen = mountCreateRoomScreen({ root, bus });
  screen.unmount();
});
