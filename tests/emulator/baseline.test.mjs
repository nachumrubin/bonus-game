// Baseline emulator test. Confirms the harness is wired correctly:
//   - a known-permitted write succeeds against the production rules,
//   - a known-denied write fails.
// If these two assertions don't hold, every other emulator test is suspect.

import test from 'node:test';
import { withTestEnv, makeUserApp, makeAnonymousUserApp, makeAnonApp, assertSucceeds, assertFails } from './setup.mjs';

test('emulator harness: signed-in user can write their own /users/{uid}/lastSeen', async () => {
  await withTestEnv(async (env) => {
    const alice = makeUserApp(env, 'alice');
    await assertSucceeds(alice.ref('users/alice/lastSeen').set(Date.now()));
  });
});

test('emulator harness: signed-in user cannot write another user\'s /users/{uid}/lastSeen', async () => {
  await withTestEnv(async (env) => {
    const alice = makeUserApp(env, 'alice');
    await assertFails(alice.ref('users/bob/lastSeen').set(Date.now()));
  });
});

test('emulator harness: anonymous-auth user has auth.uid and can write their own user node', async () => {
  await withTestEnv(async (env) => {
    const guest = makeAnonymousUserApp(env, 'anon-alice');
    await assertSucceeds(guest.ref('users/anon-alice/lastSeen').set(Date.now()));
  });
});

test('emulator harness: unauth client cannot write /pendingRooms/{code}', async () => {
  await withTestEnv(async (env) => {
    const anon = makeAnonApp(env);
    await assertFails(anon.ref('pendingRooms/123456').set({
      hostUid: 'whoever',
      mode: 'friend-live',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }));
  });
});
