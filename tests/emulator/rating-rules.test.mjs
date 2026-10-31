// Leaderboard rules: each player writes only their own /globalRatings entry
// (ratingService.upsertRatingLeaderboardEntry); admins may fix any entry.

import test from 'node:test';
import { withTestEnv, makeUserApp, seedWithoutRules, assertSucceeds, assertFails } from './setup.mjs';

const ME = 'rating-me';
const OTHER = 'rating-other';
const ADMIN = 'rating-admin';
const entry = (uid, rest = {}) => ({ uid, name: 'שחקן', avatar: null, rating: 812, updatedAt: 1, ...rest });

test('ratings: a player writes their own entry', async () => {
  await withTestEnv(async (env) => {
    const me = makeUserApp(env, ME);
    await assertSucceeds(me.ref(`globalRatings/${ME}`).set(entry(ME)));
  });
});

test("ratings: a player cannot write or delete another player's entry", async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, (db) => db.ref(`globalRatings/${OTHER}`).set(entry(OTHER)));
    const me = makeUserApp(env, ME);
    await assertFails(me.ref(`globalRatings/${OTHER}`).set(entry(OTHER, { rating: 100, name: 'x' })));
    await assertFails(me.ref(`globalRatings/${OTHER}`).remove());
  });
});

test('ratings: an admin can fix any entry', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, (db) => db.ref(`admins/${ADMIN}`).set(true));
    const admin = makeUserApp(env, ADMIN);
    await assertSucceeds(admin.ref(`globalRatings/${OTHER}`).set(entry(OTHER)));
  });
});

test('ratings: out-of-range ratings and long names are rejected', async () => {
  await withTestEnv(async (env) => {
    const me = makeUserApp(env, ME);
    await assertFails(me.ref(`globalRatings/${ME}`).set(entry(ME, { rating: 99999 })));
    await assertFails(me.ref(`globalRatings/${ME}`).set(entry(ME, { rating: -1 })));
    await assertFails(me.ref(`globalRatings/${ME}`).set(entry(ME, { name: 'א'.repeat(31) })));
  });
});
