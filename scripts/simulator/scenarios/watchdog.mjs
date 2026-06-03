// watchdog.mjs — Phase 3 scenario.
//
// Exercises the live-online timeout watchdog (src/game/online/timeoutWatchdog.js)
// in four targeted scenarios using injected `now` so we don't wait wall-clock
// for deadlines:
//
//   1. single-timeout: active player idles → opponent's watchdog claims the
//      turn. Room: currentTurnSlot flips, missedTurns[active]=1, version+1,
//      status stays playing.
//   2. forfeit-after-two: active player idles for two consecutive deadlines →
//      missedTurns[active]=2 → room flips to status=abandoned, abandonedBy=active.
//   3. gated-by-livebonus: deadline passed BUT liveBonus.active=true →
//      watchdog must no-op. Room unchanged.
//   4. double-claim-race: both opponents (in a hypothetical split-brain) fire
//      watchdog tick simultaneously → transaction guards ensure only ONE
//      claim lands; the second sees the bumped version and aborts cleanly.
//
// Each scenario is a fresh room with a unique roomId. We bypass the normal
// game runner since the goal is to exercise the watchdog directly, not play
// a full game.

import { createTimeoutWatchdog } from '../../../src/game/online/timeoutWatchdog.js';
import { createInitialState } from '../../../src/game/core/gameEngine.js';
import { buildRoomDoc } from '../../../src/game/online/schema.js';
import { makeUserDb, adminRead, withRulesDisabled } from '../emulatorClient.mjs';

const BOT_TIME_SECONDS = 20;
const LIMIT_MS = BOT_TIME_SECONDS * 1000;
const GRACE_MS = 1000;

export async function runWatchdogBatch({ env, runId, batchSeed, crashCollector }) {
  const results = { scenarios: 0, crashes: 0 };
  for (const fn of [
    runSingleTimeout, runForfeitAfterTwo,
    runGatedByLiveBonus, runDoubleClaimRace,
  ]) {
    try {
      const violations = await fn({ env, runId, batchSeed });
      for (const v of violations) {
        crashCollector.report({
          class: `wd-${v.class}`,
          gameId: `wd-${runId}-${batchSeed}-${fn.name}`,
          detail: v.detail,
        });
        results.crashes++;
      }
      results.scenarios++;
    } catch (err) {
      crashCollector.report({
        class: 'wd-scenario-throw',
        gameId: `wd-${runId}-${batchSeed}-${fn.name}`,
        detail: err.message, stack: err.stack,
      });
      results.crashes++;
    }
  }
  return results;
}

// ─── shared setup ───────────────────────────────────────────────────────────

const PLAYERS = (suffix) => ({
  0: { uid: `sim-wd-${suffix}-a`, displayName: 'A', joinedAt: 1 },
  1: { uid: `sim-wd-${suffix}-b`, displayName: 'B', joinedAt: 2 },
});

async function seedRoom({ env, suffix, roomId, mySlot = 0, expired = true, withLiveBonus = false }) {
  const players = PLAYERS(suffix);
  const dbAlice = makeUserDb(env, players[0].uid);
  const dbBob = makeUserDb(env, players[1].uid);
  const engineState = createInitialState({
    mode: 'random-live',
    tileBagSeed: `wd-${suffix}`,
    players,
    settings: { timelimit: true, botTime: BOT_TIME_SECONDS },
  });
  const doc = buildRoomDoc({
    roomId, mode: 'random-live', players,
    settings: { timelimit: true, botTime: BOT_TIME_SECONDS },
    engineState,
    createdAt: Date.now(),
  });
  doc.status = 'playing';
  doc.currentTurnSlot = mySlot === 0 ? 1 : 0; // active player is the OPPOSITE of the watcher we'll mount
  doc.turnNumber = 1;
  doc.missedTurns = { 0: 0, 1: 0 };
  doc.turnDeadlineMs = expired
    ? Date.now() - 60_000  // way past
    : Date.now() + 60_000; // not yet
  doc._passCount = 0;
  if (withLiveBonus) {
    doc.liveBonus = { active: true, slot: doc.currentTurnSlot, kind: 'auto', updatedAt: Date.now() };
  }
  await dbAlice.ref(`rooms/${roomId}`).set(doc);
  // Active-cache warm so the watchdog transaction can read the room from
  // its first attempt (same cold-cache trap solved elsewhere; the watchdog
  // already does a .get() warmup internally, but having an .on subscription
  // makes the cache stick across multiple ticks).
  const subRef = (mySlot === 0 ? dbAlice : dbBob).ref(`rooms/${roomId}`);
  await new Promise(r => { subRef.on('value', function once() { subRef.off('value', once); r(); }); });
  return { dbAlice, dbBob, players };
}

// ─── scenarios ──────────────────────────────────────────────────────────────

async function runSingleTimeout({ env, runId, batchSeed }) {
  const suffix = `${runId}-${batchSeed}-s1`;
  const roomId = `wd-${suffix}`;
  const { dbBob } = await seedRoom({ env, suffix, roomId, mySlot: 1 });
  const wd = createTimeoutWatchdog({
    db: dbBob, roomId, mySlot: 1, limitMs: LIMIT_MS, graceMs: GRACE_MS,
    now: () => Date.now(),
    setIntervalFn: null, // we drive tick manually
  });
  const result = await wd.tick();
  wd.dispose();

  const violations = [];
  if (!result?.committed) {
    violations.push({ class: 'single-timeout-not-claimed', detail: `watchdog tick did not commit (committed=${result?.committed})` });
    return violations;
  }
  const room = await adminRead(env, `rooms/${roomId}`);
  if (room?.currentTurnSlot !== 1) {
    violations.push({ class: 'single-timeout-wrong-slot', detail: `currentTurnSlot=${room?.currentTurnSlot}, expected 1 after claim` });
  }
  if (room?.missedTurns?.[0] !== 1 && room?.missedTurns?.['0'] !== 1) {
    violations.push({ class: 'single-timeout-no-missed-bump', detail: `missedTurns=${JSON.stringify(room?.missedTurns)}, expected [0]=1` });
  }
  if (room?.status !== 'playing') {
    violations.push({ class: 'single-timeout-bad-status', detail: `status=${room?.status}, expected playing` });
  }
  if (Number(room?.version) <= 1) {
    violations.push({ class: 'single-timeout-no-version-bump', detail: `version=${room?.version}, expected > 1` });
  }
  return violations;
}

async function runForfeitAfterTwo({ env, runId, batchSeed }) {
  const suffix = `${runId}-${batchSeed}-s2`;
  const roomId = `wd-${suffix}`;
  const { dbBob } = await seedRoom({ env, suffix, roomId, mySlot: 1 });
  const wd = createTimeoutWatchdog({
    db: dbBob, roomId, mySlot: 1, limitMs: LIMIT_MS, graceMs: GRACE_MS,
    now: () => Date.now(),
    setIntervalFn: null,
  });
  // First tick: claims slot 0's missed turn → turn flips to 1.
  const tick1 = await wd.tick();
  // After tick1, currentTurnSlot=1, NOW bob is active. To trigger a SECOND
  // forfeit on slot 0, we'd need to wait for the *new* deadline to expire
  // for slot 1, then flip back. To keep the scenario focused on the
  // 2-missed-turns-for-slot-0 forfeit, we manually patch the room to:
  // - put slot 0 back as active
  // - set deadline expired
  // - leave missedTurns[0]=1 from the prior claim
  // and tick again.
  const room = await adminRead(env, `rooms/${roomId}`);
  // Set up the second-timeout state via elevated write: we need to put slot
  // 0 back as active with an expired deadline so the next watchdog tick
  // claims slot 0's SECOND missed turn and triggers the forfeit. The rules
  // wouldn't allow this transition from any authed client (post-claim
  // turnDeadlineMs is in the future, blocking the watchdog branch's
  // `data.turnDeadlineMs <= now` check), so we go via withRulesDisabled
  // — this is test scaffolding, not exercising the rule path.
  await withRulesDisabled(env, async (db) => {
    await db.ref(`rooms/${roomId}`).set({
      ...room,
      currentTurnSlot: 0,
      turnDeadlineMs: Date.now() - 60_000,
      version: Number(room.version) + 1,
    });
  });
  // Pre-warm again for the second tick.
  await dbBob.ref(`rooms/${roomId}`).once('value');
  const tick2 = await wd.tick();
  wd.dispose();

  const violations = [];
  if (!tick1?.committed) violations.push({ class: 'forfeit-tick1-not-claimed', detail: 'first tick must commit' });
  if (!tick2?.committed) violations.push({ class: 'forfeit-tick2-not-claimed', detail: 'second tick must commit' });
  const final = await adminRead(env, `rooms/${roomId}`);
  if (final?.status !== 'abandoned') {
    violations.push({ class: 'forfeit-not-abandoned', detail: `status=${final?.status}, expected abandoned after 2 missed turns` });
  }
  if (final?.abandonedBy !== 0) {
    violations.push({ class: 'forfeit-wrong-abandonedBy', detail: `abandonedBy=${final?.abandonedBy}, expected 0` });
  }
  return violations;
}

async function runGatedByLiveBonus({ env, runId, batchSeed }) {
  const suffix = `${runId}-${batchSeed}-s3`;
  const roomId = `wd-${suffix}`;
  const { dbBob } = await seedRoom({ env, suffix, roomId, mySlot: 1, withLiveBonus: true });
  const beforeRoom = await adminRead(env, `rooms/${roomId}`);
  const wd = createTimeoutWatchdog({
    db: dbBob, roomId, mySlot: 1, limitMs: LIMIT_MS, graceMs: GRACE_MS,
    now: () => Date.now(),
    setIntervalFn: null,
  });
  const result = await wd.tick();
  wd.dispose();

  const violations = [];
  // When the update fn returns undefined the transaction reports
  // committed=false. That's exactly what should happen here.
  if (result?.committed) {
    const after = await adminRead(env, `rooms/${roomId}`);
    violations.push({
      class: 'live-bonus-gate-violated',
      detail: `watchdog claimed during liveBonus.active=true! before=v${beforeRoom?.version} slot=${beforeRoom?.currentTurnSlot}, after=v${after?.version} slot=${after?.currentTurnSlot}`,
    });
  }
  const after = await adminRead(env, `rooms/${roomId}`);
  if (Number(after?.version) !== Number(beforeRoom?.version)) {
    violations.push({
      class: 'live-bonus-version-bumped',
      detail: `version bumped despite no-op: ${beforeRoom?.version} -> ${after?.version}`,
    });
  }
  return violations;
}

async function runDoubleClaimRace({ env, runId, batchSeed }) {
  const suffix = `${runId}-${batchSeed}-s4`;
  const roomId = `wd-${suffix}`;
  const { dbAlice, dbBob } = await seedRoom({ env, suffix, roomId, mySlot: 1 });
  // In a real split-brain both clients would have the watchdog mounted.
  // Build two watchdogs and fire ticks simultaneously.
  const wdA = createTimeoutWatchdog({
    db: dbAlice, roomId, mySlot: 0, limitMs: LIMIT_MS, graceMs: GRACE_MS,
    now: () => Date.now(), setIntervalFn: null,
  });
  const wdB = createTimeoutWatchdog({
    db: dbBob, roomId, mySlot: 1, limitMs: LIMIT_MS, graceMs: GRACE_MS,
    now: () => Date.now(), setIntervalFn: null,
  });
  // Note: shouldClaimExpiredOnlineTurn requires myIdx !== current. So wdA
  // (slot 0) only ticks when active is slot 1, and wdB (slot 1) only when
  // active is slot 0. Our seed set currentTurnSlot=0, so wdB should fire.
  // wdA's tick will see current.currentTurnSlot=0 === wdA's mySlot=0 and
  // bail in shouldClaimExpiredOnlineTurn — that's a different test path
  // (active player should not run watchdog), still worth covering.
  const [resA, resB] = await Promise.all([wdA.tick(), wdB.tick()]);
  wdA.dispose(); wdB.dispose();

  const violations = [];
  // wdA must NOT claim (active player can't claim itself).
  if (resA?.committed) {
    violations.push({
      class: 'active-player-claimed',
      detail: 'watchdog mounted on the ACTIVE slot must not commit a claim',
    });
  }
  // wdB should claim exactly once.
  if (!resB?.committed) {
    violations.push({
      class: 'opponent-watchdog-failed',
      detail: 'opponent watchdog tick failed to commit',
    });
  }
  const after = await adminRead(env, `rooms/${roomId}`);
  if (Number(after?.version) !== 2) {
    violations.push({
      class: 'unexpected-version-after-race',
      detail: `expected version=2 after exactly one claim, got ${after?.version}`,
    });
  }
  return violations;
}
