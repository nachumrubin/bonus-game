// Boostie XP rules (users/$uid/profile/boosties). XP counts finished games: a client
// may add at most one game's XP (MAX_GAME_XP = 20) per write and never lower it; the
// level stays 1..7 and never drops. Migrations run with the Admin SDK (no rules).

import test from 'node:test';
import { withTestEnv, makeUserApp, seedWithoutRules, assertSucceeds, assertFails } from './setup.mjs';
import { MAX_GAME_XP } from '../../src/game/account/boostieXp.js';

const UID = 'xp-uid';
const path = (rest = '') => `users/${UID}/profile/boosties${rest}`;

async function seeded(env, boosties) {
  await seedWithoutRules(env, (db) => db.ref(path()).set(boosties));
  return makeUserApp(env, UID);
}

test('boosties: a new profile starts the starter at 0 XP, level 1', async () => {
  await withTestEnv(async (env) => {
    const me = makeUserApp(env, UID);
    await assertSucceeds(me.ref(path()).set({ zapi: { xp: 0, level: 1 } }));
  });
});

test('boosties: one game of XP per write is allowed', async () => {
  await withTestEnv(async (env) => {
    const me = await seeded(env, { zapi: { xp: 40, level: 1 } });
    await assertSucceeds(me.ref(path('/zapi')).set({ xp: 40 + MAX_GAME_XP, level: 2 }));
  });
});

test('boosties: more than one game of XP in one write is rejected', async () => {
  await withTestEnv(async (env) => {
    const me = await seeded(env, { zapi: { xp: 40, level: 1 } });
    await assertFails(me.ref(path('/zapi/xp')).set(40 + MAX_GAME_XP + 1));
  });
});

test('boosties: XP can never go down', async () => {
  await withTestEnv(async (env) => {
    const me = await seeded(env, { zapi: { xp: 40, level: 1 } });
    await assertFails(me.ref(path('/zapi/xp')).set(39));
  });
});

test('boosties: level must stay within 1..7 and never drop', async () => {
  await withTestEnv(async (env) => {
    const me = await seeded(env, { zapi: { xp: 400, level: 4 } });
    await assertFails(me.ref(path('/zapi/level')).set(8));
    await assertFails(me.ref(path('/zapi/level')).set(3));
    await assertSucceeds(me.ref(path('/zapi/level')).set(5));
  });
});

test('boosties: a newly unlocked Boostie starts at 0 XP', async () => {
  await withTestEnv(async (env) => {
    const me = await seeded(env, { zapi: { xp: 2000, level: 7 } });
    await assertSucceeds(me.ref(path('/bubo')).set({ xp: 0, level: 1 }));
    await assertFails(me.ref(path('/bubo/xp')).set(500));
  });
});

test('boosties: another user cannot write my XP', async () => {
  await withTestEnv(async (env) => {
    await seeded(env, { zapi: { xp: 0, level: 1 } });
    const other = makeUserApp(env, 'someone-else');
    await assertFails(other.ref(path('/zapi/xp')).set(10));
  });
});
