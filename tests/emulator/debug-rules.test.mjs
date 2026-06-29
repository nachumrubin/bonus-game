// Emulator rules tests for the Game Debug Timeline nodes:
//   /gameEvents, /gameSnapshots, /clientSnapshots, /debugWarnings,
//   /debugReports, /debugGameIndex
//
// Invariants: admin-only reads; append-only participant writes; clientSnapshots
// bound to the writer's own slot; anyone authed may file a report.

import { test } from 'node:test';
import {
  withTestEnv, makeUserApp, makeAnonApp, seedWithoutRules,
  assertSucceeds, assertFails,
} from './setup.mjs';

const GAME = 'room-debug-1';
const ALICE = 'alice'; // slot 0
const BOB = 'bob';     // slot 1
const CAROL = 'carol'; // not in the game
const ADMIN = 'admin-uid';

async function seed(env) {
  await seedWithoutRules(env, async (db) => {
    await db.ref(`rooms/${GAME}/players/0/uid`).set(ALICE);
    await db.ref(`rooms/${GAME}/players/1/uid`).set(BOB);
    await db.ref(`admins/${ADMIN}`).set(true);
  });
}

test('gameEvents: a participant can append; outsider and edits are denied', async () => {
  await withTestEnv(async (env) => {
    await seed(env);
    const alice = makeUserApp(env, ALICE);
    const carol = makeUserApp(env, CAROL);

    await assertSucceeds(alice.ref(`gameEvents/${GAME}/e1`).set({ type: 'WORD_ACCEPTED' }));
    await assertFails(carol.ref(`gameEvents/${GAME}/e2`).set({ type: 'WORD_ACCEPTED' }));
    // append-only: cannot overwrite an existing event
    await assertFails(alice.ref(`gameEvents/${GAME}/e1`).set({ type: 'tampered' }));
  });
});

test('gameEvents/snapshots/warnings: admin reads, non-admin denied', async () => {
  await withTestEnv(async (env) => {
    await seed(env);
    const alice = makeUserApp(env, ALICE);
    await alice.ref(`gameEvents/${GAME}/e1`).set({ type: 'GAME_STARTED' });

    const admin = makeUserApp(env, ADMIN);
    const carol = makeUserApp(env, CAROL);
    await assertSucceeds(admin.ref(`gameEvents/${GAME}`).get());
    await assertFails(carol.ref(`gameEvents/${GAME}`).get());
    await assertFails(makeAnonApp(env).ref(`gameEvents/${GAME}`).get());
  });
});

test('clientSnapshots: a player may write only their OWN slot', async () => {
  await withTestEnv(async (env) => {
    await seed(env);
    const alice = makeUserApp(env, ALICE); // slot 0
    const bob = makeUserApp(env, BOB);     // slot 1

    await assertSucceeds(alice.ref(`clientSnapshots/${GAME}/0/s1`).set({ boardHash: 'a' }));
    await assertFails(alice.ref(`clientSnapshots/${GAME}/1/s1`).set({ boardHash: 'a' }));
    await assertSucceeds(bob.ref(`clientSnapshots/${GAME}/1/s2`).set({ boardHash: 'b' }));
    await assertFails(bob.ref(`clientSnapshots/${GAME}/0/s2`).set({ boardHash: 'b' }));
  });
});

test('debugReports: any authed user may file; only admin reads or resolves', async () => {
  await withTestEnv(async (env) => {
    await seed(env);
    const carol = makeUserApp(env, CAROL); // not in the game — can still report
    const admin = makeUserApp(env, ADMIN);
    await assertSucceeds(carol.ref('debugReports/r1').set({ gameId: GAME, userMessage: 'bug' }));
    await assertFails(carol.ref('debugReports/r1').set({ userMessage: 'tampered' })); // edit denied
    await assertSucceeds(admin.ref('debugReports/r1').update({ status: 'resolved', resolved: true }));
    await assertFails(makeAnonApp(env).ref('debugReports/r2').set({ userMessage: 'x' })); // unauthed denied

    await assertSucceeds(admin.ref('debugReports').get());
    await assertFails(carol.ref('debugReports').get());
  });
});

test('debugGameIndex: participant may upsert; outsider denied; admin reads', async () => {
  await withTestEnv(async (env) => {
    await seed(env);
    const alice = makeUserApp(env, ALICE);
    await assertSucceeds(alice.ref(`debugGameIndex/${GAME}`).update({ status: 'playing' }));
    await assertSucceeds(alice.ref(`debugGameIndex/${GAME}`).update({ status: 'completed' })); // index is mutable
    await assertFails(makeUserApp(env, CAROL).ref(`debugGameIndex/${GAME}`).update({ status: 'x' }));
    await assertSucceeds(makeUserApp(env, ADMIN).ref(`debugGameIndex/${GAME}`).get());
  });
});
