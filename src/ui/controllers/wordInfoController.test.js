import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { DICT_INTENT, DICT_RENDER } from '../screens/dictionaryScreen.js';
import { mountWordInfoController } from './wordInfoController.js';

const tick = () => new Promise((r) => setImmediate(r));

function setup({ enabled = false, lookup } = {}) {
  bus._reset();
  const state = { enabled };
  const events = [];
  const lookups = [];
  bus.on(DICT_RENDER.WORD_INFO, (p) => events.push(p));
  const service = {
    lookup: lookup ?? (async (w) => { lookups.push(w); return { word: w, source: 'D', sourceText: 'מקור', readings: ['שם עצם'], more: 0 }; }),
  };
  mountWordInfoController({
    bus,
    service,
    getEnabled: () => state.enabled,
    setEnabled: (v) => { state.enabled = v; },
  });
  return { state, events, lookups };
}

test('toggle off: a valid result hides the panel and fetches nothing', async () => {
  const { events, lookups } = setup({ enabled: false });
  bus.emit(DICT_RENDER.QUERY_RESULT, { target: 'main', word: 'בית', valid: true });
  await tick();
  assert.deepEqual(events, [{ target: 'main', status: 'hidden' }]);
  assert.deepEqual(lookups, []);
});

test('toggle on: a valid result shows loading then the info', async () => {
  const { events } = setup({ enabled: true });
  bus.emit(DICT_RENDER.QUERY_RESULT, { target: 'main', word: 'בית', valid: true });
  await tick();
  assert.deepEqual(events.map((e) => e.status), ['loading', 'ready']);
  assert.equal(events[1].info.word, 'בית');
});

test('toggle on: an invalid word hides the panel', async () => {
  const { events, lookups } = setup({ enabled: true });
  bus.emit(DICT_RENDER.QUERY_RESULT, { target: 'settings', word: 'בייתת', valid: false });
  await tick();
  assert.deepEqual(events, [{ target: 'settings', status: 'hidden' }]);
  assert.deepEqual(lookups, []);
});

test('turning the toggle on shows info for the word already checked; off hides it', async () => {
  const { state, events } = setup({ enabled: false });
  bus.emit(DICT_RENDER.QUERY_RESULT, { target: 'main', word: 'בית', valid: true });
  events.length = 0;
  bus.emit(DICT_INTENT.TOGGLE_WORD_INFO, { enabled: true });
  await tick();
  assert.equal(state.enabled, true);
  assert.deepEqual(events.filter((e) => e.target === 'main').map((e) => e.status), ['loading', 'ready']);
  assert.deepEqual(events.filter((e) => e.target === 'settings').map((e) => e.status), ['hidden']);
  events.length = 0;
  bus.emit(DICT_INTENT.TOGGLE_WORD_INFO, { enabled: false });
  await tick();
  assert.equal(state.enabled, false);
  assert.deepEqual(events.map((e) => e.status), ['hidden', 'hidden']);
});

test('a stale lookup is dropped when a newer word is checked', async () => {
  const pending = {};
  const { events } = setup({
    enabled: true,
    lookup: (w) => new Promise((resolve) => { pending[w] = resolve; }),
  });
  bus.emit(DICT_RENDER.QUERY_RESULT, { target: 'main', word: 'ראשון', valid: true });
  bus.emit(DICT_RENDER.QUERY_RESULT, { target: 'main', word: 'שני', valid: true });
  pending['שני']({ word: 'שני', readings: [], more: 0 });
  pending['ראשון']({ word: 'ראשון', readings: [], more: 0 });
  await tick();
  const ready = events.filter((e) => e.status === 'ready');
  assert.deepEqual(ready.map((e) => e.word), ['שני']);
});

test('missing entry and load failure are reported', async () => {
  let { events } = setup({ enabled: true, lookup: async () => null });
  bus.emit(DICT_RENDER.QUERY_RESULT, { target: 'main', word: 'חדש', valid: true });
  await tick();
  assert.equal(events.at(-1).status, 'missing');
  ({ events } = setup({ enabled: true, lookup: async () => { throw new Error('offline'); } }));
  bus.emit(DICT_RENDER.QUERY_RESULT, { target: 'main', word: 'חדש', valid: true });
  await tick();
  assert.equal(events.at(-1).status, 'error');
});

test('opening the מילון clears the overlay panel', () => {
  const { events } = setup({ enabled: true });
  bus.emit(DICT_INTENT.OPEN_QUERY, {});
  assert.deepEqual(events, [{ target: 'main', status: 'hidden' }]);
});
