// Coin economy rules (Phase 6a). Coins and owned items are changed only by the worker
// (service account, no rules); a client may create its new profile with the starter
// grant and nothing more. See worker/src/economy.js.

import test from 'node:test';
import { withTestEnv, makeUserApp, seedWithoutRules, assertSucceeds, assertFails } from './setup.mjs';
import { buildInitialProfile } from '../../src/game/account/profileService.js';
import { STARTER_GRANT } from '../../src/game/account/economy.js';

const UID = 'coin-uid';
const profile = (rest = '') => `users/${UID}/profile${rest}`;

async function seeded(env, value) {
  await seedWithoutRules(env, (db) => db.ref(profile()).set(value));
  return makeUserApp(env, UID);
}

test('coins: a new profile is written whole, with the starter grant', async () => {
  await withTestEnv(async (env) => {
    const me = makeUserApp(env, UID);
    await assertSucceeds(me.ref(profile()).update(buildInitialProfile({ displayName: 'x', userId: '123456' })));
  });
});

test('coins: the first write must be exactly the starter grant', async () => {
  await withTestEnv(async (env) => {
    const me = makeUserApp(env, UID);
    await assertFails(me.ref(profile('/coins')).set(STARTER_GRANT + 1));
    await assertSucceeds(me.ref(profile('/coins')).set(STARTER_GRANT));
  });
});

test('coins: an existing balance cannot be changed or deleted by the client', async () => {
  await withTestEnv(async (env) => {
    const me = await seeded(env, { coins: 40, loginStreak: 2, lastLoginDate: '2026-10-06' });
    await assertFails(me.ref(profile('/coins')).set(99999));
    await assertFails(me.ref(profile('/coins')).set(STARTER_GRANT));
    await assertFails(me.ref(profile('/coins')).remove());
    await assertFails(me.ref(profile()).update({ coins: 500 }));
    await assertFails(me.ref(profile('/loginStreak')).set(9));
    await assertFails(me.ref(profile('/lastLoginDate')).remove());
    await assertFails(me.ref(profile('/lastLoginDate')).set('2020-01-01'));
  });
});

test('coins: owned items, payouts and orders are worker-only', async () => {
  await withTestEnv(async (env) => {
    const me = await seeded(env, { coins: 40 });
    await assertFails(me.ref(profile('/ownedReactions')).set(['wink']));
    await assertFails(me.ref(profile('/achievementsPaid/first_steps')).set(1));
    await assertFails(me.ref(profile('/econRecent/req-0000001')).set({ result: { ok: true } }));
    await assertFails(me.ref(profile('/coinOrders/GPA_1')).set({ coins: 500 }));
  });
});

test('coins: a non-starter Boostie cannot be created by the client', async () => {
  await withTestEnv(async (env) => {
    const me = await seeded(env, { coins: 40, boosties: { zapi: { xp: 0, level: 1 } } });
    await assertFails(me.ref(profile('/boosties/kiri')).set({ xp: 0, level: 1 }));
  });
});

test('coins: the rest of the profile stays client-writable', async () => {
  await withTestEnv(async (env) => {
    const me = await seeded(env, { coins: 40, displayName: 'a' });
    await assertSucceeds(me.ref(profile()).update({ displayName: 'b', equippedAvatar: 'bubo', rating: 812 }));
    await assertSucceeds(me.ref(`users/${UID}/lastSeen`).set(Date.now()));
  });
});

test('coins: the ledger is owner-read-only, orders are hidden', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, (db) => db.ref().update({
      [`coinLedger/${UID}/req-0000001`]: { delta: 20, coins: 60, ts: 1 },
      'coinOrders/GPA_1': { uid: UID },
    }));
    const me = makeUserApp(env, UID);
    const other = makeUserApp(env, 'someone-else');
    await assertSucceeds(me.ref(`coinLedger/${UID}`).get());
    await assertFails(other.ref(`coinLedger/${UID}`).get());
    await assertFails(me.ref(`coinLedger/${UID}/req-0000002`).set({ delta: 1000 }));
    await assertFails(me.ref('coinOrders/GPA_1').get());
    await assertFails(me.ref('coinOrders/GPA_2').set({ uid: UID }));
  });
});
