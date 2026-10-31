// Block rules: blocks/{uid} is owner-only, and a blocked player can no longer
// send a friend request, re-add the friendship or create an invite.

import test from 'node:test';
import { withTestEnv, makeUserApp, seedWithoutRules, assertSucceeds, assertFails } from './setup.mjs';

const ME = 'block-me';
const PEST = 'block-pest';
const OTHER = 'block-other';
const invite = (fromUid) => ({ fromUid, fromName: 'x', toUid: ME, status: 'pending', createdAt: 1 });

test('blocks: only the owner reads or writes their block list', async () => {
  await withTestEnv(async (env) => {
    const me = makeUserApp(env, ME);
    const pest = makeUserApp(env, PEST);
    await assertSucceeds(me.ref(`blocks/${ME}/${PEST}`).set(true));
    await assertSucceeds(me.ref(`blocks/${ME}`).get());
    await assertFails(pest.ref(`blocks/${ME}`).get());
    await assertFails(pest.ref(`blocks/${ME}/${PEST}`).remove());
    await assertFails(me.ref(`blocks/${ME}/${ME}`).set(true));
    await assertFails(me.ref(`blocks/${ME}/${OTHER}`).set('yes'));
  });
});

test('blocks: a blocked player cannot send a friend request; others still can', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, (db) => db.ref(`blocks/${ME}/${PEST}`).set(true));
    const pest = makeUserApp(env, PEST);
    const other = makeUserApp(env, OTHER);
    await assertFails(pest.ref(`friendRequests/${ME}/${PEST}`).set({ fromUid: PEST, fromName: 'p', sentAt: 1 }));
    await assertSucceeds(other.ref(`friendRequests/${ME}/${OTHER}`).set({ fromUid: OTHER, fromName: 'o', sentAt: 1 }));
  });
});

test('friend requests: nobody writes a request in another sender\'s name', async () => {
  await withTestEnv(async (env) => {
    const other = makeUserApp(env, OTHER);
    await assertFails(other.ref(`friendRequests/${ME}/${PEST}`).set({ fromUid: PEST, fromName: 'p', sentAt: 1 }));
  });
});

test('friend requests: the recipient can still clear a blocked player\'s old request', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref(`friendRequests/${ME}/${PEST}`).set({ fromUid: PEST, fromName: 'p', sentAt: 1 });
      await db.ref(`blocks/${ME}/${PEST}`).set(true);
    });
    const me = makeUserApp(env, ME);
    await assertSucceeds(me.ref(`friendRequests/${ME}/${PEST}`).remove());
  });
});

test('blocks: a blocked player cannot re-add themselves to the friend list', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, (db) => db.ref(`blocks/${ME}/${PEST}`).set(true));
    const pest = makeUserApp(env, PEST);
    await assertFails(pest.ref(`friends/${ME}/${PEST}`).set({ uid: PEST, name: 'p', addedAt: 1 }));
    await assertSucceeds(pest.ref(`friends/${PEST}/${ME}`).remove());
  });
});

test('blocks: a blocked player cannot invite; others still can', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, (db) => db.ref(`blocks/${ME}/${PEST}`).set(true));
    const pest = makeUserApp(env, PEST);
    const other = makeUserApp(env, OTHER);
    await assertFails(pest.ref(`invites/${ME}/inv_pest`).set(invite(PEST)));
    await assertSucceeds(other.ref(`invites/${ME}/inv_other`).set(invite(OTHER)));
  });
});
