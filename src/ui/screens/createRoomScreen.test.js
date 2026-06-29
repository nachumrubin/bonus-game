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

// The create-room UI uses fixed speed cards (בזק 20 / רגיל 40 / איטי 60),
// same as matchmaking. `botTime` selects which speed card is `.active`
// (default רגיל=40); `timelimit` is derived purely from live vs async mode.
function makeDom({
  modeAsync = false, botTime = 40, name = 'שחקן 1',
} = {}) {
  const els = {
    modeLive:  makeBtn({ classes: !modeAsync ? ['active'] : [] }),
    modeAsync: makeBtn({ classes: modeAsync  ? ['active'] : [] }),
    spd20:     makeBtn({ classes: botTime === 20 ? ['active'] : [] }),
    spd40:     makeBtn({ classes: botTime === 40 ? ['active'] : [] }),
    spd60:     makeBtn({ classes: botTime === 60 ? ['active'] : [] }),
    nameInput: { value: name },
    confirm:   makeBtn({ onclick: 'crConfirm()' }),
    cancel:    makeBtn({ onclick: "ovClose('ov-create-room')" }),
  };
  const root = {
    querySelector(sel) {
      switch (sel) {
        case '#cr-mode-live':  return els.modeLive;
        case '#cr-mode-async': return els.modeAsync;
        case '#cr-spd-20':     return els.spd20;
        case '#cr-spd-40':     return els.spd40;
        case '#cr-spd-60':     return els.spd60;
        case '#cr-name':       return els.nameInput;
        case 'button[onclick="crConfirm()"]': return els.confirm;
        case 'button[onclick="ovClose(\'ov-create-room\')"]': return els.cancel;
        default: return null;
      }
    },
  };
  return { root, els };
}

test('readCreateRoomFilters: live defaults (רגיל = 40s)', () => {
  const { root } = makeDom();
  assert.deepEqual(readCreateRoomFilters(root), {
    legacyMode: 'live',
    spineMode: 'friend-live',
    timelimit: true,
    botTime: 40,
    name: 'שחקן 1',
  });
});

test('readCreateRoomFilters: async forces timelimit=false', () => {
  const { root } = makeDom({ modeAsync: true });
  const f = readCreateRoomFilters(root);
  assert.equal(f.spineMode, 'friend-async');
  assert.equal(f.timelimit, false);
});

test('readCreateRoomFilters: timelimit is true in any live game', () => {
  assert.equal(readCreateRoomFilters(makeDom({ botTime: 20 }).root).timelimit, true);
});

test('readCreateRoomFilters: reads the active speed card', () => {
  assert.equal(readCreateRoomFilters(makeDom({ botTime: 20 }).root).botTime, 20);
  assert.equal(readCreateRoomFilters(makeDom({ botTime: 60 }).root).botTime, 60);
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
