import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from '../core/gameEngine.js';
import {
  saveLocalGame,
  loadLocalGame,
  clearLocalGame,
  hasLocalSavedGame,
  LOCAL_SAVED_GAME_KEY,
  LOCAL_SAVED_GAME_VERSION,
} from './localSaveService.js';

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    _dump: () => Object.fromEntries(store),
  };
}

function makeState({ status = 'playing' } = {}) {
  const players = { 0: { uid: 'a', displayName: 'A' }, 1: { uid: 'b', displayName: 'B' } };
  const state = createInitialState({ mode: 'offline-2p', tileBagSeed: 'save-test-seed', players });
  state.bonusBoard.set('-1,3', { letter: 'א', val: 1 });
  state.bonusBoard.set('10,7', { letter: 'ב', val: 3, isJoker: false });
  state.scores = { 0: 12, 1: 34 };
  state.moveCount = 5;
  state.status = status;
  return state;
}

test('turnDeadlineMs survives an arbitrary delay between save and load — remaining time is preserved', () => {
  // Repro: player pauses with 6 s on the clock, saves and exits, walks away
  // for 10 s, then resumes. Before the fix the deadline was stored as an
  // absolute Date.now() value so the loaded snapshot would show 6-10=-4 s
  // (timer instantly at zero / auto-passed).
  const storage = makeStorage();
  const state = makeState();
  const SAVE_NOW = 1_000_000;
  state.turnDeadlineMs = SAVE_NOW + 6_000;   // 6 s left
  assert.equal(saveLocalGame(storage, { state, mode: 'offline-solo', bot: true }, SAVE_NOW), true);

  const LOAD_NOW = SAVE_NOW + 10_000;        // resumed 10 s later
  const loaded = loadLocalGame(storage, LOAD_NOW);
  assert.ok(loaded, 'loaded payload exists');
  // Anchored to LOAD_NOW + 6 s — the saved REMAINING time is preserved.
  assert.equal(loaded.state.turnDeadlineMs, LOAD_NOW + 6_000);
  // And the original in-memory state is NOT mutated by the save (we copied).
  assert.equal(state.turnDeadlineMs, SAVE_NOW + 6_000, 'original state object stays untouched');
});

test('save without an active turn deadline leaves turnDeadlineMs at 0 on load', () => {
  const storage = makeStorage();
  const state = makeState();
  state.turnDeadlineMs = 0;
  assert.equal(saveLocalGame(storage, { state }, 1_000_000), true);
  const loaded = loadLocalGame(storage, 5_000_000);
  assert.ok(loaded);
  assert.equal(loaded.state.turnDeadlineMs, 0, 'no active timer → stays 0 across the round trip');
});

test('save → load round-trips engine state including the bonusBoard Map', () => {
  const storage = makeStorage();
  const state = makeState();

  assert.equal(saveLocalGame(storage, { state, mode: 'offline-2p', bot: false }), true);

  const loaded = loadLocalGame(storage);
  assert.ok(loaded, 'loaded payload exists');
  assert.equal(loaded.version, LOCAL_SAVED_GAME_VERSION);
  assert.equal(loaded.mode, 'offline-2p');
  assert.equal(loaded.bot, false);
  assert.equal(loaded.state.scores[0], 12);
  assert.equal(loaded.state.scores[1], 34);
  assert.ok(loaded.state.bonusBoard instanceof Map, 'bonusBoard is rehydrated to a Map');
  assert.deepEqual(loaded.state.bonusBoard.get('-1,3'), { letter: 'א', val: 1 });
  assert.deepEqual(loaded.state.bonusBoard.get('10,7'), { letter: 'ב', val: 3, isJoker: false });
});

test('save preserves bot flag and difficulty', () => {
  const storage = makeStorage();
  const state = makeState();
  saveLocalGame(storage, { state, mode: 'offline-solo', bot: true, difficulty: 3 });
  const loaded = loadLocalGame(storage);
  assert.equal(loaded.bot, true);
  assert.equal(loaded.difficulty, 3);
  assert.equal(loaded.mode, 'offline-solo');
});

test('save refuses non-playing states', () => {
  const storage = makeStorage();
  const finished = makeState({ status: 'completed' });
  assert.equal(saveLocalGame(storage, { state: finished }), false);
  assert.equal(loadLocalGame(storage), null);
});

test('save refuses null/missing state', () => {
  const storage = makeStorage();
  assert.equal(saveLocalGame(storage, {}), false);
  assert.equal(saveLocalGame(storage, { state: null }), false);
});

test('load returns null on missing key', () => {
  const storage = makeStorage();
  assert.equal(loadLocalGame(storage), null);
  assert.equal(hasLocalSavedGame(storage), false);
});

test('load returns null on corrupt JSON', () => {
  const storage = makeStorage({ [LOCAL_SAVED_GAME_KEY]: 'not-json{' });
  assert.equal(loadLocalGame(storage), null);
});

test('load returns null on wrong version', () => {
  const storage = makeStorage();
  const state = makeState();
  saveLocalGame(storage, { state });
  const raw = JSON.parse(storage.getItem(LOCAL_SAVED_GAME_KEY));
  raw.version = 999;
  storage.setItem(LOCAL_SAVED_GAME_KEY, JSON.stringify(raw));
  assert.equal(loadLocalGame(storage), null);
});

test('load returns null when schemaVersion mismatches', () => {
  const storage = makeStorage();
  const state = makeState();
  saveLocalGame(storage, { state });
  const raw = JSON.parse(storage.getItem(LOCAL_SAVED_GAME_KEY));
  raw.state.schemaVersion = 1;
  storage.setItem(LOCAL_SAVED_GAME_KEY, JSON.stringify(raw));
  assert.equal(loadLocalGame(storage), null);
});

test('clear removes the saved game; hasLocalSavedGame reflects it', () => {
  const storage = makeStorage();
  const state = makeState();
  saveLocalGame(storage, { state });
  assert.equal(hasLocalSavedGame(storage), true);
  clearLocalGame(storage);
  assert.equal(hasLocalSavedGame(storage), false);
  assert.equal(loadLocalGame(storage), null);
});

test('null storage is a no-op (does not throw)', () => {
  assert.equal(saveLocalGame(null, { state: makeState() }), false);
  assert.equal(loadLocalGame(null), null);
  assert.equal(hasLocalSavedGame(null), false);
  clearLocalGame(null); // no throw
});
