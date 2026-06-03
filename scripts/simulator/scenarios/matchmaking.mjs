// matchmaking.mjs — Phase 2 scenario.
//
// Spins up N "players" who all join the matchmaking queue near-simultaneously
// and then concurrently call tryPair(). Verifies the topology guarantees that
// matchmakingService.tryPair is supposed to provide:
//
//   1. Each authed player ends up in AT MOST one room.
//   2. Each created room has TWO DISTINCT player UIDs.
//   3. No two rooms share a player.
//   4. The queue ends EMPTY (all entries either claimed or remain only if no
//      compatible partner existed — odd N leaves one unmatched, which is fine).
//
// Failures here would indicate a regression in the atomic claim transaction
// (described in matchmakingService.js line 95-109) — historically that area
// has had a real bug ("Matchmaking pair-claim race fix" entry in TASKS.md).

import { CMD } from '../../../src/events/commands.js';
import { joinQueue, tryPair } from '../../../src/game/online/matchmakingService.js';
import { createInitialState } from '../../../src/game/core/gameEngine.js';
import { buildRoomDoc } from '../../../src/game/online/schema.js';
import { makeUserDb, adminRead } from '../emulatorClient.mjs';

/**
 * Run one matchmaking-race batch. Returns { players, roomsCreated, crashes }.
 *
 * @param {Object} opts
 * @param {Object} opts.env             rules-unit-testing environment
 * @param {string} opts.runId
 * @param {string} opts.batchSeed
 * @param {number} opts.players         number of simultaneous searchers
 * @param {string} opts.mode            queue mode (e.g. 'random-live')
 * @param {Object} opts.crashCollector
 */
export async function runMatchmakingBatch({ env, runId, batchSeed, players: N = 10, mode: baseMode = 'random-live', crashCollector }) {
  // Each batch gets its OWN queue (sub-mode key) so concurrent batches don't
  // see each other's queue entries. Without this, batches running in parallel
  // (the realistic stress profile) cross-contaminate and tryPair picks
  // partners from sibling batches, then createRoomFromPair fails to look up
  // the partner in this batch's player list.
  const mode = `${baseMode}-${batchSeed}`;
  const players = Array.from({ length: N }, (_, i) => ({
    uid: `sim-mm-${runId}-${batchSeed}-${i}`,
    displayName: `BotMM${i}`,
    avatar: null,
    joinedAt: Date.now() + i,
    rating: 1000,
  }));
  const dbs = new Map(players.map(p => [p.uid, makeUserDb(env, p.uid)]));
  let crashes = 0;

  // ─── Phase 1: all players join the queue concurrently.
  await Promise.all(players.map(p => joinQueue(dbs.get(p.uid), {
    uid: p.uid,
    mode,
    profile: { displayName: p.displayName, avatar: p.avatar, rating: p.rating },
    settings: { timelimit: false },
    serverTimestamp: Date.now(),
  })).map(p => p.catch((err) => {
    crashCollector.report({
      class: 'mm-join-throw',
      gameId: `mm-${runId}-${batchSeed}`,
      detail: err.message, stack: err.stack,
    });
    crashes++;
  })));

  // Diagnostic: snapshot the queue after all joins to confirm population.
  if (process.env.SIM_DEBUG_MM) {
    const q = await adminRead(env, `matchmakingQueue/${mode}`);
    console.log(`[mm-${batchSeed}] queue after joinQueue:`, q ? Object.keys(q).length : 0, 'entries');
  }

  // Pre-warm each authed db's transaction cache for the queue path. Subtle:
  // .get() and .once('value') do NOT warm the .transaction() read cache —
  // only an ACTIVE .on('value') subscription does. In production the browser
  // tab subscribes for matchmaking-queue updates so this is implicit; in the
  // simulator we have to subscribe explicitly per-db, wait for the first
  // snapshot, then unsubscribe after tryPair runs.
  const queueSubs = players.map(p => {
    const ref = dbs.get(p.uid).ref(`matchmakingQueue/${mode}`);
    return { ref, handler: null };
  });
  await Promise.all(queueSubs.map(s => new Promise(resolve => {
    s.handler = () => resolve();
    s.ref.on('value', s.handler);
  })));

  // ─── Phase 2: all players call tryPair() concurrently.
  // Each pair-winner creates the room directly via authed write (same
  // pattern as gameRunner). Losers' transactions abort cleanly.
  const pairings = [];
  const createRoomFromPair = (myEntry) => async (myE, theirE) => {
    const roomId = `mm-room-${runId}-${batchSeed}-${myE.uid}-${theirE.uid}`;
    const roomPlayers = {
      0: pickPlayer(players, myE.uid),
      1: pickPlayer(players, theirE.uid),
    };
    const engineState = createInitialState({
      mode,
      tileBagSeed: `${batchSeed}/${roomId}`,
      players: roomPlayers,
      settings: { timelimit: false },
    });
    const doc = buildRoomDoc({
      roomId, mode, players: roomPlayers,
      settings: { timelimit: false },
      engineState,
      createdAt: Date.now(),
    });
    doc.missedTurns = { 0: 0, 1: 0 };
    doc.turnDeadlineMs = null;
    await dbs.get(myEntry.uid).ref(`rooms/${roomId}`).set(doc);
    pairings.push({ winner: myE.uid, partner: theirE.uid, roomId });
    return { room: doc, roomId };
  };

  // tryPair calls — concurrent for race coverage by default. SIM_MM_SERIAL=1
  // forces sequential runs to distinguish cold-cache failures from real races.
  const callTryPair = async (p) => {
    try {
      const r = await tryPair(dbs.get(p.uid), {
        uid: p.uid,
        mode,
        createRoomFromPair: createRoomFromPair(p),
      });
      return { uid: p.uid, ...r };
    } catch (err) {
      crashCollector.report({
        class: 'mm-trypair-throw',
        gameId: `mm-${runId}-${batchSeed}`,
        detail: err.message, stack: err.stack,
      });
      crashes++;
      return { uid: p.uid, matched: false, error: err.message };
    }
  };
  const pairResults = process.env.SIM_MM_SERIAL
    ? await (async () => { const r = []; for (const p of players) r.push(await callTryPair(p)); return r; })()
    : await Promise.all(players.map(callTryPair));
  if (process.env.SIM_DEBUG_MM) {
    const matched = pairResults.filter(r => r.matched).length;
    console.log(`[mm-${batchSeed}] tryPair: ${matched}/${pairResults.length} matched, errors=${pairResults.filter(r=>r.error).length}`);
  }

  // Detach the cache-warming subscriptions now that the race is done.
  for (const s of queueSubs) {
    try { s.ref.off('value', s.handler); } catch { /* swallow */ }
  }

  // ─── Phase 3: verify invariants.
  const violations = await collectViolations({
    env, players, pairings, mode,
  });
  for (const v of violations) {
    crashCollector.report({
      class: `mm-${v.class}`,
      gameId: `mm-${runId}-${batchSeed}`,
      detail: v.detail,
    });
    crashes++;
  }

  return { playersN: N, pairings: pairings.length, crashes };
}

function pickPlayer(players, uid) {
  const p = players.find(x => x.uid === uid);
  return { uid: p.uid, displayName: p.displayName, avatar: p.avatar, joinedAt: p.joinedAt };
}

async function collectViolations({ env, players, pairings, mode }) {
  const out = [];
  const inRoom = new Map(); // uid -> roomId

  // Each pairing must reference two distinct players and not double-book.
  for (const pair of pairings) {
    if (pair.winner === pair.partner) {
      out.push({ class: 'self-pair', detail: `pairing has same uid on both sides: ${pair.winner}` });
      continue;
    }
    for (const uid of [pair.winner, pair.partner]) {
      if (inRoom.has(uid) && inRoom.get(uid) !== pair.roomId) {
        out.push({
          class: 'double-booked-player',
          detail: `uid=${uid} is in rooms ${inRoom.get(uid)} AND ${pair.roomId}`,
        });
      }
      inRoom.set(uid, pair.roomId);
    }
  }

  // Spot-check: each room should exist on the server with the expected players.
  for (const pair of pairings) {
    const room = await adminRead(env, `rooms/${pair.roomId}`);
    if (!room) {
      out.push({ class: 'missing-room', detail: `pairing claims roomId=${pair.roomId} but room doc missing` });
      continue;
    }
    const p0 = room.players?.[0]?.uid ?? room.players?.['0']?.uid;
    const p1 = room.players?.[1]?.uid ?? room.players?.['1']?.uid;
    if (!p0 || !p1 || p0 === p1) {
      out.push({
        class: 'bad-room-players',
        detail: `room ${pair.roomId} has players [${p0}, ${p1}]`,
      });
    }
  }

  // Queue residue: anyone who paired should be out of the queue.
  const queue = await adminRead(env, `matchmakingQueue/${mode}`);
  const queueUids = queue ? Object.keys(queue) : [];
  for (const uid of inRoom.keys()) {
    if (queueUids.includes(uid)) {
      out.push({
        class: 'paired-but-still-queued',
        detail: `uid=${uid} is paired into a room but still has a queue entry`,
      });
    }
  }

  return out;
}
