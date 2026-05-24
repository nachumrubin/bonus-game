import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { EV } from '../../events/eventTypes.js';
import {
  describeScoreBonus, mountScoreBonusAnimation, _resetForTests,
} from './scoreBonusAnimation.js';

test('describeScoreBonus: returns null for non-score boosts', () => {
  assert.equal(describeScoreBonus({ boostId: 'extra_turn', payload: {} }), null);
  assert.equal(describeScoreBonus(null), null);
});

test('describeScoreBonus: returns null when extra is 0 or missing', () => {
  assert.equal(describeScoreBonus({ boostId: 'auto_extra_score', payload: { extra: 0 } }), null);
  assert.equal(describeScoreBonus({ boostId: 'auto_extra_score', payload: {} }), null);
});

test('describeScoreBonus: extracts slot/extra/label', () => {
  const r = describeScoreBonus({ slot: 1, boostId: 'auto_extra_score', payload: { extra: 25 } });
  assert.deepEqual(r, { slot: 1, extra: 25, label: '+25' });
});

test('describeScoreBonus: accepts entry-wrapped variant', () => {
  const r = describeScoreBonus({ entry: { slot: 0, boostId: 'auto_extra_score', payload: { extra: 100 } } });
  assert.equal(r.label, '+100');
  assert.equal(r.slot, 0);
});

function makeMockDoc() {
  const created = [];
  const head = { appendChild: (el) => head._appended = el };
  const body = {
    appendChild: (el) => body._appended = el,
  };
  const ids = {};
  return {
    head, body,
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        className: '', textContent: '', style: { cssText: '' },
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        appendChild() {},
        remove() { el._removed = true; },
      };
      created.push(el);
      return el;
    },
    getElementById(id) { return ids[id] ?? null; },
    _registerPanel(id, panel) { ids[id] = panel; },
    _created: created,
  };
}

function makePanel() {
  let appended = null;
  return {
    appendChild(c) { appended = c; },
    _appended: () => appended,
  };
}

test('mount: BOOST_ACTIVATED with score bonus appends a float to the panel', () => {
  bus._reset();
  _resetForTests();
  const doc = makeMockDoc();
  const panel = makePanel();
  doc._registerPanel('scn2', panel);
  mountScoreBonusAnimation({ bus, doc, durationMs: 50 });

  bus.emit(EV.BOOST_ACTIVATED, { slot: 1, boostId: 'auto_extra_score', payload: { extra: 50 } });
  const float = panel._appended();
  assert.ok(float);
  assert.equal(float.textContent, '+50');
});

test('mount: ignores non-score boost events', () => {
  bus._reset();
  _resetForTests();
  const doc = makeMockDoc();
  const panel = makePanel();
  doc._registerPanel('scn1', panel);
  mountScoreBonusAnimation({ bus, doc });
  bus.emit(EV.BOOST_ACTIVATED, { slot: 0, boostId: 'extra_turn' });
  assert.equal(panel._appended(), null);
});

test('mount: float is removed after durationMs', async () => {
  bus._reset();
  _resetForTests();
  const doc = makeMockDoc();
  const panel = makePanel();
  doc._registerPanel('scn1', panel);
  mountScoreBonusAnimation({ bus, doc, durationMs: 30 });
  bus.emit(EV.BOOST_ACTIVATED, { slot: 0, boostId: 'auto_extra_score', payload: { extra: 5 } });
  const float = panel._appended();
  await new Promise(r => setTimeout(r, 60));
  assert.equal(float._removed, true);
});

test('mount: degrades silently when no doc', () => {
  bus._reset();
  _resetForTests();
  const screen = mountScoreBonusAnimation({ bus, doc: null });
  bus.emit(EV.BOOST_ACTIVATED, { slot: 0, boostId: 'auto_extra_score', payload: { extra: 100 } });
  screen.unmount();
});

test('unmount stops further events', () => {
  bus._reset();
  _resetForTests();
  const doc = makeMockDoc();
  const panel = makePanel();
  doc._registerPanel('scn1', panel);
  const screen = mountScoreBonusAnimation({ bus, doc });
  screen.unmount();
  bus.emit(EV.BOOST_ACTIVATED, { slot: 0, boostId: 'auto_extra_score', payload: { extra: 5 } });
  assert.equal(panel._appended(), null);
});

test('throws if bus missing', () => {
  assert.throws(() => mountScoreBonusAnimation({}), /bus required/);
});
