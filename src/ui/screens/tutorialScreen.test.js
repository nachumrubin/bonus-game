import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountTutorialScreen,
  TUTORIAL_CLEAR,
  TUTORIAL_INTENT,
  TUTORIAL_OPEN,
  TUTORIAL_TIP,
} from './tutorialScreen.js';

function makeEl({ hidden = true, onclick = null } = {}) {
  const listeners = [];
  const cls = new Set(hidden ? ['hidden'] : []);
  const attrs = onclick ? { onclick } : {};
  return {
    textContent: '',
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
  };
}

function makeRoot(elements) {
  return {
    querySelector(sel) { return elements[sel] ?? null; },
    querySelectorAll(sel) { return elements[sel] ? [elements[sel]] : []; },
  };
}

test('intro opens and start/back buttons emit tutorial intents', () => {
  bus._reset();
  const intro = makeEl();
  const start = makeEl({ onclick: 'startTutorial()' });
  const back = makeEl({ onclick: 'hideTutorialIntro()' });
  const seen = [];
  bus.on(TUTORIAL_INTENT.START, () => seen.push('start'));
  bus.on(TUTORIAL_INTENT.BACK, () => seen.push('back'));
  mountTutorialScreen({
    root: makeRoot({ '#tut-intro': intro, '#tut-intro-go': start, '#tut-intro-back': back }),
    bus,
  });

  bus.emit(TUTORIAL_OPEN, {});
  assert.ok(!intro.classList.contains('hidden'));
  start.click();
  back.click();
  assert.deepEqual(seen, ['start', 'back']);
});

test('tip paints text and spotlight classes, then clears them', () => {
  bus._reset();
  const tip = makeEl();
  const label = makeEl(false);
  const text = makeEl(false);
  const target = makeEl(false);
  mountTutorialScreen({
    root: makeRoot({
      '#tut-tip': tip,
      '#tut-tip-lbl': label,
      '#tut-tip-txt': text,
      '#target': target,
    }),
    bus,
  });

  bus.emit(TUTORIAL_TIP, { label: 'Step', text: 'Do it', selectors: ['#target'] });
  assert.equal(label.textContent, 'Step');
  assert.equal(text.textContent, 'Do it');
  assert.ok(target.classList.contains('tut-lit'));
  assert.ok(!tip.classList.contains('hidden'));

  bus.emit(TUTORIAL_CLEAR, {});
  assert.ok(!target.classList.contains('tut-lit'));
  assert.ok(tip.classList.contains('hidden'));
});
