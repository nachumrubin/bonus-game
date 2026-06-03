// e2eFullStack.mjs — Phase 5 scenario.
//
// Headless full-stack E2E: two complete "client" instances per game running
// in one Node process, each with:
//   - onlineGameSession  (Firebase commits via real transactions)
//   - timeoutWatchdog    (real setInterval, real Date.now)
//   - presenceService    (real /presence/{uid} writes + heartbeat)
//   - disconnectController (watches opponent's presence, fires DISCONNECT_OPEN)
//
// This catches bug classes my engine+session-only loop cannot:
//
//   1. Last-second commit vs watchdog race (bug #1):
//      P1 dispatches CONFIRM_MOVE just before the turn deadline; P2's watchdog
//      is ticking. Race for the next version. If P1's commit loses, P1's
//      engine state has the move applied locally but the server doesn't —
//      `SYNC_REJECTED` fires but does not roll back. Detector: compare each
//      session's state.board / state.scores / state.currentTurnSlot against
//      the server room after every settled commit.
//
//   2. Phantom disconnect-overlay (bug #2):
//      P1's disconnectController fires DISCONNECT_OPEN for P2 even though
//      P2 is actively heartbeating. Detector: subscribe DISCONNECT_OPEN on
//      both buses; assert it never fires while the opponent's presence
//      writes are landing normally.
//
// All sessions/services share the local Firebase emulator. Real timers, real
// wall-clock interleaving. Each game takes real seconds (≥ botTime) because
// the watchdog needs the deadline to actually elapse — that's the whole point.

import { CMD } from '../../../src/events/commands.js';
import { EV } from '../../../src/events/eventTypes.js';
import { createInitialState } from '../../../src/game/core/gameEngine.js';
import { createOnlineGameSession } from '../../../src/game/sessions/onlineGameSession.js';
import { buildRoomDoc } from '../../../src/game/online/schema.js';
import { createTimeoutWatchdog } from '../../../src/game/online/timeoutWatchdog.js';
import { startPresence } from '../../../src/game/online/presenceService.js';
import { createDisconnectController } from '../../../src/ui/controllers/disconnectController.js';
import { DISCONNECT_OPEN, DISCONNECT_CLOSE } from '../../../src/ui/screens/disconnectScreen.js';
import { pickCommand as randomPick } from '../bots/randomBot.mjs';
import { adminRead, makeUserDb, withRulesDisabled } from '../emulatorClient.mjs';

const BOT_TIME_SECONDS = 4;   // short for fast iteration; >3 so deadlines actually matter
const LIMIT_MS = BOT_TIME_SECONDS * 1000;
const GRACE_MS = 500;          // watchdog grace
const SETTLE_MS = 1500;        // after each commit, time for both watchers to sync

export async function runE2EBatch({ env, runId, batchSeed, makeRng, crashCollector }) {
  const results = { scenarios: 0, crashes: 0 };
  for (const fn of [
    runDeadlineRace,
    runDeadlineRaceForcedLoss,
    runPresenceFalsePositive,
    runPresenceGraceCorrectness,
    runPresenceFlicker,
  ]) {
    try {
      const violations = await fn({ env, runId, batchSeed, makeRng });
      for (const v of violations) {
        crashCollector.report({
          class: `e2e-${v.class}`,
          gameId: `e2e-${runId}-${batchSeed}-${fn.name}`,
          detail: v.detail,
          ...(v.snapshot ? { roomSnapshot: v.snapshot } : {}),
        });
        results.crashes++;
      }
      results.scenarios++;
    } catch (err) {
      crashCollector.report({
        class: 'e2e-scenario-throw',
        gameId: `e2e-${runId}-${batchSeed}-${fn.name}`,
        detail: err.message, stack: err.stack,
      });
      results.crashes++;
    }
  }
  return results;
}

// ─── shared client setup ────────────────────────────────────────────────────

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
      for (const fn of set) { try { fn(payload); } catch { /* swallow */ } }
    },
  };
}

const PLAYERS_FOR = (suffix) => ({
  0: { uid: `sim-e2e-${suffix}-a`, displayName: 'A', joinedAt: 1 },
  1: { uid: `sim-e2e-${suffix}-b`, displayName: 'B', joinedAt: 2 },
});

async function seedRoom({ env, suffix, roomId, settings }) {
  const players = PLAYERS_FOR(suffix);
  const engineState = createInitialState({
    mode: 'random-live',
    tileBagSeed: `e2e-${suffix}`,
    players,
    settings,
  });
  const doc = buildRoomDoc({
    roomId, mode: 'random-live', players,
    settings,
    engineState,
    createdAt: Date.now(),
  });
  doc.status = 'playing';
  doc.currentTurnSlot = 0;
  doc.turnDeadlineMs = settings.timelimit ? (Date.now() + LIMIT_MS) : null;
  doc.missedTurns = { 0: 0, 1: 0 };
  await withRulesDisabled(env, async (db) => {
    await db.ref(`rooms/${roomId}`).set(doc);
  });
  return { players };
}

/**
 * Build a full "client" for one slot: db, bus, session, watchdog, presence,
 * disconnectController. Returns a { dispose, ... } object.
 *
 * `mountWatchdog` / `mountPresence` / `mountDisconnect` are opt-in so each
 * scenario controls which surfaces are active.
 */
async function makeClient({ env, players, mySlot, roomId, mountWatchdog, mountPresence, mountDisconnect, openEvents }) {
  const db = makeUserDb(env, players[mySlot].uid);
  const bus = createBus();

  // Auto-finalize bonus mini-games with extra=0 (good enough for E2E timing tests).
  bus.on(EV.MOVE_CONFIRMED, (payload) => {
    if (payload?.scoringDeferred) {
      queueMicrotask(() => {
        try { session.dispatch({ type: CMD.FINALIZE_BOOST_AWARD, payload: { slot: payload.slot, extra: 0 } }); }
        catch { /* swallow */ }
      });
    }
  });

  // Capture DISCONNECT_OPEN / DISCONNECT_CLOSE if scenario asked.
  if (openEvents) {
    bus.on(DISCONNECT_OPEN, (p) => openEvents.push({ kind: 'open', slot: mySlot, at: Date.now(), payload: p }));
    bus.on(DISCONNECT_CLOSE, (p) => openEvents.push({ kind: 'close', slot: mySlot, at: Date.now(), payload: p }));
  }

  const room = await adminRead(env, `rooms/${roomId}`);
  const session = await createOnlineGameSession({ bus, db, room, mySlot });
  session.start();
  await db.ref(`rooms/${roomId}`).once('value'); // cache pre-warm

  let watchdog = null;
  if (mountWatchdog) {
    watchdog = createTimeoutWatchdog({
      db, roomId, mySlot,
      limitMs: LIMIT_MS,
      graceMs: GRACE_MS,
      tickMs: 200,       // tighter than prod's 350 to catch races faster
      now: () => Date.now(),
    });
  }

  let presence = null;
  if (mountPresence) {
    presence = await startPresence(db, {
      uid: players[mySlot].uid,
      currentRoom: roomId,
      serverTimestamp: () => Date.now(),
      doc: null, // no document in Node — visibility tracking disabled
    });
  }

  let disconnectController = null;
  if (mountDisconnect) {
    disconnectController = createDisconnectController({
      bus,
      dbRef: () => db,
      sessionRef: () => session,
      graceMs: 3_000,    // shorter than prod's 30s so scenarios finish in seconds
      pollMs: 500,
    });
    // The controller subscribes to GAME_STARTED to resubscribe — emit it
    // explicitly so the controller picks up the opponent uid right away.
    bus.emit(EV.GAME_STARTED, { mode: 'random-live', players: room.players, currentTurnSlot: 0 });
  }

  async function dispose() {
    try { watchdog?.dispose(); } catch { /* swallow */ }
    try { disconnectController?.dispose(); } catch { /* swallow */ }
    try { await presence?.stop(); } catch { /* swallow */ }
    try { await session.dispose(); } catch { /* swallow */ }
  }

  return { db, bus, session, watchdog, presence, disconnectController, dispose };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── scenarios ──────────────────────────────────────────────────────────────

/**
 * Deadline-race: active player commits at the deadline boundary while the
 * opponent's watchdog is ticking. Detects "ghost move on loser" (session
 * state diverged from server after SYNC_REJECTED).
 */
async function runDeadlineRace({ env, runId, batchSeed, makeRng }) {
  const suffix = `${runId}-${batchSeed}-race`;
  const roomId = `e2e-${suffix}`;
  const rng = makeRng(`${suffix}/rng`);
  const violations = [];

  const { players } = await seedRoom({ env, suffix, roomId,
    settings: { timelimit: true, botTime: BOT_TIME_SECONDS },
  });
  // Mount watchdogs on BOTH (only the opponent of the active player will
  // legitimately claim, but both running matches production topology).
  const clientA = await makeClient({ env, players, mySlot: 0, roomId,
    mountWatchdog: true, mountPresence: false, mountDisconnect: false });
  const clientB = await makeClient({ env, players, mySlot: 1, roomId,
    mountWatchdog: true, mountPresence: false, mountDisconnect: false });

  try {
    // Run several deadline-race iterations per game.
    for (let iter = 0; iter < 5; iter++) {
      // Read room to know who's active.
      const beforeRoom = await adminRead(env, `rooms/${roomId}`);
      if (!beforeRoom || beforeRoom.status !== 'playing') break;
      const activeSlot = Number(beforeRoom.currentTurnSlot);
      const activeClient = activeSlot === 0 ? clientA : clientB;

      // Compress the deadline window: set turnDeadlineMs to `now + jitter`.
      // jitter ∈ [-150, +150] ms — straddles the watchdog grace boundary.
      const jitter = Math.floor((rng() - 0.5) * 300);
      const newDeadline = Date.now() + jitter;
      await withRulesDisabled(env, async (db) => {
        await db.ref(`rooms/${roomId}/turnDeadlineMs`).set(newDeadline);
      });
      await sleep(20); // let both clients' watchers see the new deadline

      // Active player attempts a legitimate move (random Hebrew word).
      const cmd = randomPick(activeClient.session.state, activeSlot, rng);
      let dispatched = false;
      if (cmd) {
        try { activeClient.session.dispatch(cmd); dispatched = true; }
        catch { /* engine threw — caught by outer invariants */ }
      }

      // Wait for the race to settle: both clients converge, watchdogs settle.
      await sleep(SETTLE_MS);

      // Compare each session's state against the authoritative server room.
      const afterRoom = await adminRead(env, `rooms/${roomId}`);
      const sA = clientA.session.state;
      const sB = clientB.session.state;

      const checks = [
        ['currentTurnSlot', Number(afterRoom?.currentTurnSlot), Number(sA.currentTurnSlot), Number(sB.currentTurnSlot)],
        ['turnNumber',      Number(afterRoom?.turnNumber),      Number(sA.turnNumber),      Number(sB.turnNumber)],
        ['scores[0]',       Number(afterRoom?.scores?.[0] ?? afterRoom?.scores?.['0'] ?? 0), Number(sA.scores?.[0] ?? 0), Number(sB.scores?.[0] ?? 0)],
        ['scores[1]',       Number(afterRoom?.scores?.[1] ?? afterRoom?.scores?.['1'] ?? 0), Number(sA.scores?.[1] ?? 0), Number(sB.scores?.[1] ?? 0)],
      ];
      for (const [field, server, sa, sb] of checks) {
        if (sa !== server) {
          violations.push({
            class: 'session-vs-server-divergence',
            detail: `iter=${iter} dispatched=${dispatched} slot=0 field=${field} server=${server} sessionA=${sa} jitter=${jitter}`,
          });
        }
        if (sb !== server) {
          violations.push({
            class: 'session-vs-server-divergence',
            detail: `iter=${iter} dispatched=${dispatched} slot=1 field=${field} server=${server} sessionB=${sb} jitter=${jitter}`,
          });
        }
      }

      // Board comparison — "ghost move" detector. Convert each side's board
      // to {pos: letter} and compare.
      const serverBoard = extractBoardLetters(afterRoom?.board);
      const aBoard = extractBoardLetters(serializeBoard(sA.board));
      const bBoard = extractBoardLetters(serializeBoard(sB.board));
      const ghostsA = diffBoards(aBoard, serverBoard);
      const ghostsB = diffBoards(bBoard, serverBoard);
      if (ghostsA.length) {
        violations.push({
          class: 'ghost-move-on-client-A',
          detail: `iter=${iter} ${ghostsA.length} cell(s): ${ghostsA.slice(0, 4).join('; ')}`,
        });
      }
      if (ghostsB.length) {
        violations.push({
          class: 'ghost-move-on-client-B',
          detail: `iter=${iter} ${ghostsB.length} cell(s): ${ghostsB.slice(0, 4).join('; ')}`,
        });
      }
      if (afterRoom?.status !== 'playing') break;
    }
  } finally {
    await clientA.dispose();
    await clientB.dispose();
  }
  return violations;
}

/**
 * Forced deadline loss: deterministically reproduce the scenario where the
 * active player attempts CONFIRM_MOVE AFTER the opponent's watchdog has
 * already claimed the turn. The bug we're hunting:
 *
 *   - Active player's engine optimistically applies the move (board, scores)
 *   - commitTransaction fails (version mismatch — watchdog already bumped)
 *   - SYNC_REJECTED fires, but onlineGameSession does NOT roll back state
 *   - Watcher resync handles scores/racks/etc but NOT state.board for
 *     non-placement room updates (watchdog claim has no `lastMove` of type
 *     'place')
 *   - Result: active player's screen shows tiles that the server doesn't have
 *
 * This sub-scenario forces the lose-race directly, no probabilistic jitter.
 */
async function runDeadlineRaceForcedLoss({ env, runId, batchSeed, makeRng }) {
  const suffix = `${runId}-${batchSeed}-forced`;
  const roomId = `e2e-${suffix}`;
  const rng = makeRng(`${suffix}/rng`);
  const violations = [];

  const { players } = await seedRoom({ env, suffix, roomId,
    settings: { timelimit: true, botTime: BOT_TIME_SECONDS },
  });
  // Only mount the OPPONENT's watchdog — gives us deterministic control over
  // which side wins. (Active player's watchdog wouldn't claim their own turn
  // anyway per the active-player guard.)
  const clientA = await makeClient({ env, players, mySlot: 0, roomId,
    mountWatchdog: false, mountPresence: false, mountDisconnect: false });
  const clientB = await makeClient({ env, players, mySlot: 1, roomId,
    mountWatchdog: true, mountPresence: false, mountDisconnect: false });

  try {
    // Force the room's deadline to "already expired" so B's watchdog will
    // claim on its next tick (200ms cadence). Wait long enough for the
    // claim to land.
    await withRulesDisabled(env, async (db) => {
      await db.ref(`rooms/${roomId}/turnDeadlineMs`).set(Date.now() - 5_000);
    });
    // B's watchdog should now claim within ~300ms (200ms tick + commit latency).
    await sleep(700);

    // Sanity: server state should now have currentTurnSlot=1 (B claimed).
    const afterClaim = await adminRead(env, `rooms/${roomId}`);
    if (Number(afterClaim?.currentTurnSlot) !== 1) {
      violations.push({
        class: 'forced-claim-failed-to-trigger',
        detail: `expected watchdog to claim; server currentTurnSlot=${afterClaim?.currentTurnSlot}`,
      });
      return violations;
    }

    // Wait for A's session.state to reflect the claim too (watchRoom callback
    // needs to fire on the client side).
    await sleep(300);

    // NOW have A attempt a CONFIRM_MOVE. A's session.state may still think
    // it's A's turn (depending on whether A's watcher has caught up). The
    // dispatch will be permitted by session.dispatch's defensive check IFF
    // session.state.currentTurnSlot === 0. If A's local state caught up,
    // the dispatch is silently blocked — to force the bug we override
    // A's local state to slot=0 right before dispatch.
    const aState = clientA.session.state;
    if (aState.currentTurnSlot !== 0) {
      // Force the lose-race conditions: pretend A's client hasn't yet seen
      // the watchdog's claim.
      aState.currentTurnSlot = 0;
    }

    const cmd = randomPick(aState, 0, rng);
    if (!cmd || cmd.type !== CMD.CONFIRM_MOVE) {
      // Bot couldn't find a placement on this rack — abort cleanly.
      return violations;
    }
    // Capture pre-dispatch board state for diff.
    const aBoardBefore = JSON.stringify(serializeBoard(aState.board));
    clientA.session.dispatch(cmd);

    // Let the failed commit + watcher resync settle.
    await sleep(SETTLE_MS);

    const finalServer = await adminRead(env, `rooms/${roomId}`);
    const serverBoard = extractBoardLetters(finalServer?.board);
    const aBoardAfter = extractBoardLetters(serializeBoard(aState.board));
    const bBoardAfter = extractBoardLetters(serializeBoard(clientB.session.state.board));

    const ghostsA = diffBoards(aBoardAfter, serverBoard);
    if (ghostsA.length > 0) {
      violations.push({
        class: 'forced-ghost-move-on-loser-A',
        detail: `A's session.state.board has ${ghostsA.length} cell(s) the server doesn't: ${ghostsA.slice(0, 6).join('; ')}`,
      });
    }
    // B's state should match server (B was passive throughout).
    const driftB = diffBoards(bBoardAfter, serverBoard);
    if (driftB.length > 0) {
      violations.push({
        class: 'forced-state-drift-on-passive-B',
        detail: `B's session.state.board diverges from server: ${driftB.slice(0, 4).join('; ')}`,
      });
    }
  } finally {
    await clientA.dispose();
    await clientB.dispose();
  }
  return violations;
}

/**
 * Presence false-positive: both clients heartbeat normally for longer than
 * the disconnect grace. Assert NO DISCONNECT_OPEN events fire on either bus.
 */
async function runPresenceFalsePositive({ env, runId, batchSeed }) {
  const suffix = `${runId}-${batchSeed}-presence-fp`;
  const roomId = `e2e-${suffix}`;
  const violations = [];

  const { players } = await seedRoom({ env, suffix, roomId,
    settings: { timelimit: false },
  });
  const events = [];
  const clientA = await makeClient({ env, players, mySlot: 0, roomId,
    mountWatchdog: false, mountPresence: true, mountDisconnect: true, openEvents: events });
  const clientB = await makeClient({ env, players, mySlot: 1, roomId,
    mountWatchdog: false, mountPresence: true, mountDisconnect: true, openEvents: events });

  try {
    // Run for ~ 5 seconds — well past the disconnectController graceMs=3000.
    // Both presences are heartbeating normally. No DISCONNECT_OPEN should
    // fire. If one does, that's a false positive (bug #2).
    await sleep(5_500);
    const opens = events.filter(e => e.kind === 'open');
    if (opens.length > 0) {
      violations.push({
        class: 'false-positive-disconnect',
        detail: `${opens.length} DISCONNECT_OPEN events fired while both clients were heartbeating: ${opens.map(o => 'slot' + o.slot + '@+' + Math.round((o.at - opens[0].at) / 1000) + 's').join(', ')}`,
      });
    }
  } finally {
    await clientA.dispose();
    await clientB.dispose();
  }
  return violations;
}

/**
 * Presence grace correctness: stop ONE client's presence, expect the OTHER
 * client's disconnectController to fire DISCONNECT_OPEN after graceMs (not
 * before). When the heartbeat resumes, DISCONNECT_CLOSE should fire.
 */
async function runPresenceGraceCorrectness({ env, runId, batchSeed }) {
  const suffix = `${runId}-${batchSeed}-presence-grace`;
  const roomId = `e2e-${suffix}`;
  const violations = [];

  const { players } = await seedRoom({ env, suffix, roomId,
    settings: { timelimit: false },
  });
  const events = [];
  const clientA = await makeClient({ env, players, mySlot: 0, roomId,
    mountWatchdog: false, mountPresence: true, mountDisconnect: true, openEvents: events });
  let clientB = await makeClient({ env, players, mySlot: 1, roomId,
    mountWatchdog: false, mountPresence: true, mountDisconnect: true, openEvents: events });

  try {
    // Let presence settle, no disconnect should fire yet.
    await sleep(500);
    const earlyOpens = events.filter(e => e.kind === 'open');
    if (earlyOpens.length) {
      violations.push({
        class: 'premature-disconnect',
        detail: `${earlyOpens.length} DISCONNECT_OPEN(s) fired in the first 500ms with both alive`,
      });
    }

    // Stop B's presence — B is "disconnected." A should see DISCONNECT_OPEN
    // after the grace (3s) but not before.
    const stopTime = Date.now();
    await clientB.presence?.stop();
    clientB.presence = null;

    // Wait long enough for grace to expire + some slack.
    await sleep(4_500);
    if (process.env.SIM_DEBUG_E2E) {
      console.log(`[e2e-grace] events after B-stop: ${JSON.stringify(events.map(e => ({k:e.kind, slot:e.slot, dt: e.at - stopTime})))}`);
    }
    const opensAfterStop = events.filter(e => e.kind === 'open' && e.slot === 0 && e.at >= stopTime);
    if (opensAfterStop.length === 0) {
      violations.push({
        class: 'missing-disconnect',
        detail: `A's disconnectController did NOT fire DISCONNECT_OPEN even though B's presence stopped >4s ago`,
      });
    } else {
      // It fired — verify timing was after grace, not immediately.
      const earliest = opensAfterStop[0].at;
      const delay = earliest - stopTime;
      if (delay < 2_500) { // graceMs=3000, allow 500ms slack for poll cadence
        violations.push({
          class: 'early-disconnect',
          detail: `A's DISCONNECT_OPEN fired ${delay}ms after stop — earlier than grace (3000ms)`,
        });
      }
    }
  } finally {
    await clientA.dispose();
    try { await clientB?.dispose(); } catch { /* may have been stopped */ }
  }
  return violations;
}

/**
 * Presence flicker — bug #2 hunting scenario.
 *
 * User-reported symptom: "Regular game, nothing special. Player 1 sees the
 * Player 2 disconnect-countdown overlay, while Player 2 is connected." P1's
 * disconnectController fires DISCONNECT_OPEN even though P2's session never
 * disconnected from its own perspective.
 *
 * Hypothesis: brief WebSocket blips between P2's client and Firebase cause
 * P2's `/presence/{uid}` to flicker — onDisconnect fires `connected:false`,
 * then the heartbeat catches up and writes `connected:true`. Each flicker
 * accumulates time into disconnectController's `totalDisconnectedMs` (which
 * intentionally persists across reconnect/disconnect cycles per the inline
 * comment). After enough flickers, accumulated time crosses graceMs and the
 * overlay fires — even though P2 has been "online from their own perspective"
 * the whole time.
 *
 * This scenario simulates the flickers directly via admin writes to
 * /presence/{B_uid}, while B's session continues normally. Detector:
 * any DISCONNECT_OPEN on A's bus = false positive.
 */
async function runPresenceFlicker({ env, runId, batchSeed }) {
  const suffix = `${runId}-${batchSeed}-flicker`;
  const roomId = `e2e-${suffix}`;
  const violations = [];

  const { players } = await seedRoom({ env, suffix, roomId,
    settings: { timelimit: false },
  });
  const events = [];
  const clientA = await makeClient({ env, players, mySlot: 0, roomId,
    mountWatchdog: false, mountPresence: true, mountDisconnect: true, openEvents: events });
  const clientB = await makeClient({ env, players, mySlot: 1, roomId,
    mountWatchdog: false, mountPresence: true, mountDisconnect: false, openEvents: events });

  try {
    // Let baseline presence + watchers settle.
    await sleep(500);

    // Simulate 8 brief WebSocket blips for B over ~6 seconds. Each blip:
    // 500ms with connected:false, then connected:true again. Done via
    // elevated writes (mimicking what Firebase's onDisconnect handler does
    // when the WebSocket drops). B's real presence heartbeat continues —
    // each blip is interleaved between heartbeats.
    const bUid = players[1].uid;
    const flickerStart = Date.now();
    for (let i = 0; i < 8; i++) {
      // Drop B
      await withRulesDisabled(env, async (db) => {
        await db.ref(`presence/${bUid}`).update({ connected: false, lastSeen: Date.now() });
      });
      await sleep(500);
      // Restore B
      await withRulesDisabled(env, async (db) => {
        await db.ref(`presence/${bUid}`).update({ connected: true, lastSeen: Date.now() });
      });
      await sleep(250);
    }
    // After flickers, let any pending disconnect detection settle.
    await sleep(500);

    const opens = events.filter(e => e.kind === 'open' && e.at >= flickerStart);
    if (opens.length > 0) {
      const totalOffline = opens.length * 500;
      violations.push({
        class: 'flicker-accumulates-to-disconnect',
        detail: `A's disconnectController fired DISCONNECT_OPEN ${opens.length}x during B's flicker pattern (${totalOffline}ms total brief offline across 8 blips); B's session never actually disconnected. totalDisconnectedMs accumulates without reset — likely bug #2 mechanism.`,
      });
    }
  } finally {
    await clientA.dispose();
    await clientB.dispose();
  }
  return violations;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function serializeBoard(board2d) {
  const flat = new Array(100).fill(null);
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const t = board2d[r]?.[c];
      if (t) flat[r * 10 + c] = { letter: t.letter };
    }
  }
  return flat;
}

function extractBoardLetters(board) {
  if (!board) return {};
  const out = {};
  if (Array.isArray(board)) {
    board.forEach((cell, i) => { if (cell?.letter) out[i] = cell.letter; });
  } else {
    for (const [k, v] of Object.entries(board)) {
      if (v?.letter) out[k] = v.letter;
    }
  }
  return out;
}

function diffBoards(a, b) {
  const diffs = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) diffs.push(`${k}: A=${a[k] ?? '∅'} server=${b[k] ?? '∅'}`);
  }
  return diffs;
}
