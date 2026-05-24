import test from 'node:test';
import assert from 'node:assert/strict';

import {
  withTestEnv, makeUserApp, seedWithoutRules, adminRead,
  assertSucceeds, assertFails,
} from './setup.mjs';
import { sweepForUser } from '../../src/game/online/asyncReminderService.js';

const HOST_UID = 'async-host';
const GUEST_UID = 'async-guest';
const OTHER_UID = 'async-other';

const HR = 60 * 60 * 1000;
const DAY = 24 * HR;

const PLAYERS = {
  0: { uid: HOST_UID, displayName: 'Host', avatar: null, joinedAt: 1_000 },
  1: { uid: GUEST_UID, displayName: 'Guest', avatar: null, joinedAt: 1_000 },
};

function roomDoc(overrides = {}) {
  return {
    roomId: 'async-room',
    schemaVersion: 2,
    mode: 'friend-async',
    status: 'playing',
    version: 1,
    currentTurnSlot: 1,
    turnNumber: 3,
    moveHistory: [],
    scores: { 0: 0, 1: 0 },
    racks: { 0: [], 1: [] },
    bag: [],
    board: {},
    bonusBoard: {},
    activeBoosts: [],
    lockedCells: [],
    lockInventory: { 0: [], 1: [] },
    bonusAssignment: [],
    bonusSqUsed: {},
    pendingBonuses: [],
    settings: {},
    players: PLAYERS,
    livePreview: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

async function seedAsyncRoom(env, overrides = {}) {
  const doc = roomDoc(overrides);
  await seedWithoutRules(env, async (db) => {
    await db.ref(`rooms/${doc.roomId}`).set(doc);
    const meta = { mode: doc.mode, createdAt: doc.createdAt };
    await db.ref(`users/${HOST_UID}/asyncRooms/${doc.roomId}`).set(meta);
    await db.ref(`users/${GUEST_UID}/asyncRooms/${doc.roomId}`).set(meta);
  });
  return doc;
}

test('async reminder: participant sweep writes lastReminderAt under production rules', async () => {
  await withTestEnv(async (env) => {
    await seedAsyncRoom(env);
    const host = makeUserApp(env, HOST_UID);
    const sends = [];

    const result = await sweepForUser(host.db, HOST_UID, {
      now: 25 * HR,
      pushSender: async (payload) => { sends.push(payload); },
    });

    assert.deepEqual(result, { reminded: 1, expired: 0 });
    assert.equal(sends.length, 1);
    assert.equal(sends[0].kind, 'reminder');
    assert.deepEqual(sends[0].toUids, [GUEST_UID]);
    assert.equal(await adminRead(env, 'rooms/async-room/lastReminderAt'), 25 * HR);
  });
});

test('rooms/{id}/lastReminderAt: non-player cannot mark a room reminded', async () => {
  await withTestEnv(async (env) => {
    await seedAsyncRoom(env);
    const other = makeUserApp(env, OTHER_UID);

    await assertFails(other.ref('rooms/async-room/lastReminderAt').set(25 * HR));
  });
});

test('async reminder: expiry marks room expired and clears both async indexes', async () => {
  await withTestEnv(async (env) => {
    await seedAsyncRoom(env);
    const host = makeUserApp(env, HOST_UID);
    const sends = [];

    const result = await assertSucceeds(sweepForUser(host.db, HOST_UID, {
      now: 8 * DAY,
      pushSender: async (payload) => { sends.push(payload); },
    }));

    assert.deepEqual(result, { reminded: 0, expired: 1 });
    assert.equal(sends.length, 1);
    assert.equal(sends[0].kind, 'expired');
    assert.deepEqual(sends[0].toUids.sort(), [HOST_UID, GUEST_UID].sort());
    assert.equal(await adminRead(env, 'rooms/async-room/status'), 'expired');
    assert.equal(await adminRead(env, `users/${HOST_UID}/asyncRooms/async-room`), null);
    assert.equal(await adminRead(env, `users/${GUEST_UID}/asyncRooms/async-room`), null);
  });
});
