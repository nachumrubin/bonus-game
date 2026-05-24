import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from './mockFirebase.js';
import * as roomService from './roomService.js';
import { createInitialState } from '../core/gameEngine.js';
import { listAsyncSessions } from './asyncSessionService.js';
import { classify, sweepForUser } from './asyncReminderService.js';

const ME  = { uid: 'me',  displayName: 'נחום' };
const OPP = { uid: 'opp', displayName: 'דני'  };

const HR = 60 * 60 * 1000;
const DAY = 24 * HR;

async function makeAsyncRoom(db, { roomId, currentTurnSlot = 0, updatedAt = 0, lastReminderAt = null, status = 'playing' }) {
  const players = { 0: { ...ME }, 1: { ...OPP } };
  const engineState = createInitialState({
    mode: 'random-async', tileBagSeed: roomId, players, startingSlot: 0, settings: {},
  });
  await roomService.createRoom(db, {
    roomId, mode: 'random-async', players, settings: {}, engineState, serverTimestamp: updatedAt,
  });
  const patch = { status, currentTurnSlot, updatedAt };
  if (lastReminderAt != null) patch.lastReminderAt = lastReminderAt;
  await db.ref(`rooms/${roomId}`).update(patch);
}

test('classify: live mode returns none', () => {
  const r = { mode: 'random-live', status: 'playing', updatedAt: 0, currentTurnSlot: 0, players: { 0: { uid: 'a' }, 1: { uid: 'b' } } };
  assert.equal(classify(r, { now: 100 * DAY }).action, 'none');
});

test('classify: completed async room returns none', () => {
  const r = { mode: 'random-async', status: 'completed', updatedAt: 0, currentTurnSlot: 0, players: { 0: { uid: 'a' }, 1: { uid: 'b' } } };
  assert.equal(classify(r, { now: 100 * DAY }).action, 'none');
});

test('classify: idle < 24h returns none', () => {
  const r = { mode: 'random-async', status: 'playing', updatedAt: 0, currentTurnSlot: 1, players: { 0: { uid: 'a' }, 1: { uid: 'b' } } };
  assert.equal(classify(r, { now: 23 * HR }).action, 'none');
});

test('classify: idle ≥ 24h, < 7d returns remind for current-turn slot', () => {
  const r = { mode: 'random-async', status: 'playing', updatedAt: 0, currentTurnSlot: 1, players: { 0: { uid: 'a' }, 1: { uid: 'b' } } };
  const d = classify(r, { now: 25 * HR });
  assert.equal(d.action, 'remind');
  assert.equal(d.toUid, 'b');
  assert.equal(d.hoursIdle, 25);
});

test('classify: lastReminderAt within window suppresses re-reminder', () => {
  const r = { mode: 'random-async', status: 'playing',
    updatedAt: 0, lastReminderAt: 25 * HR, currentTurnSlot: 1,
    players: { 0: { uid: 'a' }, 1: { uid: 'b' } } };
  // now = 30h; last reminder was at 25h, so only 5h ago — suppress
  assert.equal(classify(r, { now: 30 * HR }).action, 'none');
});

test('classify: idle ≥ 7d returns expire', () => {
  const r = { mode: 'random-async', status: 'playing', updatedAt: 0, currentTurnSlot: 0, players: { 0: { uid: 'a' }, 1: { uid: 'b' } } };
  assert.equal(classify(r, { now: 8 * DAY }).action, 'expire');
});

test('sweepForUser: reminds opponent for a 25h-idle room and writes lastReminderAt', async () => {
  const db = makeMockDb();
  await makeAsyncRoom(db, { roomId: 'r-stale', currentTurnSlot: 1, updatedAt: 0 });
  const sends = [];
  const r = await sweepForUser(db, ME.uid, {
    now: 25 * HR,
    pushSender: async (p) => { sends.push(p); },
  });
  assert.deepEqual(r, { reminded: 1, expired: 0 });
  assert.equal(sends.length, 1);
  assert.equal(sends[0].kind, 'reminder');
  assert.deepEqual(sends[0].toUids, [OPP.uid]);
  // lastReminderAt now persisted
  const room = await roomService.readRoom(db, 'r-stale');
  assert.equal(room.lastReminderAt, 25 * HR);
});

test('sweepForUser: expires a 7d-idle room, fires expired push to both, clears index', async () => {
  const db = makeMockDb();
  await makeAsyncRoom(db, { roomId: 'r-dead', updatedAt: 0 });
  const sends = [];
  const r = await sweepForUser(db, ME.uid, {
    now: 8 * DAY,
    pushSender: async (p) => { sends.push(p); },
  });
  assert.deepEqual(r, { reminded: 0, expired: 1 });
  // Both players notified
  assert.equal(sends.length, 1);
  assert.equal(sends[0].kind, 'expired');
  assert.deepEqual(sends[0].toUids.sort(), [ME.uid, OPP.uid].sort());
  // Room status is now expired
  const room = await roomService.readRoom(db, 'r-dead');
  assert.equal(room.status, 'expired');
  // Async index cleared for both
  assert.equal((await listAsyncSessions(db, ME.uid)).length, 0);
  assert.equal((await listAsyncSessions(db, OPP.uid)).length, 0);
});

test('sweepForUser: empty index is a no-op', async () => {
  const db = makeMockDb();
  const r = await sweepForUser(db, ME.uid, { pushSender: async () => {} });
  assert.deepEqual(r, { reminded: 0, expired: 0 });
});

test('sweepForUser: a fresh room is left alone', async () => {
  const db = makeMockDb();
  await makeAsyncRoom(db, { roomId: 'r-fresh', updatedAt: 1000, currentTurnSlot: 1 });
  const r = await sweepForUser(db, ME.uid, {
    now: 1000 + 5 * HR,
    pushSender: async () => { throw new Error('should not be called'); },
  });
  assert.deepEqual(r, { reminded: 0, expired: 0 });
});

test('sweepForUser: multiple rooms — handles a mix of remind, expire, and skip', async () => {
  const db = makeMockDb();
  await makeAsyncRoom(db, { roomId: 'fresh',  updatedAt: 0, currentTurnSlot: 0 });
  await makeAsyncRoom(db, { roomId: 'remind', updatedAt: 0, currentTurnSlot: 1 });
  await makeAsyncRoom(db, { roomId: 'expire', updatedAt: 0, currentTurnSlot: 0 });
  const sends = [];
  // 7.5 days elapsed:
  //   - fresh:  also expired (created at 0, never updated)
  //   - remind: also expired (created at 0)
  //   - expire: also expired
  // To get a mixed scenario, freshly bump 'fresh' updatedAt:
  await db.ref('rooms/fresh').update({ updatedAt: 7 * DAY }); // 0.5d ago
  await db.ref('rooms/remind').update({ updatedAt: 6.5 * DAY }); // 1d ago
  // 'expire' stays at 0 → 7.5d ago
  const r = await sweepForUser(db, ME.uid, {
    now: 7.5 * DAY,
    pushSender: async (p) => { sends.push(p); },
  });
  assert.deepEqual(r, { reminded: 1, expired: 1 });
});
