// gameRunner.mjs
//
// Runs one full online game between two bots, using authed emulator dbs.
// Captures any engine throws, commit livelocks, invariant violations, or
// hangs to the supplied crashCollector.
//
// Each game uses its OWN bus instance so concurrent games don't cross-talk.
// (The real app uses a singleton bus; per-game buses here are a simulator
// affordance, not a behavior change.)

import { CMD } from '../../src/events/commands.js';
import { EV } from '../../src/events/eventTypes.js';
import { createInitialState } from '../../src/game/core/gameEngine.js';
import { createOnlineGameSession } from '../../src/game/sessions/onlineGameSession.js';
import { buildRoomDoc, STATUS } from '../../src/game/online/schema.js';

import { pickCommand as randomPick } from './bots/randomBot.mjs';
import { createReplayBot } from './bots/replayBot.mjs';
import { createFuzzBot } from './bots/fuzzBot.mjs';
import { checkInvariants } from './invariants.mjs';
import { adminRead, makeUserDb } from './emulatorClient.mjs';
import { createReplayDivergenceTracker } from './replayDivergence.mjs';

// Wraps schema.buildRoomDoc so the test-only fields (missedTurns/turnDeadlineMs)
// land at create time instead of needing a follow-up write.
function buildRoomDocLocal({ roomId, mode, players, settings, engineState }) {
  const createdAt = Date.now();
  const doc = buildRoomDoc({ roomId, mode, players, settings, engineState, createdAt });
  doc.missedTurns = { 0: 0, 1: 0 };
  doc.turnDeadlineMs = null;
  return doc;
}

const COMMIT_WAIT_TIMEOUT_MS = 5000;
const COMMIT_POLL_INTERVAL_MS = 15;
const HANG_TIMEOUT_TICKS = 6; // consecutive no-progress ticks before giving up
const MAX_GAME_TICKS = 400; // hard ceiling to prevent infinite loops
const LIVELOCK_THRESHOLD = 6; // unchanged version after this many dispatches

/**
 * Run a single online game to terminal status (or crash). Returns a summary
 * { gameId, ticks, finalStatus, crashes }.
 *
 * @param {Object} opts
 * @param {Object} opts.env           rules-unit-testing environment
 * @param {string} opts.gameId        unique id for this game
 * @param {string} opts.gameSeed      RNG seed; also used as tileBagSeed
 * @param {(seed: string) => () => number} opts.makeRng
 * @param {Object} opts.crashCollector
 * @param {{ mode?: string, replay?: any[] }} [opts.options]
 */
export async function runGame({ env, gameId, gameSeed, makeRng, crashCollector, options = {} }) {
  const mode = options.mode ?? 'friend-live';
  const rng = makeRng(gameSeed);

  // Extract replay record up front so room setup can use its tileBagSeed +
  // settings; createReplayBot is called later but reads the same record.
  const replayRecord = options.replay && typeof options.replay === 'object' && Array.isArray(options.replay.moveHistory)
    ? options.replay
    : null;

  const players = {
    0: { uid: `sim-${gameId}-a`, displayName: 'BotA', joinedAt: 1 },
    1: { uid: `sim-${gameId}-b`, displayName: 'BotB', joinedAt: 2 },
  };
  const roomId = `room-${gameId}`;
  // For replay runs, use the original room's settings + tileBagSeed so the
  // initial racks reconstruct identically to the prod game. Without the same
  // seed, the placed-not-in-rack defense rejects every move because the
  // letters the original players placed aren't in the freshly-drawn racks.
  const settings = replayRecord
    ? { ...(replayRecord.settings ?? {}), timelimit: false }
    : { timelimit: false };
  const tileBagSeed = replayRecord?.tileBagSeed || gameSeed;

  // ─── Phase 1: create the room.
  //
  // We can't use the production `createRoom()` here because it ALSO writes
  // to /users/{both-uids}/activeRoom, which the rules only allow each user
  // to do for themselves. Instead we have the host (slot 0) write the room
  // doc directly via their authed context: the rule for new /rooms/{id}
  // permits any player listed in the doc to create it.
  //
  // The room write must come from an AUTHED context (not seedWithoutRules)
  // because the rules-unit-testing transaction inside commitTransaction
  // appears to see `current=null` when the seeding context is torn down
  // before the user context reads — which silently aborts every commit.
  const dbAlice = makeUserDb(env, players[0].uid);
  const dbBob = makeUserDb(env, players[1].uid);
  let roomDoc;
  try {
    // For replays: derive the starting slot from prod's first move so the
    // replay's first dispatch matches. Default createInitialState uses
    // startingSlot=0, but ~40% of prod games actually start with slot 1 —
    // those would otherwise silently terminate at tick 0 because
    // replayBot.pickCommand returns null on (next.slot !== mySlot).
    const replayStartingSlot = replayRecord?.moveHistory?.[0]?.slot;
    const startingSlot = (replayStartingSlot === 0 || replayStartingSlot === 1)
      ? replayStartingSlot
      : 0;
    const engineState = createInitialState({
      mode,
      tileBagSeed,
      players,
      settings,
      startingSlot,
    });
    roomDoc = buildRoomDocLocal({ roomId, mode, players, settings, engineState });
    await dbAlice.ref(`rooms/${roomId}`).set(roomDoc);
    // Flip status to 'playing' — the per-child status rule allows either player.
    await dbAlice.ref(`rooms/${roomId}/status`).set('playing');
  } catch (err) {
    crashCollector.report({
      class: 'room-setup-failed',
      gameId, gameSeed,
      detail: err.message,
      stack: err.stack,
    });
    return { gameId, ticks: 0, finalStatus: 'setup-failed', crashes: 1 };
  }

  // ─── Phase 2: build the two authed sessions, each on its own bus.
  //
  // Two sessions on ONE bus would mismodel production: each tab has its
  // own module-level bus, so onlineGameSession's watcher re-emissions
  // (e.g. TILES_EXCHANGED / LOCK_PLACED for opponent UI updates) only
  // reach the local session. If both sessions share a bus here, the
  // originating session sees its own committed move's watcher re-emission
  // and double-commits — which then fails permission_denied because the
  // turn already flipped. Per-session buses match real-world topology.
  const busA = createBus(gameId, 'A');
  const busB = createBus(gameId, 'B');
  const buses = { 0: busA, 1: busB };
  const replayBot = replayRecord ? createReplayBot(replayRecord.moveHistory) : null;
  // Replay-mode divergence detector: catches per-move score/word mismatches,
  // engine rejections of prod-accepted moves, and final-state drift. Without
  // this, replay only catches crashes — but most real bugs in replayed games
  // produce wrong output, not crashes.
  const divergenceTracker = replayRecord ? createReplayDivergenceTracker({
    crashCollector, gameId, gameSeed,
    expectedFinal: replayRecord.expectedFinal,
    moveHistory: replayRecord.moveHistory,
    originalRoomId: replayRecord.originalRoomId,
  }) : null;
  // Optional fuzz bot wraps the random picker with adversarial commands.
  const fuzzBot = options.bot === 'fuzz' ? createFuzzBot({ fuzzRate: options.fuzzRate }) : null;

  // Auto-finalize bonus mini-games / wheels with 0 extra so the runner can
  // make progress without simulating UI. This exercises the deferred-score
  // path (MOVE_CONFIRMED scoringDeferred=true → FINALIZE_BOOST_AWARD →
  // MOVE_SCORE_COMMITTED → second commitTransaction). Attach to BOTH buses
  // since either side may trigger a deferred-bonus move.
  for (const slot of [0, 1]) {
    buses[slot].on(EV.MOVE_CONFIRMED, (payload) => {
      if (payload?.scoringDeferred) {
        // For replays of recorded games we know what the bonus award SHOULD
        // produce — it's the gap between the engine's base score (sent as
        // payload.score with scoringDeferred=true) and the score actually
        // recorded in prod for this move. Passing that as `extra` faithfully
        // reproduces the bonus award without simulating the mini-game UI.
        // For random/fuzz bots there's no recorded outcome, so default to 0.
        let extra = 0;
        if (replayBot && replayRecord) {
          const idx = replayBot.lastReturnedIndex();
          const prodMove = replayRecord.moveHistory[idx];
          if (prodMove && prodMove.score != null) {
            const baseScore = Number(payload.score || 0);
            extra = Number(prodMove.score) - baseScore;
            if (process.env.SIM_DEBUG_REPLAY) {
              console.log(`[replay-bonus] move#${idx} baseScore=${baseScore} prodScore=${prodMove.score} extra=${extra}`);
            }
          } else if (process.env.SIM_DEBUG_REPLAY) {
            console.log(`[replay-bonus] move#${idx} no prod score (move:`, JSON.stringify(prodMove), ')');
          }
        } else if (process.env.SIM_DEBUG_REPLAY) {
          console.log('[replay-bonus] scoringDeferred but no replay context');
        }
        // Defer to the next tick so the session's own MOVE_CONFIRMED handler
        // runs first and registers deferredCommitPending = true.
        queueMicrotask(() => {
          try {
            sessions[payload.slot]?.dispatch({
              type: CMD.FINALIZE_BOOST_AWARD,
              payload: { slot: payload.slot, extra },
            });
          } catch { /* engine threw; picked up by next dispatch wrap */ }
        });
      }
    });
  }

  // Track engine-rejected dispatches so the runner's commit-livelock detector
  // can distinguish "Firebase commit never landed" (real livelock — worth
  // logging) from "engine correctly defended against a bot's bad command"
  // (expected in fuzz mode — not a livelock). Each rejection clears the
  // counter for that game.
  let engineRejectedThisTick = false;
  for (const slot of [0, 1]) {
    buses[slot].on(EV.INVALID_MOVE_REJECTED, () => { engineRejectedThisTick = true; });
  }

  // Attach replay divergence tracker to both buses so it sees MOVE_CONFIRMED
  // and INVALID_MOVE_REJECTED regardless of which slot just acted.
  if (divergenceTracker) {
    divergenceTracker.attachBus(buses[0]);
    divergenceTracker.attachBus(buses[1]);
  }

  // Re-read the room from alice's authed context to confirm visibility before
  // wiring sessions; if alice can't see the room she just wrote, no transaction
  // commit will ever succeed and we'd loop until livelock detection fires.
  const observedRoom = await readRoomFromCtx(dbAlice, roomId);
  if (!observedRoom) {
    crashCollector.report({
      class: 'room-not-visible-to-host',
      gameId, gameSeed,
      detail: `roomId=${roomId} not readable from host's authed context`,
    });
    return { gameId, ticks: 0, finalStatus: 'setup-failed', crashes: 1 };
  }

  const sessions = { 0: null, 1: null };
  try {
    sessions[0] = await createOnlineGameSession({ bus: busA, db: dbAlice, room: observedRoom, mySlot: 0 });
    sessions[1] = await createOnlineGameSession({ bus: busB, db: dbBob, room: observedRoom, mySlot: 1 });
    sessions[0].start();
    sessions[1].start();
    // Warm each db handle's transaction-read cache. Without this, the very
    // first commitTransaction sees `current=null` (cache empty) and aborts
    // with SYNC_REJECTED. The session's own watchRoom() subscription would
    // eventually populate the cache, but it fires async after dispatch starts.
    await Promise.all([
      dbAlice.ref(`rooms/${roomId}`).once('value'),
      dbBob.ref(`rooms/${roomId}`).once('value'),
    ]);
  } catch (err) {
    crashCollector.report({
      class: 'session-init-failed',
      gameId, gameSeed,
      detail: err.message,
      stack: err.stack,
    });
    return { gameId, ticks: 0, finalStatus: 'setup-failed', crashes: 1 };
  }

  // ─── Phase 3: tick loop. Each iteration: snapshot room → ask active bot →
  // dispatch → wait for commit → invariants → repeat.
  let prevRoom = observedRoom;
  let ticks = 0;
  let crashes = 0;
  let noProgressTicks = 0;
  let livelockCount = 0;
  let finalStatus = 'in-progress';

  try {
    while (ticks < MAX_GAME_TICKS) {
      ticks++;
      const current = await adminRead(env, `rooms/${roomId}`);
      if (!current) {
        crashCollector.report({
          class: 'room-vanished',
          gameId, gameSeed, tickCount: ticks,
          roomSnapshot: prevRoom,
        });
        crashes++;
        finalStatus = 'room-vanished';
        break;
      }
      if (isTerminal(current.status)) {
        finalStatus = current.status;
        break;
      }

      const activeSlot = Number(current.currentTurnSlot);
      if (activeSlot !== 0 && activeSlot !== 1) {
        crashCollector.report({
          class: 'invariant-turn-slot-out-of-range',
          gameId, gameSeed, tickCount: ticks,
          roomSnapshot: current,
          detail: `currentTurnSlot=${current.currentTurnSlot}`,
        });
        crashes++;
        finalStatus = 'crash';
        break;
      }

      const session = sessions[activeSlot];
      const cmd = replayBot
        ? replayBot.pickCommand(session.state, activeSlot)
        : fuzzBot
          ? fuzzBot.pickCommand(session.state, activeSlot, rng)
          : randomPick(session.state, activeSlot, rng);

      if (!cmd) {
        // Bot returned null. For replay this means the recording is exhausted
        // (or diverged) — that's an expected end-of-life, not a crash.
        // For random/fuzz bots it's "couldn't find a move and couldn't pass"
        // which IS a stuck game worth logging.
        if (replayBot) {
          finalStatus = 'replay-exhausted';
        } else {
          finalStatus = 'bot-gave-up';
          crashCollector.report({
            class: 'bot-gave-up',
            gameId, gameSeed, tickCount: ticks,
            roomSnapshot: current,
            detail: `roomSlot=${current.currentTurnSlot} session[${activeSlot}].state.currentTurnSlot=${session.state.currentTurnSlot} session[${activeSlot}].state.status=${session.state.status}`,
          });
        }
        break;
      }

      const versionBefore = Number(current.version);
      engineRejectedThisTick = false;
      let dispatchError = null;
      try {
        session.dispatch(cmd);
      } catch (err) {
        dispatchError = err;
      }
      if (dispatchError) {
        crashCollector.report({
          class: 'engine-throw',
          gameId, gameSeed, tickCount: ticks,
          roomSnapshot: current,
          lastCommand: { slot: activeSlot, ...cmd },
          detail: dispatchError.message,
          stack: dispatchError.stack,
        });
        crashes++;
        finalStatus = 'crash';
        break;
      }

      // Drain pending microtasks (auto-finalize, async commit handlers) before
      // we start polling — otherwise the very first poll may fire before the
      // commit handler has even been queued.
      await flushMicrotasks();

      const next = await waitForCommitOrTerminal(env, roomId, versionBefore, current.status);
      if (next) {
        // The room version bumped at the emulator, but the local watchRoom
        // callbacks (which keep session.state in sync) fire asynchronously.
        // Give them a few microtask ticks to catch up so the next iteration
        // sees fresh session.state.currentTurnSlot for the new active slot.
        await waitForSessionsToSync(sessions, next);
      }
      if (!next) {
        // The engine emitted INVALID_MOVE_REJECTED → it correctly defended
        // against a bad command (expected in fuzz mode). Don't count this
        // toward EITHER commit-livelock (Firebase never bumped) OR hang
        // (game runner waited and waited). Both detectors should fire only
        // when the engine ACCEPTED the command but progress still stalled.
        if (!engineRejectedThisTick) {
          livelockCount++;
          noProgressTicks++;
        }
        if (replayBot) {
          // Replay mode: log via the divergence tracker (which surfaces
          // engine-rejected as replay-engine-rejected with the reason) and
          // KEEP REPLAYING. We want to see ALL divergences in this game,
          // not just the first. The replay terminates naturally when the
          // moveHistory cursor exhausts or status flips to terminal.
          divergenceTracker?.recordDispatch({ commandType: cmd.type, slot: activeSlot, accepted: false });
          crashes++; // every divergence counts as a finding
          continue;
        }
        if (livelockCount >= LIVELOCK_THRESHOLD) {
          crashCollector.report({
            class: 'commit-livelock',
            gameId, gameSeed, tickCount: ticks,
            roomSnapshot: current,
            lastCommand: { slot: activeSlot, ...cmd },
            detail: `${livelockCount} consecutive commands produced no version bump`,
          });
          crashes++;
          finalStatus = 'crash';
          break;
        }
        if (noProgressTicks >= HANG_TIMEOUT_TICKS) {
          crashCollector.report({
            class: 'hang',
            gameId, gameSeed, tickCount: ticks,
            roomSnapshot: current,
            lastCommand: { slot: activeSlot, ...cmd },
            detail: `${noProgressTicks} no-progress ticks`,
          });
          crashes++;
          finalStatus = 'crash';
          break;
        }
        continue;
      }

      livelockCount = 0;
      noProgressTicks = 0;

      // Replay tracker: this dispatch landed in Firebase. Compare the
      // emitted MOVE_CONFIRMED (captured via attachBus) against prod's
      // recorded score/words for this move index.
      if (divergenceTracker) {
        divergenceTracker.recordDispatch({ commandType: cmd.type, slot: activeSlot, accepted: true });
      }

      // Run invariants on the transition.
      const violations = checkInvariants(current, next, { gameId, ticks });
      for (const v of violations) {
        crashCollector.report({
          class: `invariant-${v.class}`,
          gameId, gameSeed, tickCount: ticks,
          roomSnapshot: next,
          lastCommand: { slot: activeSlot, ...cmd },
          detail: v.detail,
        });
        crashes++;
      }

      prevRoom = next;
      if (isTerminal(next.status)) {
        finalStatus = next.status;
        break;
      }
    }
  } finally {
    // Run final-state divergence comparison BEFORE disposing sessions, while
    // the replay's final room snapshot is still readable from the emulator.
    if (divergenceTracker) {
      try {
        const finalRoom = await adminRead(env, `rooms/${roomId}`);
        divergenceTracker.finalize(finalRoom);
      } catch { /* swallow — primary crashes already reported */ }
    }
    try { await sessions[0]?.dispose(); } catch { /* swallow */ }
    try { await sessions[1]?.dispose(); } catch { /* swallow */ }
  }

  if (ticks >= MAX_GAME_TICKS && finalStatus === 'in-progress') {
    crashCollector.report({
      class: 'max-ticks-exceeded',
      gameId, gameSeed, tickCount: ticks,
      roomSnapshot: prevRoom,
      detail: `game did not reach terminal status within ${MAX_GAME_TICKS} ticks`,
    });
    crashes++;
    finalStatus = 'max-ticks';
  }

  return { gameId, ticks, finalStatus, crashes };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function isTerminal(status) {
  return status === 'completed' || status === 'abandoned' || status === 'expired';
}

async function waitForSessionsToSync(sessions, roomSnapshot, maxWaitMs = 1000) {
  const deadline = Date.now() + maxWaitMs;
  const expectedVersion = Number(roomSnapshot.version);
  const expectedSlot = Number(roomSnapshot.currentTurnSlot);
  while (Date.now() < deadline) {
    const s0 = sessions[0]?.state;
    const s1 = sessions[1]?.state;
    if (!s0 || !s1) return;
    // After a terminal status, the engine sets state.status directly via the
    // GAME_COMPLETED handler; session.state.currentTurnSlot may not match.
    const terminal = roomSnapshot.status !== 'playing';
    if (terminal) {
      if (s0.status !== 'playing' && s1.status !== 'playing') return;
    } else if (s0.currentTurnSlot === expectedSlot && s1.currentTurnSlot === expectedSlot) {
      return;
    }
    await sleep(5);
  }
}

async function waitForCommitOrTerminal(env, roomId, versionBefore, statusBefore) {
  const deadline = Date.now() + COMMIT_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const room = await adminRead(env, `rooms/${roomId}`);
    if (!room) return null;
    if (Number(room.version) > versionBefore) return room;
    if (room.status !== statusBefore && isTerminal(room.status)) return room;
    await sleep(COMMIT_POLL_INTERVAL_MS);
  }
  return null;
}

async function readRoomFromCtx(db, roomId) {
  const snap = await db.ref(`rooms/${roomId}`).get();
  return snap?.val ? snap.val() : null;
}

function createBus(gameId = '', label = '') {
  const subs = new Map();
  const trace = !!process.env.SIM_DEBUG_BUS;
  return {
    on(type, fn) {
      let set = subs.get(type);
      if (!set) { set = new Set(); subs.set(type, set); }
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(type, payload) {
      if (trace) {
        console.log(`[bus ${gameId}/${label}] emit ${type}`, JSON.stringify(payload)?.slice(0, 160));
      }
      const set = subs.get(type);
      if (!set) return;
      for (const fn of set) {
        try { fn(payload); } catch (err) { console.error('[sim-bus]', type, err); }
      }
    },
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function flushMicrotasks() {
  return new Promise(r => setImmediate(r));
}
