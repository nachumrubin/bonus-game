// liveReaction rules: only a room player writes it, in their own slot, with
// the {type, id, senderSlot, ts} shape reactionService sends.

import test from 'node:test';
import { withTestEnv, makeUserApp, seedWithoutRules, assertSucceeds, assertFails } from './setup.mjs';

const HOST = 'react-host';
const GUEST = 'react-guest';
const OUTSIDER = 'react-outsider';
const ROOM = 'react-room';
const reaction = (rest = {}) => ({ type: 'emoji', id: 'laugh', senderSlot: 0, ts: 1, ...rest });

function seedRoom(env) {
  return seedWithoutRules(env, (db) => db.ref(`rooms/${ROOM}/players`).set({
    0: { uid: HOST, displayName: 'Host' },
    1: { uid: GUEST, displayName: 'Guest' },
  }));
}

test('reactions: a player sends one in their own slot and clears it', async () => {
  await withTestEnv(async (env) => {
    await seedRoom(env);
    const host = makeUserApp(env, HOST);
    const guest = makeUserApp(env, GUEST);
    await assertSucceeds(host.ref(`rooms/${ROOM}/liveReaction`).set(reaction()));
    await assertSucceeds(guest.ref(`rooms/${ROOM}/liveReaction`).set(reaction({ type: 'message', id: 'niceMove', senderSlot: 1 })));
    await assertSucceeds(guest.ref(`rooms/${ROOM}/liveReaction`).set(null));
  });
});

test("reactions: a player can't send in the opponent's slot; an outsider can't send at all", async () => {
  await withTestEnv(async (env) => {
    await seedRoom(env);
    const host = makeUserApp(env, HOST);
    const outsider = makeUserApp(env, OUTSIDER);
    await assertFails(host.ref(`rooms/${ROOM}/liveReaction`).set(reaction({ senderSlot: 1 })));
    await assertFails(outsider.ref(`rooms/${ROOM}/liveReaction`).set(reaction()));
  });
});

test('reactions: unknown types, long ids and extra fields are rejected', async () => {
  await withTestEnv(async (env) => {
    await seedRoom(env);
    const host = makeUserApp(env, HOST);
    await assertFails(host.ref(`rooms/${ROOM}/liveReaction`).set(reaction({ type: 'text' })));
    await assertFails(host.ref(`rooms/${ROOM}/liveReaction`).set(reaction({ id: 'x'.repeat(41) })));
    await assertFails(host.ref(`rooms/${ROOM}/liveReaction`).set(reaction({ text: 'free text' })));
    await assertFails(host.ref(`rooms/${ROOM}/liveReaction`).set({ type: 'emoji', id: 'laugh' }));
  });
});
