import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { mountSetupScreen, SETUP_INTENT, SETUP_OPEN } from './setupScreen.js';

function makeButton({ onclick, classes = [] } = {}) {
  const listeners = [];
  const attrs = onclick ? { onclick } : {};
  const cls = new Set(classes);
  return {
    style: {},
    classList: {
      add(c) { cls.add(c); }, remove(c) { cls.delete(c); }, contains(c) { return cls.has(c); },
    },
    getAttribute(n) { return attrs[n] ?? null; },
    setAttribute(n, v) { attrs[n] = v; },
    removeAttribute(n) { delete attrs[n]; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeInput(value = '') {
  return { value, style: {}, classList: { add() {}, remove() {} } };
}

function makeSetupDom() {
  const els = {
    title:     { textContent: 'הגדרות', style: {} },
    titleText: { textContent: 'הגדרות', style: {} },
    p1:       makeInput('שחקן 1'),
    p2:       makeInput('שחקן 2'),
    p2f:      { style: {} },
    dff:      { style: {} },
    diff0:    makeButton({ onclick: 'setDiff(0,this)', classes: ['db', 'a'] }),
    diff1:    makeButton({ onclick: 'setDiff(1,this)', classes: ['db'] }),
    diff2:    makeButton({ onclick: 'setDiff(2,this)', classes: ['db'] }),
    play:     makeButton({ onclick: 'startGame()' }),
    back:     makeButton({ onclick: 'goHome()' }),
  };
  const ss = {
    querySelector(sel) {
      switch (sel) {
        case '#stitle':      return els.title;
        case '#stitle-text': return els.titleText;
        case '#ip1':    return els.p1;
        case '#ip2':    return els.p2;
        case '#p2f':    return els.p2f;
        case '#dff':    return els.dff;
        case 'button[onclick="setDiff(0,this)"]': return els.diff0;
        case 'button[onclick="setDiff(1,this)"]': return els.diff1;
        case 'button[onclick="setDiff(2,this)"]': return els.diff2;
        case 'button[onclick="startGame()"]':     return els.play;
        case 'button[onclick="goHome()"]':        return els.back;
        default: return null;
      }
    },
  };
  const root = { querySelector(sel) { return sel === '#ss' ? ss : null; } };
  return { root, els };
}

test('mount: removes inline onclicks from setup buttons', () => {
  bus._reset();
  const { root, els } = makeSetupDom();
  mountSetupScreen({ root, bus });
  assert.equal(els.play.getAttribute('onclick'), null);
  assert.equal(els.back.getAttribute('onclick'), null);
  assert.equal(els.diff0.getAttribute('onclick'), null);
  assert.equal(els.diff1.getAttribute('onclick'), null);
  assert.equal(els.diff2.getAttribute('onclick'), null);
});

test('SETUP_OPEN with mode=vs shows P2 input, hides difficulty', () => {
  bus._reset();
  const { root, els } = makeSetupDom();
  mountSetupScreen({ root, bus });
  bus.emit(SETUP_OPEN, { mode: 'vs' });
  assert.equal(els.p2f.style.display, '');
  assert.equal(els.dff.style.display, 'none');
  assert.equal(els.titleText.textContent, 'שני שחקנים');
});

test('SETUP_OPEN with mode=bot shows difficulty, hides P2', () => {
  bus._reset();
  const { root, els } = makeSetupDom();
  mountSetupScreen({ root, bus });
  bus.emit(SETUP_OPEN, { mode: 'bot' });
  assert.equal(els.p2f.style.display, 'none');
  assert.equal(els.dff.style.display, '');
  assert.equal(els.titleText.textContent, 'נגד המחשב');
});

test('clicking the play button emits PLAY_CLICKED with names + difficulty + mode', () => {
  bus._reset();
  const { root, els } = makeSetupDom();
  const events = [];
  bus.on(SETUP_INTENT.PLAY_CLICKED, p => events.push(p));
  mountSetupScreen({ root, bus });
  bus.emit(SETUP_OPEN, { mode: 'bot', initialDifficulty: 2 });

  els.p1.value = 'נחום';
  els.diff2.fireClick(); // pick hard
  els.play.fireClick();

  assert.equal(events.length, 1);
  assert.equal(events[0].mode, 'bot');
  assert.equal(events[0].p1Name, 'נחום');
  assert.equal(events[0].difficulty, 2);
});

test('PLAY_CLICKED falls back to default names when input is blank', () => {
  bus._reset();
  const { root, els } = makeSetupDom();
  const events = [];
  bus.on(SETUP_INTENT.PLAY_CLICKED, p => events.push(p));
  mountSetupScreen({ root, bus });
  els.p1.value = '   ';
  els.p2.value = '';
  els.play.fireClick();
  assert.equal(events[0].p1Name, 'שחקן 1');
  assert.equal(events[0].p2Name, 'שחקן 2');
});

test('clicking a difficulty button updates the active class and emits DIFF_PICKED', () => {
  bus._reset();
  const { root, els } = makeSetupDom();
  const events = [];
  bus.on(SETUP_INTENT.DIFF_PICKED, p => events.push(p));
  mountSetupScreen({ root, bus });
  els.diff2.fireClick();
  assert.equal(events[0].difficulty, 2);
  assert.ok(els.diff2.classList.contains('a'));
  assert.ok(!els.diff0.classList.contains('a'));
  assert.ok(!els.diff1.classList.contains('a'));
});

test('clicking back emits BACK_CLICKED', () => {
  bus._reset();
  const { root, els } = makeSetupDom();
  const events = [];
  bus.on(SETUP_INTENT.BACK_CLICKED, p => events.push(p));
  mountSetupScreen({ root, bus });
  els.back.fireClick();
  assert.equal(events.length, 1);
});

test('unmount leaves onclick attributes stripped', () => {
  bus._reset();
  const { root, els } = makeSetupDom();
  const screen = mountSetupScreen({ root, bus });
  screen.unmount();
  assert.equal(els.play.getAttribute('onclick'), null);
  assert.equal(els.diff0.getAttribute('onclick'), null);
});
