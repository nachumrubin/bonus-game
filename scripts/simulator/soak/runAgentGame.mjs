// runAgentGame.mjs — one complete live game between two independent agents.
//
//   1. two real Firebase clients sign in anonymously (compatClient)
//   2. they meet through a real flow (invite / room code)
//   3. both run the coin-screen ready handshake and mount a full headless
//      client (gameAgent); each plays on its own clock
//   4. a passive observer judges the game (gameOracle)
//   5. on any violation, a repro bundle is written (failureCollector)

import { createRng } from '../../../src/util/rng.js';
import { readRoom, turnLimitMsFromSettings } from '../../../src/game/online/roomService.js';
import { serverNow } from '../../../src/game/online/serverClock.js';
import { makeCompatUser } from '../net/compatClient.mjs';
import { createGameAgent } from '../agents/gameAgent.mjs';
import { pickPersona, withChaos } from '../agents/personas.mjs';
import { STRATEGIES } from '../agents/roomStrategies.mjs';
import { createGameOracle } from '../oracle/gameOracle.mjs';
import { pickNetworkProfile } from '../net/latency.mjs';

export const BOT_TIMES = [20, 40, 60]; // בזק / רגיל / איטי

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

export function pickGameSetup(rng, { modes, strategies, untimedShare = 0.15, botTimes = BOT_TIMES }) {
  const mode = pick(rng, modes);
  const isAsync = mode.endsWith('-async');
  const timelimit = !isAsync && rng() >= untimedShare;
  const botTime = pick(rng, botTimes);
  return {
    mode,
    strategy: pick(rng, strategies),
    settings: timelimit ? { timelimit: true, botTime } : { timelimit: false, botTime },
  };
}

/**
 * @returns {Promise<object>} game result summary
 */
export async function runAgentGame({
  runId, gameIndex, seed, target, observerDb, wordList, isWordValid, failures,
  modes, strategies, chaos = 0.3, personas, miniGameTimeScale = 1, allow = {},
  clientOpts = {}, roomIdFn = null, botTimes = BOT_TIMES, untimedShare = 0.15, onProgress = null,
  network = 'mixed',
}) {
  const gameSeed = `${seed}/g${gameIndex}`;
  const rng = createRng(gameSeed);
  const setup = pickGameSetup(rng, { modes, strategies, untimedShare, botTimes });
  const gameId = `${runId}-g${gameIndex}`;
  const tag = `SoakBot-${runId.slice(-6)}`;
  const t0 = Date.now();
  const result = {
    gameId, gameSeed, ...setup, roomId: null, status: null, ok: false,
    violations: [], durationMs: 0, turns: 0, commits: 0, personas: {}, stats: {}, networks: {},
  };
  const netFor = (i) => {
    if (!network || network === 'off') return null;
    return network === 'mixed' ? pickNetworkProfile(createRng(`${gameSeed}/net${i}`)) : network;
  };
  result.networks = { A: netFor(0), B: netFor(1) };

  const clients = [];
  const agents = [];
  let oracle = null;
  try {
    const [ca, cb] = await Promise.all([
      makeCompatUser({ target, label: `${tag}-g${gameIndex}-A`, network: result.networks.A, rng: createRng(`${gameSeed}/lat0`), ...clientOpts }),
      makeCompatUser({ target, label: `${tag}-g${gameIndex}-B`, network: result.networks.B, rng: createRng(`${gameSeed}/lat1`), ...clientOpts }),
    ]);
    clients.push(ca, cb);
    const profiles = [
      { displayName: `${tag}-A`, avatar: null },
      { displayName: `${tag}-B`, avatar: null },
    ];

    const { roomId } = await STRATEGIES[setup.strategy]({
      host: { db: ca.db, uid: ca.uid, profile: profiles[0] },
      guest: { db: cb.db, uid: cb.uid, profile: profiles[1] },
      mode: setup.mode, settings: setup.settings,
      ...(roomIdFn ? { roomIdFn } : {}),
    });
    result.roomId = roomId;
    onProgress?.({ gameId, phase: 'room', roomId });

    const room = await readRoom(ca.db, roomId);
    if (!room) throw Object.assign(new Error('room not readable after creation'), { violationClass: 'room-missing-after-create' });

    for (const [i, client] of [ca, cb].entries()) {
      const persona = withChaos(pickPersona(rng, personas), chaos);
      result.personas[i === 0 ? 'A' : 'B'] = persona.id;
      agents.push(createGameAgent({
        name: i === 0 ? 'A' : 'B', client, persona,
        rng: createRng(`${gameSeed}/${i}`), wordList, isWordValid,
        opts: { miniGameTimeScale, allow },
      }));
    }

    oracle = createGameOracle({
      observerDb, roomId, agents, isWordValid, now: serverNow,
      turnLimitMs: setup.settings.timelimit ? turnLimitMsFromSettings(setup.settings) : 0,
    });

    const slotOf = (uid) => (room.players?.[0]?.uid === uid ? 0 : room.players?.[1]?.uid === uid ? 1 : null);
    await Promise.all(agents.map((a, i) => a.join(room, slotOf(clients[i].uid))));

    const end = await oracle.waitForEnd();
    // Let both clients observe the terminal state (GAME_COMPLETED + status write).
    await Promise.race([Promise.all(agents.map(a => a.done)), sleep(15_000)]);
    const { violations, counters, finalRoom } = await oracle.finalize();
    result.violations = violations;
    result.status = finalRoom?.status ?? end?.status ?? 'unknown';
    result.commits = counters.commits;
    result.agreeChecks = counters.agreeChecks;
    result.turns = Number(finalRoom?.turnNumber ?? 0);
    result.finalScores = finalRoom?.scores ?? null;
    result.moves = Array.isArray(finalRoom?.moveHistory) ? finalRoom.moveHistory.length : Object.keys(finalRoom?.moveHistory ?? {}).length;
  } catch (err) {
    result.violations.push({ class: err.violationClass ?? 'game-setup-or-runtime-error', detail: String(err?.message ?? err), stack: err?.stack ?? null, at: Date.now() });
    result.status = result.status ?? 'error';
  } finally {
    result.durationMs = Date.now() - t0;
    for (const a of agents) result.stats[a.name] = a.stats;
    if (result.violations.length && failures) {
      failures.report(result, result.violations, () => buildBundle({ result, agents, oracle, setup, gameSeed, runId }));
    }
    oracle?.stop();
    await Promise.all(agents.map(a => a.dispose().catch(() => {})));
    if (target !== 'emu') await Promise.all(clients.map(c => c.deleteUser()));
    await Promise.all(clients.map(c => c.dispose()));
    result.ok = result.violations.length === 0;
  }
  return result;
}

function buildBundle({ result, agents, oracle, setup, gameSeed, runId }) {
  const finalRoom = oracle?.latest ?? null;
  return {
    runId, gameId: result.gameId, gameSeed, roomId: result.roomId, setup,
    personas: result.personas, networks: result.networks, status: result.status, durationMs: result.durationMs,
    violations: result.violations,
    finalRoom,
    roomSnapshots: (oracle?.snapshots ?? []).map(s => ({ t: s.t, room: s.room })),
    agents: Object.fromEntries(agents.map(a => [a.name, {
      uid: a.uid, mySlot: a.mySlot, persona: a.persona?.id,
      stats: a.stats, chosenExtras: a.chosenExtras, events: a.bus.log,
    }])),
    // exportProdHistories format → `npm run sim -- --replay <file>` replays it.
    replayRecord: finalRoom ? {
      originalRoomId: result.roomId,
      mode: finalRoom.mode, settings: finalRoom.settings, tileBagSeed: finalRoom.tileBagSeed,
      moveHistory: finalRoom.moveHistory ?? [],
      expectedFinal: { scores: finalRoom.scores, status: finalRoom.status },
    } : null,
    inspect: result.roomId ? `node scripts/debug-game.mjs --emu ${result.roomId}` : null,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
