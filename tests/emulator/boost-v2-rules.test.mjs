// Boost 2.0 worker-authoritative rooms. The Cloudflare Worker (service
// account, bypasses rules) is the only writer of a BOOST_V2 room's game
// state, its secret and its racks. Clients may read the public room and their
// OWN rack, and still write the cosmetic side fields (ready, livePreview,
// liveReaction, oneSignalSubId). See worker/src/boostTurn.js.

import test from 'node:test';
import { withTestEnv, makeUserApp, seedWithoutRules, assertSucceeds, assertFails } from './setup.mjs';
import { createMatch } from '../../src/game/boostV2/authoritativeTurn.js';
import { createRng } from '../../src/util/rng.js';

const A = 'v2-alice';
const B = 'v2-bob';
const ROOM = 'v2room01';
const PLAYERS = { 0: { uid: A, displayName: 'A' }, 1: { uid: B, displayName: 'B' } };

async function seeded(env) {
  const m = createMatch({ roomId: ROOM, mode: 'friend-live', players: PLAYERS, settings: { timelimit: true, turnSeconds: 60 }, now: Date.now(), rng: createRng('emu') });
  await seedWithoutRules(env, async (db) => {
    await db.ref(`rooms/${ROOM}`).set(m.room);
    await db.ref(`boostV2Secret/${ROOM}`).set(m.secret);
    await db.ref(`boostV2Racks/${ROOM}`).set(m.racks);
  });
  return m;
}

test('boost v2: the secret is unreadable and unwritable for players', async () => {
  await withTestEnv(async (env) => {
    await seeded(env);
    const alice = makeUserApp(env, A);
    await assertFails(alice.ref(`boostV2Secret/${ROOM}`).get());
    await assertFails(alice.ref(`boostV2Secret/${ROOM}/stateJson`).get());
    await assertFails(alice.ref(`boostV2Secret/${ROOM}/version`).set(99));
    await assertFails(alice.ref(`boostV2Secret/other`).set({ x: 1 }));
  });
});

test('boost v2: a player reads only their own rack and cannot write racks', async () => {
  await withTestEnv(async (env) => {
    await seeded(env);
    const alice = makeUserApp(env, A);
    const bob = makeUserApp(env, B);
    await assertSucceeds(alice.ref(`boostV2Racks/${ROOM}/0`).get());
    await assertFails(alice.ref(`boostV2Racks/${ROOM}/1`).get());
    await assertSucceeds(bob.ref(`boostV2Racks/${ROOM}/1`).get());
    await assertFails(bob.ref(`boostV2Racks/${ROOM}/0`).get());
    await assertFails(alice.ref(`boostV2Racks/${ROOM}`).get());
    await assertFails(alice.ref(`boostV2Racks/${ROOM}/0/tiles`).set(['?', '?', '?']));
  });
});

test('boost v2: players cannot write the room state — even on their own turn with a valid version bump', async () => {
  await withTestEnv(async (env) => {
    const m = await seeded(env);
    const alice = makeUserApp(env, A);
    await assertFails(alice.ref(`rooms/${ROOM}`).update({ version: m.room.version + 1, scores: { 0: 999, 1: 0 } }));
    await assertFails(alice.ref(`rooms/${ROOM}`).set({ ...m.room, version: m.room.version + 1, scores: { 0: 999, 1: 0 } }));
    await assertFails(alice.ref(`rooms/${ROOM}`).set({ ...m.room, ruleset: null, version: m.room.version + 1 }));
    await assertFails(alice.ref(`rooms/${ROOM}`).remove());
    for (const k of ['status', 'turnDeadlineMs', 'settings', 'abandonedBy', 'abandonReason']) {
      const v = k === 'settings' ? { timelimit: false } : (k === 'status' ? 'abandoned' : (k === 'abandonReason' ? 'x' : 1));
      await assertFails(alice.ref(`rooms/${ROOM}/${k}`).set(v));
    }
  });
});

test('boost v2: a client cannot create a BOOST_V2 room itself', async () => {
  await withTestEnv(async (env) => {
    const alice = makeUserApp(env, A);
    const m = createMatch({ roomId: 'v2room02', mode: 'friend-async', players: PLAYERS, now: Date.now(), rng: createRng('x') });
    await assertFails(alice.ref('rooms/v2room02').set(m.room));
  });
});

test('boost v2: cosmetic side fields stay writable for players', async () => {
  await withTestEnv(async (env) => {
    await seeded(env);
    const alice = makeUserApp(env, A);
    await assertSucceeds(alice.ref(`rooms/${ROOM}/ready/0`).set(true));
    await assertSucceeds(alice.ref(`rooms/${ROOM}/livePreview`).set({ slot: 0, tiles: [] }));
    await assertSucceeds(alice.ref(`rooms/${ROOM}/liveReaction`).set({ type: 'emoji', id: 'wave', senderSlot: 0, ts: 1 }));
    await assertSucceeds(alice.ref(`rooms/${ROOM}/players/0/oneSignalSubId`).set('sub-1'));
    await assertSucceeds(alice.ref(`rooms/${ROOM}`).get());
  });
});

test('boost v2: legacy rooms are unaffected (current player can still commit)', async () => {
  await withTestEnv(async (env) => {
    const legacy = {
      roomId: 'legacy01', schemaVersion: 2, status: 'playing', version: 1, currentTurnSlot: 0,
      players: PLAYERS, settings: {}, scores: { 0: 0, 1: 0 },
    };
    await seedWithoutRules(env, (db) => db.ref('rooms/legacy01').set(legacy));
    const alice = makeUserApp(env, A);
    await assertSucceeds(alice.ref('rooms/legacy01').set({ ...legacy, version: 2, currentTurnSlot: 1 }));
    await assertSucceeds(alice.ref('rooms/legacy01/status').set('abandoned'));
  });
});
