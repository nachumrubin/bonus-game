import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  startServerClock, stopServerClock, serverNow, getServerTimeOffsetMs,
  isServerClockSynced, SERVER_CLOCK_SYNCED,
  _setServerTimeOffsetForTests, _resetServerClockForTests,
} from './serverClock.js';

// Minimal stand-in for the RTDB `.info/serverTimeOffset` node.
function makeOffsetDb() {
  const handlers = new Set();
  let lastPath = null;
  return {
    _emit(val) { for (const h of handlers) h({ val: () => val }); },
    _path() { return lastPath; },
    _handlerCount() { return handlers.size; },
    ref(path) {
      lastPath = path;
      return {
        on(_evt, fn) { handlers.add(fn); },
        off(_evt, fn) { handlers.delete(fn); },
      };
    },
  };
}

test('serverNow falls back to Date.now() before any sync', () => {
  _resetServerClockForTests();
  assert.equal(getServerTimeOffsetMs(), 0);
  assert.equal(isServerClockSynced(), false);
  const drift = Math.abs(serverNow() - Date.now());
  assert.ok(drift <= 5, `unsynced clock must equal Date.now() (drift ${drift}ms)`);
});

test('startServerClock subscribes to .info/serverTimeOffset and applies the offset', () => {
  _resetServerClockForTests();
  const db = makeOffsetDb();
  const emitted = [];
  startServerClock({ db, bus: { emit: (t, p) => emitted.push([t, p]) } });

  assert.equal(db._path(), '.info/serverTimeOffset');

  db._emit(4321);
  assert.equal(getServerTimeOffsetMs(), 4321);
  assert.equal(isServerClockSynced(), true);
  const delta = serverNow() - Date.now();
  assert.ok(Math.abs(delta - 4321) <= 5, `serverNow must lead by the offset (got ${delta})`);
  assert.deepEqual(emitted[0], [SERVER_CLOCK_SYNCED, { offsetMs: 4321 }]);

  // Re-estimates on reconnect are picked up; identical values don't re-emit.
  db._emit(-250);
  assert.equal(getServerTimeOffsetMs(), -250);
  db._emit(-250);
  assert.equal(emitted.length, 2, 'no event for an unchanged offset');

  stopServerClock();
  _resetServerClockForTests();
});

test('a negative offset (local clock ahead) pulls serverNow backwards', () => {
  _resetServerClockForTests();
  _setServerTimeOffsetForTests(-5000);
  const delta = serverNow() - Date.now();
  assert.ok(Math.abs(delta + 5000) <= 5, `expected ~-5000, got ${delta}`);
  _resetServerClockForTests();
});

test('startServerClock is idempotent — the previous subscription is detached', () => {
  _resetServerClockForTests();
  const db = makeOffsetDb();
  startServerClock({ db });
  startServerClock({ db });
  assert.equal(db._handlerCount(), 1, 'only one live listener');
  stopServerClock();
  assert.equal(db._handlerCount(), 0, 'stop detaches');
  _resetServerClockForTests();
});

test('a db without .info support degrades to a zero offset instead of throwing', () => {
  _resetServerClockForTests();
  const hostile = { ref() { throw new Error('no .info tree'); } };
  assert.doesNotThrow(() => startServerClock({ db: hostile }));
  assert.equal(getServerTimeOffsetMs(), 0);
  assert.doesNotThrow(() => startServerClock({ db: null }));
  assert.doesNotThrow(() => startServerClock({}));
  _resetServerClockForTests();
});

test('a non-numeric offset value is ignored rather than poisoning the clock', () => {
  _resetServerClockForTests();
  const db = makeOffsetDb();
  startServerClock({ db });
  db._emit(1000);
  db._emit('not-a-number');
  assert.equal(getServerTimeOffsetMs(), 1000, 'garbage does not overwrite a good offset');
  stopServerClock();
  _resetServerClockForTests();
});
