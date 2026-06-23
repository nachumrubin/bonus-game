import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  ONBOARDING_SCREEN_ENTER,
  mountOnboardingController,
  registerOnboardingContent,
} from './onboardingController.js';

function makeEl() {
  const listeners = [];
  const classes = new Set(['hidden']);
  return {
    textContent: '',
    innerHTML: '',
    checked: false,
    dataset: {},
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c);
        else classes.delete(c);
      },
    },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
  };
}

function makeDocument() {
  const els = {
    overlay: makeEl(),
    icon: makeEl(),
    title: makeEl(),
    intro: makeEl(),
    body: makeEl(),
    note: makeEl(),
    cb: makeEl(),
    dismiss: makeEl(),
  };
  return {
    els,
    querySelector(sel) {
      switch (sel) {
        case '#ov-onboarding': return els.overlay;
        case '#onb-icon': return els.icon;
        case '#onb-title': return els.title;
        case '#onb-intro': return els.intro;
        case '#onb-body': return els.body;
        case '#onb-note': return els.note;
        case '#onb-noshowcb': return els.cb;
        case '#onb-dismiss-btn': return els.dismiss;
        default: return null;
      }
    },
  };
}

function makeStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('onboarding iconHtml renders trusted internal image markup', async () => {
  bus._reset();
  const previousDocument = globalThis.document;
  const doc = makeDocument();
  globalThis.document = doc;

  let controller;
  try {
    registerOnboardingContent('test-icon-html', {
      iconHtml: '<img class="screen-hd-icon" src="assets/avatars/anonymous player.png" alt="">',
      title: 'Profile',
      bullets: ['one'],
    });

    controller = mountOnboardingController({
      bus,
      storage: makeStorage(),
      triggerInitialScreen: null,
    });

    bus.emit(ONBOARDING_SCREEN_ENTER, { screenId: 'test-icon-html' });
    await wait(420);

    assert.match(doc.els.icon.innerHTML, /<img class="screen-hd-icon"/);
    assert.equal(doc.els.icon.textContent, '');
    assert.equal(doc.els.overlay.classList.contains('hidden'), false);
  } finally {
    controller?.unmount();
    globalThis.document = previousDocument;
  }
});

test('onboarding icon still treats plain icon text as text', async () => {
  bus._reset();
  const previousDocument = globalThis.document;
  const doc = makeDocument();
  globalThis.document = doc;

  let controller;
  try {
    registerOnboardingContent('test-icon-text', {
      icon: '<img src="bad.png">',
      title: 'Text icon',
      bullets: ['one'],
    });

    controller = mountOnboardingController({
      bus,
      storage: makeStorage(),
      triggerInitialScreen: null,
    });

    bus.emit(ONBOARDING_SCREEN_ENTER, { screenId: 'test-icon-text' });
    await wait(420);

    assert.equal(doc.els.icon.textContent, '<img src="bad.png">');
    assert.equal(doc.els.icon.innerHTML, '');
  } finally {
    controller?.unmount();
    globalThis.document = previousDocument;
  }
});
