// reconnect.mjs — Phase 4 scenario.
//
// Exercises the dispose / re-create lifecycle of onlineGameSession against
// real Firebase rules + transactions. Three sub-scenarios per batch:
//
//   1. reconnect-during-opponent-turn — slot 0 disposes while it's NOT their
//      turn, opponent makes a move in their absence, slot 0 reconnects, then
//      makes a move on the next turn. Verifies the reconnected session reads
//      the LATEST authoritative state and the first post-reconnect commit
//      lands cleanly (cache pre-warm + version cursor advance).
//   2. reconnect-on-own-turn — slot 0 disposes while it IS their turn (mid-
//      think simulation), reconnects, then makes a move. Verifies the
//      reconnected session correctly sees currentTurnSlot=mySlot and can
//      commit. (Production analogue: tab refresh during your turn.)
//   3. no-ghost-events-after-dispose — slot 0 disposes, then bob makes a
//      move. The disposed session must not emit any further bus events that
//      could leak across a per-game bus boundary. Verifies dispose actually
//      tears down the watcher.
//
// All three share the same bag-parity / version-monotonic / status invariants
// the normal scenario uses, applied after each round-trip.

import { CMD } from '../../../src/events/commands.js';
import { EV } from '../../../src/events/eventTypes.js';
import { createInitialState } from '../../../src/game/core/gameEngine.js';
import { createOnlineGameSession } from '../../../src/game/sessions/onlineGameSession.js';
import { buildRoomDoc } from '../../../src/game/online/schema.js';
import { pickCommand as randomPick } from '../bots/randomBot.mjs';
import { checkInvariants } from '../invariants.mjs';
import { adminRead, makeUserDb, withRulesDisabled } from '../emulatorClient.mjs';

const POLL_INTERVAL_MS = 15;
const COMMIT_WAIT_MS = 5_000;

export async function runReconnectBatch({ env, runId, batchSeed, makeRng, crashCollector }) {
  const results = { scenarios: 0, crashes: 0 };
  for (const fn of [
    runReconnectDuringOpponentTurn,
    runReconnectOnOwnTurn,
    runNoGhostEventsAfterDispose,
  ]) {
    try {
      const violations = await fn({ env, runId, batchSeed, makeRng });
      for (const v of violations) {
        crashCollector.report({
          class: `rc-${v.class}`,
          gameId: `rc-${runId}-${batchSeed}-${fn.name}`,
          detail: v.detail,
        });
        results.crashes++;
      }
      results.scenarios++;
    } catch (err) {
      crashCollector.report({
        class: 'rc-scenario-throw',
        gameId: `rc-${runId}-${batchSeed}-${fn.name}`,
        detail: err.message, stack: err.stack,
      });
      results.crashes++;
    }
  }
  return results;
}

// ─── helpers ────────────────────────────────────────────────────────────────

const PLAYERS_FOR = (suffix) => ({
  0: { uid: `sim-rc-${suffix}-a`, displayName: 'A', joinedAt: 1 },
  1: { uid: `sim-rc-${suffix}-b`, displayName: 'B', joinedAt: 2 },
});

async function seedRoom({ env, suffix, roomId, seed }) {
  const players = PLAYERS_FOR(suffix);
  const dbA = makeUserDb(env, players[0].uid);
  const dbB = makeUserDb(env, players[1].uid);
  const engineState = createInitialState({
    mode: 'friend-live',
    tileBagSeed: seed,
    players,
    settings: { timelimit: false },
  });
  const doc = buildRoomDoc({
    roomId, mode: 'friend-live', players,
    settings: { timelimit: false },
    engineState,
    createdAt: Date.now(),
  });
  doc.status = 'playing';
  doc.turnDeadlineMs = null;
  doc.missedTurns = { 0: 0, 1: 0 };
  await withRulesDisabled(env, async (db) => {
    await db.ref(`rooms/${roomId}`).set(doc);
  });
  return { dbA, dbB, players };
}

function createBus() {
  const subs = new Map();
  return {
    on(type, fn) {
      let set = subs.get(type);
      if (!set) { set = new Set(); subs.set(type, set); }
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(type, payload) {
      const set = subs.get(type);
      if (!set) return;
      for (const fn of set) { try { fn(payload); } catch (e) { /* swallow */ } }
    },
  };
}

async function openSession({ db, roomId, mySlot, env }) {
  const bus = createBus();
  // Auto-finalize bonus mini-games (same as main runner).
  bus.on(EV.MOVE_CONFIRMED, (payload) => {
    if (payload?.scoringDeferred) {
      queueMicrotask(() => {
        try { session.dispatch({ type: CMD.FINALIZE_BOOST_AWARD, payload: { slot: payload.slot, extra: 0 } }); }
        catch { /* swallow */ }
      });
    }
  });
  const room = await adminRead(env, `rooms/${roomId}`);
  const session = await createOnlineGameSession({ bus, db, room, mySlot });
  session.start();
  // Cache pre-warm so the first commitTransaction lands.
  await db.ref(`rooms/${roomId}`).once('value');
  return { session, bus };
}

async function waitForVersionAtLeast({ env, roomId, minVersion, timeoutMs = COMMIT_WAIT_MS }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const room = await adminRead(env, `rooms/${roomId}`);
    if (room && Number(room.version) >= minVersion) return room;
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function makeBotMove({ env, roomId, session, mySlot, rng }) {
  const room = await adminRead(env, `rooms/${roomId}`);
  if (!room || room.status !== 'playing') return { skipped: true };
  if (Number(room.currentTurnSlot) !== mySlot) return { skipped: true, reason: 'not-my-turn' };
  const cmd = randomPick(session.state, mySlot, rng);
  if (!cmd) return { skipped: true, reason: 'bot-no-move' };
  const versionBefore = Number(room.version);
  session.dispatch(cmd);
  await new Promise(r => setImmediate(r));
  const after = await waitForVersionAtLeast({ env, roomId, minVersion: versionBefore + 1 });
  return { skipped: false, cmd, versionBefore, after };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function runInvariantsAndCollect(prev, next) {
  const violations = checkInvariants(prev, next);
  return violations.map(v => ({ class: `invariant-${v.class}`, detail: v.detail }));
}

// ─── scenarios ──────────────────────────────────────────────────────────────

async function runReconnectDuringOpponentTurn({ env, runId, batchSeed, makeRng }) {
  const suffix = `${runId}-${batchSeed}-s1`;
  const roomId = `rc-${suffix}`;
  const rng = makeRng(`${suffix}/rng`);
  const violations = [];

  const { dbA, dbB } = await seedRoom({ env, suffix, roomId, seed: suffix });
  let { session: sessA } = await openSession({ db: dbA, roomId, mySlot: 0, env });
  let { session: sessB } = await openSession({ db: dbB, roomId, mySlot: 1, env });

  // Slot 0 plays. (Initial currentTurnSlot=0 from createInitialState defaults.)
  let prev = await adminRead(env, `rooms/${roomId}`);
  const m0 = await makeBotMove({ env, roomId, session: sessA, mySlot: 0, rng });
  if (m0.after) violations.push(...runInvariantsAndCollect(prev, m0.after));

  prev = await adminRead(env, `rooms/${roomId}`);
  if (prev?.currentTurnSlot !== 1) {
    // Bot couldn't move so turn didn't flip — abort scenario quietly.
    await sessA.dispose(); await sessB.dispose();
    return violations;
  }

  // Slot 0 disposes BEFORE slot 1 makes its move. (Tab close mid-opponent-turn.)
  await sessA.dispose();
  sessA = null;

  // Slot 1 plays. Slot 0 is gone — bob's session is the only client.
  const m1 = await makeBotMove({ env, roomId, session: sessB, mySlot: 1, rng });
  if (m1.after) violations.push(...runInvariantsAndCollect(prev, m1.after));

  // Slot 0 reconnects. The new session must initialize from the LATEST room
  // state (which now has bob's move applied).
  const reopened = await openSession({ db: dbA, roomId, mySlot: 0, env });
  sessA = reopened.session;

  const roomAfterReopen = await adminRead(env, `rooms/${roomId}`);
  if (sessA.state.currentTurnSlot !== Number(roomAfterReopen.currentTurnSlot)) {
    violations.push({
      class: 'reopened-state-turn-mismatch',
      detail: `session.state.currentTurnSlot=${sessA.state.currentTurnSlot} but room.currentTurnSlot=${roomAfterReopen.currentTurnSlot}`,
    });
  }
  if (Number(sessA.state.turnNumber) !== Number(roomAfterReopen.turnNumber)) {
    violations.push({
      class: 'reopened-state-turn-number-mismatch',
      detail: `session.state.turnNumber=${sessA.state.turnNumber} but room.turnNumber=${roomAfterReopen.turnNumber}`,
    });
  }

  // Slot 0 plays its turn via the new session. The commit must land — if
  // version-cursor / cache-warm logic on reconnect is broken, this will hang
  // and the runInvariants below will see no transition.
  if (roomAfterReopen?.currentTurnSlot === 0) {
    prev = roomAfterReopen;
    const m2 = await makeBotMove({ env, roomId, session: sessA, mySlot: 0, rng });
    if (!m2.skipped && !m2.after) {
      violations.push({
        class: 'reopened-commit-stalled',
        detail: 'first commit after reconnect never bumped the version',
      });
    } else if (m2.after) {
      violations.push(...runInvariantsAndCollect(prev, m2.after));
    }
  }

  await sessA.dispose(); await sessB.dispose();
  return violations;
}

async function runReconnectOnOwnTurn({ env, runId, batchSeed, makeRng }) {
  const suffix = `${runId}-${batchSeed}-s2`;
  const roomId = `rc-${suffix}`;
  const rng = makeRng(`${suffix}/rng`);
  const violations = [];

  const { dbA, dbB } = await seedRoom({ env, suffix, roomId, seed: suffix });
  let { session: sessA } = await openSession({ db: dbA, roomId, mySlot: 0, env });
  let { session: sessB } = await openSession({ db: dbB, roomId, mySlot: 1, env });

  // Room starts with currentTurnSlot=0. Alice disposes WITHOUT playing — i.e.
  // tab refresh mid-think on your own turn.
  await sessA.dispose();
  sessA = null;

  // Reopen. The new session reads the room — it must see currentTurnSlot=0.
  const reopened = await openSession({ db: dbA, roomId, mySlot: 0, env });
  sessA = reopened.session;

  if (sessA.state.currentTurnSlot !== 0) {
    violations.push({
      class: 'reopen-own-turn-lost',
      detail: `after reopen on own turn, session.state.currentTurnSlot=${sessA.state.currentTurnSlot}, expected 0`,
    });
  }

  // Alice now plays via the new session.
  const prev = await adminRead(env, `rooms/${roomId}`);
  const m0 = await makeBotMove({ env, roomId, session: sessA, mySlot: 0, rng });
  if (!m0.skipped && !m0.after) {
    violations.push({
      class: 'reopen-own-turn-commit-stalled',
      detail: 'first commit after reopen on own turn never bumped the version',
    });
  } else if (m0.after) {
    violations.push(...runInvariantsAndCollect(prev, m0.after));
  }

  await sessA.dispose(); await sessB.dispose();
  return violations;
}

async function runNoGhostEventsAfterDispose({ env, runId, batchSeed, makeRng }) {
  const suffix = `${runId}-${batchSeed}-s3`;
  const roomId = `rc-${suffix}`;
  const rng = makeRng(`${suffix}/rng`);
  const violations = [];

  const { dbA, dbB } = await seedRoom({ env, suffix, roomId, seed: suffix });
  const opened = await openSession({ db: dbA, roomId, mySlot: 0, env });
  const sessA = opened.session;
  const busA = opened.bus;
  const sessB = (await openSession({ db: dbB, roomId, mySlot: 1, env })).session;

  // Alice plays one move to advance turn to bob.
  const m0 = await makeBotMove({ env, roomId, session: sessA, mySlot: 0, rng });
  if (m0.skipped) {
    await sessA.dispose(); await sessB.dispose();
    return violations; // can't drive the scenario without a first move
  }

  // Dispose alice. Now wire a "spy" on alice's bus that records any event.
  await sessA.dispose();
  const ghostEvents = [];
  for (const evt of [EV.OPPONENT_MOVED, EV.MOVE_CONFIRMED, EV.TURN_CHANGED, EV.SCORE_CHANGED, EV.GAME_COMPLETED]) {
    busA.on(evt, (payload) => { ghostEvents.push({ evt, payload }); });
  }

  // Bob plays. If alice's watchRoom was not torn down by dispose(), the
  // snapshot would still flow through and re-emit OPPONENT_MOVED / TURN_CHANGED
  // on alice's bus.
  await makeBotMove({ env, roomId, session: sessB, mySlot: 1, rng });
  await sleep(50); // give any late callbacks a chance to fire

  if (ghostEvents.length > 0) {
    violations.push({
      class: 'ghost-event-after-dispose',
      detail: `disposed session emitted ${ghostEvents.length} events: ${ghostEvents.map(e => e.evt).join(',')}`,
    });
  }

  await sessB.dispose();
  return violations;
}
