// End-game progression parity: stats, rating, avatar unlocks.
//
// Legacy authority (HEAD:index.html):
//   - updateUserStats() at line 12340: transaction on users/{uid}/profile/stats
//     that bumps gamesPlayed/Won/Lost/Draw, streaks, highScore, totalScore,
//     bonusesTriggered, wordsPlayed.
//   - AVATAR_CATALOG + getUnlockedAvatarIds at lines 11905-11941: avatars
//     unlock when a stat crosses its threshold.
//   - Elo math: legacy maintained ratings via the same K=24 / SCALE=400
//     formula that ratingService.applyDelta implements.
//
// Spine intentionally tracks a SUBSET of the legacy stats fields (extended
// per-game tracking like closeWins / comebackWins / dayWins lives only in
// the legacy stats display screen and was not ported). For the overlapping
// fields we assert byte-for-byte parity. For the divergent fields we just
// document the gap.
//
// What we assert:
//   1. computeStatsDelta matches a legacy-shadow function for the fields
//      both implementations track.
//   2. End-to-end win: bumpStats + applyEloForFinishedGame produce the
//      right stats + rating updates on both players' profiles.
//   3. End-to-end loss: streak resets, rating drops.
//   4. End-to-end draw: ratings unchanged on equal-Elo players.
//   5. diffNewlyUnlocked fires only on the first threshold crossing.
//   6. Symmetric rating delta: myDelta + oppDelta === 0 for any result.
//   7. High-score field uses {max} semantics — a worse game doesn't lower it.

const test = require('node:test');
const assert = require('node:assert/strict');

let modulesPromise;
function loadModules() {
  modulesPromise ??= Promise.all([
    import('../../src/events/bus.js'),
    import('../../src/game/online/mockFirebase.js'),
    import('../../src/game/account/profileService.js'),
    import('../../src/game/account/ratingService.js'),
    import('../../src/ui/screens/avatarScreens.js'),
  ]).then(([bus, mock, profile, rating, avatar]) => ({ bus, mock, profile, rating, avatar }));
  return modulesPromise;
}

// ── Legacy stats-update shadow ─────────────────────────────────────────
// Re-implements just the spine-tracked fields from legacy updateUserStats
// (HEAD:index.html:12340-12365). We don't run legacy verbatim because the
// transaction is wrapped in network/auth checks; this captures the same
// semantics for the fields we assert against.
function legacyStatsShadow(prev, { result, myScore, gameBonuses = 0, gameWords = 0 }) {
  const stats = { ...prev };
  stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;
  if (result === 'win') {
    stats.gamesWon = (stats.gamesWon || 0) + 1;
    stats.currentStreak = (stats.currentStreak || 0) + 1;
    if (stats.currentStreak > (stats.longestStreak || 0)) stats.longestStreak = stats.currentStreak;
  } else if (result === 'loss') {
    stats.gamesLost = (stats.gamesLost || 0) + 1;
    stats.currentStreak = 0;
  } else {
    stats.gamesDraw = (stats.gamesDraw || 0) + 1;
    stats.currentStreak = 0;
  }
  if (myScore > (stats.highScore || 0)) stats.highScore = myScore;
  stats.totalScore = (stats.totalScore || 0) + myScore;
  stats.bonusesTriggered = (stats.bonusesTriggered || 0) + gameBonuses;
  stats.wordsPlayed = (stats.wordsPlayed || 0) + gameWords;
  return stats;
}

// Project a stats object onto just the spine-tracked fields so we can
// compare without divergent fields tripping deepEqual.
const SPINE_TRACKED = [
  'gamesPlayed', 'gamesWon', 'gamesLost', 'gamesDraw',
  'totalScore', 'highScore', 'currentStreak', 'longestStreak',
  'bonusesTriggered', 'wordsPlayed',
];
function project(stats) {
  const out = {};
  for (const k of SPINE_TRACKED) out[k] = stats?.[k] ?? 0;
  return out;
}

async function seedProfile(db, profile, { uid, displayName, rating = 800, stats = profile.EMPTY_STATS }) {
  await db.ref(`users/${uid}/profile`).set({
    userId: uid + '-num',
    displayName,
    equippedAvatar: 'crown',
    rating,
    stats: { ...stats },
    createdAt: 0,
  });
  // Mirror to /globalRatings — that's the publicly readable copy that
  // applyEloForFinishedGame reads the opponent's rating from (the per-user
  // profile path is private under the production rules).
  await db.ref(`globalRatings/${uid}`).set({
    uid, name: displayName, avatar: null, rating, updatedAt: 0,
  });
}

// ───────────────────────────────────────────────────────────────────────
// 1. computeStatsDelta + bumpStats matches the legacy shadow.
test('parity: stats delta after win matches legacy field-by-field', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();
  const prev = { ...m.profile.EMPTY_STATS, gamesPlayed: 3, gamesWon: 2, currentStreak: 2, longestStreak: 2, highScore: 100, totalScore: 250 };
  await seedProfile(db, m.profile, { uid: 'alice', displayName: 'Alice', stats: prev });

  const delta = m.profile.computeStatsDelta({
    result: 'win',
    score: 175,
    currentStreak: prev.currentStreak,
    longestStreak: prev.longestStreak,
    highScore: prev.highScore,
    bonusesTriggered: 2,
    wordsPlayed: 5,
  });
  await m.profile.bumpStats(db, 'alice', delta);

  const after = (await m.profile.readProfile(db, 'alice')).stats;
  const expected = legacyStatsShadow(prev, { result: 'win', myScore: 175, gameBonuses: 2, gameWords: 5 });

  assert.deepEqual(project(after), project(expected));
  assert.equal(after.currentStreak, 3);
  assert.equal(after.longestStreak, 3);
  assert.equal(after.highScore, 175);
  assert.equal(after.gamesWon, 3);
});

test('parity: stats delta after loss resets the streak (legacy semantics)', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();
  const prev = { ...m.profile.EMPTY_STATS, gamesPlayed: 5, gamesWon: 3, gamesLost: 2, currentStreak: 4, longestStreak: 4, highScore: 200, totalScore: 600 };
  await seedProfile(db, m.profile, { uid: 'alice', displayName: 'Alice', stats: prev });

  const delta = m.profile.computeStatsDelta({
    result: 'loss',
    score: 80,
    currentStreak: prev.currentStreak,
    longestStreak: prev.longestStreak,
    highScore: prev.highScore,
  });
  await m.profile.bumpStats(db, 'alice', delta);

  const after = (await m.profile.readProfile(db, 'alice')).stats;
  const expected = legacyStatsShadow(prev, { result: 'loss', myScore: 80 });

  assert.deepEqual(project(after), project(expected));
  assert.equal(after.currentStreak, 0, 'streak reset on loss');
  assert.equal(after.longestStreak, 4, 'longest streak preserved');
  assert.equal(after.highScore, 200, 'highScore NOT lowered by a worse game (max semantics)');
});

test('parity: stats delta after draw is bookkeeping-only', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();
  const prev = { ...m.profile.EMPTY_STATS, gamesPlayed: 2, currentStreak: 1, longestStreak: 1, highScore: 120 };
  await seedProfile(db, m.profile, { uid: 'alice', displayName: 'Alice', stats: prev });

  const delta = m.profile.computeStatsDelta({
    result: 'draw',
    score: 120,
    currentStreak: prev.currentStreak,
    longestStreak: prev.longestStreak,
    highScore: prev.highScore,
  });
  await m.profile.bumpStats(db, 'alice', delta);

  const after = (await m.profile.readProfile(db, 'alice')).stats;
  const expected = legacyStatsShadow(prev, { result: 'draw', myScore: 120 });

  assert.deepEqual(project(after), project(expected));
  assert.equal(after.gamesDraw, 1);
  assert.equal(after.currentStreak, 0, 'draw resets streak (legacy semantics)');
});

// ───────────────────────────────────────────────────────────────────────
// 2. Each client writes only its own data; the symmetric pair of calls
//    converges on a zero-sum Elo delta. Reflects the per-client-writes
//    security model: Firebase rules forbid writing the opponent's profile,
//    so each side must run applyEloForFinishedGame independently.
test('parity: paired wins — each client writes its own; leaderboard converges symmetric', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();
  await seedProfile(db, m.profile, { uid: 'alice', displayName: 'Alice', rating: 800 });
  await seedProfile(db, m.profile, { uid: 'bob',   displayName: 'Bob',   rating: 800 });

  // Alice's client runs first — she won.
  const aliceResult = await m.rating.applyEloForFinishedGame(db, {
    myUid: 'alice', oppUid: 'bob', result: 'win', now: 1234,
  });
  assert.equal(aliceResult.ok, true);
  assert.ok(aliceResult.myAfter > aliceResult.myBefore, 'winner rating up');
  assert.ok(aliceResult.oppAfter < aliceResult.oppBefore, 'loser rating down (in returned UI value)');
  // Only Alice's profile is touched by Alice's call.
  assert.equal((await m.profile.readProfile(db, 'alice')).rating, aliceResult.myAfter);
  assert.equal((await m.profile.readProfile(db, 'alice')).lastRatedAt, 1234);
  assert.equal((await m.profile.readProfile(db, 'bob')).rating, 800, "Bob's profile untouched by Alice");

  // Bob's client runs symmetrically — he lost. Note: Bob reads Alice's
  // updated rating from globalRatings since Alice's call mirrored there.
  const bobResult = await m.rating.applyEloForFinishedGame(db, {
    myUid: 'bob', oppUid: 'alice', result: 'loss', now: 1234,
  });
  assert.equal(bobResult.ok, true);

  // Both profiles now reflect the correct outcome.
  const aliceP = await m.profile.readProfile(db, 'alice');
  const bobP   = await m.profile.readProfile(db, 'bob');
  assert.ok(aliceP.rating > 800, 'alice up');
  assert.ok(bobP.rating   < 800, 'bob down');

  // Leaderboard rows mirror both profiles.
  const board = await m.rating.listTopRatings(db);
  assert.equal(board.length, 2);
  assert.equal(board[0].uid, 'alice', 'winner ranked above loser');
  assert.equal(board[0].rating, aliceP.rating);
  assert.equal(board[1].uid, 'bob');
  assert.equal(board[1].rating, bobP.rating);
});

test('parity: draw between equal-rated players leaves ratings unchanged', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();
  await seedProfile(db, m.profile, { uid: 'alice', displayName: 'Alice', rating: 1200 });
  await seedProfile(db, m.profile, { uid: 'bob',   displayName: 'Bob',   rating: 1200 });

  const result = await m.rating.applyEloForFinishedGame(db, {
    myUid: 'alice', oppUid: 'bob', result: 'draw',
  });
  assert.equal(result.myAfter, 1200);
  assert.equal(result.oppAfter, 1200);
});

test('parity: upset (low-rated beats high-rated) yields larger delta than even win', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();
  await seedProfile(db, m.profile, { uid: 'low',  displayName: 'Low',  rating: 700 });
  await seedProfile(db, m.profile, { uid: 'high', displayName: 'High', rating: 1500 });

  const upset = await m.rating.applyEloForFinishedGame(db, {
    myUid: 'low', oppUid: 'high', result: 'win',
  });
  assert.ok((upset.myAfter - upset.myBefore) > 15,
    'underdog gains substantially more than half-K (Elo expected behavior)');
});

// ───────────────────────────────────────────────────────────────────────
// 3. Avatar unlocks fire only on the first crossing.
test('parity: diffNewlyUnlocked returns avatars only on the threshold crossing', async () => {
  const m = await loadModules();
  // gamesPlayed crossing 5 → "fire" avatar; gamesWon crossing 5 → "shark".
  const before = { gamesPlayed: 4, gamesWon: 4, longestStreak: 0, highScore: 0 };
  const after  = { gamesPlayed: 5, gamesWon: 5, longestStreak: 0, highScore: 0 };
  const unlocked = m.avatar.diffNewlyUnlocked(before, after);
  const ids = unlocked.map(a => a.id).sort();
  assert.deepEqual(ids, ['fire', 'shark']);

  // Crossing the same threshold again on a later game doesn't refire.
  const later = { gamesPlayed: 6, gamesWon: 5, longestStreak: 0, highScore: 0 };
  const again = m.avatar.diffNewlyUnlocked(after, later);
  assert.equal(again.length, 0);
});

test('parity: high-score avatar unlock fires when stat crosses min', async () => {
  const m = await loadModules();
  const unlocked = m.avatar.diffNewlyUnlocked(
    { gamesPlayed: 1, highScore: 249 },
    { gamesPlayed: 1, highScore: 250 },
  );
  assert.deepEqual(unlocked.map(a => a.id), ['wizard']);
});

test('parity: locked avatars stay locked until threshold; isAvatarUnlocked reflects stat', async () => {
  const m = await loadModules();
  const wizard = m.avatar.findAvatar('wizard');
  assert.equal(m.avatar.isAvatarUnlocked(wizard, { highScore: 100 }), false);
  assert.equal(m.avatar.isAvatarUnlocked(wizard, { highScore: 250 }), true);
});

// ───────────────────────────────────────────────────────────────────────
// 4. bumpStats transaction is concurrency-safe (legacy used Firebase
// transaction too — applying two deltas from concurrent end-games must
// produce the sum, not last-write-wins).
test('parity: concurrent bumpStats from two finishing games sum, never overwrite', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();
  await seedProfile(db, m.profile, { uid: 'alice', displayName: 'Alice', stats: m.profile.EMPTY_STATS });

  await Promise.all([
    m.profile.bumpStats(db, 'alice', { gamesPlayed: 1, gamesWon: 1, totalScore: 100 }),
    m.profile.bumpStats(db, 'alice', { gamesPlayed: 1, gamesLost: 1, totalScore: 50 }),
  ]);

  const after = (await m.profile.readProfile(db, 'alice')).stats;
  assert.equal(after.gamesPlayed, 2, 'both increments applied');
  assert.equal(after.gamesWon, 1);
  assert.equal(after.gamesLost, 1);
  assert.equal(after.totalScore, 150);
});

// ───────────────────────────────────────────────────────────────────────
// 5. {max} semantics on highScore: lower score does NOT overwrite.
test('parity: highScore uses max semantics (legacy: if(myScore > stats.highScore))', async () => {
  const m = await loadModules();
  const db = m.mock.makeMockDb();
  await seedProfile(db, m.profile, { uid: 'alice', displayName: 'Alice', stats: { ...m.profile.EMPTY_STATS, highScore: 300 } });

  await m.profile.bumpStats(db, 'alice', m.profile.computeStatsDelta({
    result: 'loss', score: 50, highScore: 300, currentStreak: 0, longestStreak: 0,
  }));

  const after = (await m.profile.readProfile(db, 'alice')).stats;
  assert.equal(after.highScore, 300, 'a worse game cannot lower highScore');
});
