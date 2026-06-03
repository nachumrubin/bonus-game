// runSimulator.mjs
//
// CLI entry. Wraps the rest of the simulator: parses flags, loads the
// dictionary into the shared DICT set, boots the emulator harness, runs
// N games with bounded concurrency, writes a summary, and exits non-zero
// if any crashes were captured.
//
// Expected to be invoked via `npm run sim`, which wraps it in
// `firebase emulators:exec --only database`. The emulator host arrives as
// the FIREBASE_DATABASE_EMULATOR_HOST env var; emulatorClient.mjs refuses to
// run without it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRng, hashStringToU32 } from '../../src/util/rng.js';
import { addWordsFromText } from '../../src/game/core/hebrewDictionary.js';

import { bootEmulator, resetDatabase } from './emulatorClient.mjs';
import { runGame } from './gameRunner.mjs';
import { createCrashCollector } from './crashCollector.mjs';
import { runMatchmakingBatch } from './scenarios/matchmaking.mjs';
import { runWatchdogBatch } from './scenarios/watchdog.mjs';
import { runReconnectBatch } from './scenarios/reconnect.mjs';
import { runE2EBatch } from './scenarios/e2eFullStack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DICT_PATH = path.join(REPO_ROOT, 'data', 'dictionary.base.txt');
const OUT_DIR = path.join(REPO_ROOT, '.simulator-data');

function parseArgs(argv) {
  const opts = {
    scenario: 'normal',           // normal | matchmaking
    games: 5,
    concurrency: 3,
    seed: String(Date.now()),
    replay: null,
    mode: 'friend-live',
    bot: 'random',                // random | fuzz
    fuzzRate: 0.3,
    mmPlayers: 10,                // players per matchmaking batch
    mmBatches: 5,                 // matchmaking batches
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--scenario': opts.scenario = next(); break;
      case '--games': opts.games = Number(next()); break;
      case '--concurrency': opts.concurrency = Number(next()); break;
      case '--seed': opts.seed = next(); break;
      case '--replay': opts.replay = next(); break;
      case '--mode': opts.mode = next(); break;
      case '--bot': opts.bot = next(); break;
      case '--fuzz-rate': opts.fuzzRate = Number(next()); break;
      case '--mm-players': opts.mmPlayers = Number(next()); break;
      case '--mm-batches': opts.mmBatches = Number(next()); break;
      case '--verbose': case '-v': opts.verbose = true; break;
      case '--help': case '-h':
        printHelpAndExit();
    }
  }
  if (!Number.isFinite(opts.games) || opts.games <= 0) opts.games = 5;
  if (!Number.isFinite(opts.concurrency) || opts.concurrency <= 0) opts.concurrency = 3;
  if (!Number.isFinite(opts.fuzzRate) || opts.fuzzRate < 0) opts.fuzzRate = 0.3;
  if (!Number.isFinite(opts.mmPlayers) || opts.mmPlayers < 2) opts.mmPlayers = 10;
  if (!Number.isFinite(opts.mmBatches) || opts.mmBatches <= 0) opts.mmBatches = 5;
  if (!['normal', 'matchmaking', 'watchdog', 'reconnect', 'e2e'].includes(opts.scenario)) opts.scenario = 'normal';
  if (!['random', 'fuzz'].includes(opts.bot)) opts.bot = 'random';
  return opts;
}

function printHelpAndExit() {
  console.log(`Usage: npm run sim -- [options]

Scenarios:
  --scenario normal       (default) play N online games end-to-end
  --scenario matchmaking  stress matchmakingService.tryPair with concurrent queue joiners
  --scenario watchdog     exercise timeoutWatchdog (single-timeout, forfeit-after-two,
                          liveBonus gate, double-claim race) using injected clock
  --scenario reconnect    dispose + re-create sessions mid-game to stress version cursor,
                          echo cancellation, cache pre-warm on reconnect, and watcher teardown
  --scenario e2e          headless full-stack: two clients with real watchdog + presence +
                          disconnectController, real wall-clock timers; catches deadline-race
                          ghost moves and false-positive disconnect overlays

Common options:
  --seed STR          Seed for RNG (default: timestamp)
  --verbose, -v       Per-batch / per-game progress logs
  --help, -h          Show this help

Normal-scenario options:
  --games N           Number of games to run (default 5)
  --concurrency N     Max games running in parallel (default 3)
  --replay PATH       JSON file of recorded games to replay (skips random bot)
  --mode MODE         Room mode (default friend-live)
  --bot KIND          random | fuzz   (default random)
  --fuzz-rate F       Fraction of adversarial commands when --bot fuzz (default 0.3)

Matchmaking-scenario options:
  --mm-players N      Simultaneous queue joiners per batch (default 10)
  --mm-batches N      Number of batches to run (default 5)
  --mode MODE         Queue mode (default friend-live; use random-live for realism)

Watchdog-scenario options:
  --mm-batches N      Number of batches; each batch runs all 4 sub-scenarios (default 5)
`);
  process.exit(0);
}

function loadDictionary() {
  if (!fs.existsSync(DICT_PATH)) {
    throw new Error(`dictionary file not found: ${DICT_PATH}`);
  }
  const txt = fs.readFileSync(DICT_PATH, 'utf8');
  addWordsFromText(txt);
}

function loadReplay(filePath) {
  if (!filePath) return null;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
  if (!fs.existsSync(abs)) throw new Error(`replay file not found: ${abs}`);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(data)) throw new Error('replay file must be a JSON array of game records');
  return data;
}

// Bounded-concurrency Promise.all.
async function runWithConcurrency(tasks, limit) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const i = cursor++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${(hashStringToU32(opts.seed)).toString(16).slice(0, 6)}`;

  console.log('[sim] starting run', runId);
  console.log('[sim] options', { games: opts.games, concurrency: opts.concurrency, seed: opts.seed, replay: opts.replay, mode: opts.mode });

  loadDictionary();
  const replay = loadReplay(opts.replay);

  const env = await bootEmulator();
  await resetDatabase(env);
  const crashCollector = createCrashCollector({ runId, outDir: OUT_DIR, seed: opts.seed });

  // Process-level capture of unhandled rejections from session subscribers.
  const onRejection = (reason) => {
    crashCollector.report({
      class: 'unhandled-rejection',
      message: String(reason?.message ?? reason),
      stack: reason?.stack ?? null,
    });
  };
  process.on('unhandledRejection', onRejection);

  const tasks = [];
  if (opts.scenario === 'e2e') {
    for (let i = 0; i < opts.mmBatches; i++) {
      const batchSeed = `b${i}`;
      tasks.push(() => runE2EBatch({
        env, runId, batchSeed, makeRng: createRng, crashCollector,
      }).then((result) => {
        if (opts.verbose) {
          console.log(`[sim] e2e-batch ${batchSeed} scenarios=${result.scenarios} crashes=${result.crashes}`);
        }
        return { ...result, gameId: `e2e-${runId}-${batchSeed}` };
      }).catch((err) => {
        crashCollector.report({
          class: 'e2e-batch-throw',
          gameId: `e2e-${runId}-${batchSeed}`,
          message: err.message, stack: err.stack,
        });
        return { gameId: `e2e-${runId}-${batchSeed}`, crashes: 1 };
      }));
    }
  } else if (opts.scenario === 'reconnect') {
    for (let i = 0; i < opts.mmBatches; i++) {
      const batchSeed = `b${i}`;
      tasks.push(() => runReconnectBatch({
        env, runId, batchSeed, makeRng: createRng, crashCollector,
      }).then((result) => {
        if (opts.verbose) {
          console.log(`[sim] rc-batch ${batchSeed} scenarios=${result.scenarios} crashes=${result.crashes}`);
        }
        return { ...result, gameId: `rc-${runId}-${batchSeed}` };
      }).catch((err) => {
        crashCollector.report({
          class: 'rc-batch-throw',
          gameId: `rc-${runId}-${batchSeed}`,
          message: err.message, stack: err.stack,
        });
        return { gameId: `rc-${runId}-${batchSeed}`, crashes: 1 };
      }));
    }
  } else if (opts.scenario === 'watchdog') {
    for (let i = 0; i < opts.mmBatches; i++) {
      const batchSeed = `b${i}`;
      tasks.push(() => runWatchdogBatch({
        env, runId, batchSeed, crashCollector,
      }).then((result) => {
        if (opts.verbose) {
          console.log(`[sim] wd-batch ${batchSeed} scenarios=${result.scenarios} crashes=${result.crashes}`);
        }
        return { ...result, gameId: `wd-${runId}-${batchSeed}` };
      }).catch((err) => {
        crashCollector.report({
          class: 'wd-batch-throw',
          gameId: `wd-${runId}-${batchSeed}`,
          message: err.message, stack: err.stack,
        });
        return { gameId: `wd-${runId}-${batchSeed}`, crashes: 1 };
      }));
    }
  } else if (opts.scenario === 'matchmaking') {
    for (let i = 0; i < opts.mmBatches; i++) {
      const batchSeed = `b${i}`;
      tasks.push(() => runMatchmakingBatch({
        env,
        runId,
        batchSeed,
        players: opts.mmPlayers,
        mode: opts.mode,
        crashCollector,
      }).then((result) => {
        if (opts.verbose) {
          console.log(`[sim] mm-batch ${batchSeed} players=${result.playersN} pairings=${result.pairings} crashes=${result.crashes}`);
        }
        return { ...result, gameId: `mm-${runId}-${batchSeed}` };
      }).catch((err) => {
        crashCollector.report({
          class: 'mm-batch-throw',
          gameId: `mm-${runId}-${batchSeed}`,
          message: err.message,
          stack: err.stack,
        });
        return { gameId: `mm-${runId}-${batchSeed}`, crashes: 1 };
      }));
    }
  } else {
    for (let i = 0; i < opts.games; i++) {
      const gameSeed = `${opts.seed}/g${i}`;
      const gameId = `${runId}-${i}`;
      // Pass the full replay record (not just moveHistory) so gameRunner can
      // use the original tileBagSeed — otherwise rack reconstruction diverges
      // and every placement fails the placed-not-in-rack defense.
      const replayForGame = replay ? replay[i % replay.length] : null;
      tasks.push(() => runGame({
        env,
        gameId,
        gameSeed,
        makeRng: createRng,
        crashCollector,
        options: {
          mode: opts.mode,
          replay: replayForGame,
          bot: opts.bot,
          fuzzRate: opts.fuzzRate,
        },
      }).then((result) => {
        if (opts.verbose) {
          console.log(`[sim] game ${gameId} ${result.finalStatus} ticks=${result.ticks} crashes=${result.crashes}`);
        }
        return result;
      }).catch((err) => {
        crashCollector.report({
          class: 'runner-throw',
          gameId, gameSeed,
          message: err.message,
          stack: err.stack,
        });
        return { gameId, ticks: 0, finalStatus: 'crash', crashes: 1 };
      }));
    }
  }

  const results = await runWithConcurrency(tasks, opts.concurrency);

  process.off('unhandledRejection', onRejection);
  await env.cleanup();

  const summary = crashCollector.writeSummary({
    games: results.length,
    finalStatuses: tallyFinalStatuses(results),
    totalTicks: results.reduce((s, r) => s + (r?.ticks ?? 0), 0),
    options: opts,
  });

  const s = crashCollector.summary();
  console.log(`\n[sim] done. games=${results.length} totalCrashes=${s.totalCrashes} uniqueCrashes=${s.uniqueCrashes}`);
  console.log(`[sim] summary written to ${summary}`);
  if (s.totalCrashes > 0) {
    console.log('[sim] crash classes:');
    for (const [klass, count] of Object.entries(s.countsByClass)) {
      console.log(`  ${klass}: ${count}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

function tallyFinalStatuses(results) {
  const out = Object.create(null);
  for (const r of results) {
    const key = r?.finalStatus ?? 'unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

main().catch((err) => {
  console.error('[sim] fatal', err);
  process.exit(2);
});
