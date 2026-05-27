// Smoke tests that prove the worker's classify() stays in sync with the
// app's asyncReminderService.classify(). If you change one without the
// other, these tests fail. (GAP_REPORT item 4 — keeping the server-side
// and client-side sweeps from drifting.)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classify as workerClassify } from '../src/cronSweep.js';
import { classify as appClassify } from '../../src/game/online/asyncReminderService.js';

const HR = 60 * 60 * 1000;
const DAY = 24 * HR;

const SCENARIOS = [
  {
    name: 'live mode → none',
    room: { mode: 'random-live', status: 'playing', updatedAt: 0, currentTurnSlot: 0,
            players: { 0: { uid: 'a' }, 1: { uid: 'b' } } },
    now: 100 * DAY,
  },
  {
    name: 'completed async → none',
    room: { mode: 'random-async', status: 'completed', updatedAt: 0, currentTurnSlot: 0,
            players: { 0: { uid: 'a' }, 1: { uid: 'b' } } },
    now: 100 * DAY,
  },
  {
    name: 'fresh async (<24h) → none',
    room: { mode: 'random-async', status: 'playing', updatedAt: 0, currentTurnSlot: 1,
            players: { 0: { uid: 'a' }, 1: { uid: 'b' } } },
    now: 23 * HR,
  },
  {
    name: 'async ≥24h <7d → remind current-turn player',
    room: { mode: 'random-async', status: 'playing', updatedAt: 0, currentTurnSlot: 1,
            players: { 0: { uid: 'a' }, 1: { uid: 'b' } } },
    now: 25 * HR,
  },
  {
    name: 'async ≥24h but recently reminded → none',
    room: { mode: 'random-async', status: 'playing', updatedAt: 0, currentTurnSlot: 1,
            lastReminderAt: 24 * HR + 1000,
            players: { 0: { uid: 'a' }, 1: { uid: 'b' } } },
    now: 25 * HR,
  },
  {
    name: 'async ≥7d → expire',
    room: { mode: 'random-async', status: 'playing', updatedAt: 0, currentTurnSlot: 0,
            players: { 0: { uid: 'a' }, 1: { uid: 'b' } } },
    now: 8 * DAY,
  },
  {
    name: 'async with missing player → none (no recipient)',
    room: { mode: 'random-async', status: 'playing', updatedAt: 0, currentTurnSlot: 1,
            players: { 0: { uid: 'a' } } },
    now: 25 * HR,
  },
];

for (const sc of SCENARIOS) {
  test(`classify parity (worker vs app): ${sc.name}`, () => {
    const w = workerClassify(sc.room, { now: sc.now });
    const a = appClassify(sc.room, { now: sc.now });
    assert.deepEqual(w, a, `worker and app must produce identical decisions for: ${sc.name}`);
  });
}
