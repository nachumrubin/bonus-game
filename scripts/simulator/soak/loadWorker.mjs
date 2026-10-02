// loadWorker.mjs — one worker process of the staging load test.
//
// Forked by loadTest.mjs. Holds a target number of concurrent live games
// (each = two real agents = two Firebase connections) and streams
// measurements back over IPC:
//   { type: 'samples', list }        tx / write / visible samples (batched)
//   { type: 'gameStarted' }
//   { type: 'game', summary }        compact per-game result
//   { type: 'status', active, connections }
// Commands from the coordinator: { cmd: 'target', n } | { cmd: 'stop' }.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';

import { addWordsFromText, isValid } from '../../../src/game/core/hebrewDictionary.js';
import { setBotWordsFromText, createBotWordList, BOT_WORDS } from '../../../src/game/sessions/botVocabulary.js';
import { startServerClock, stopServerClock } from '../../../src/game/online/serverClock.js';
import { loadStagingConfig } from '../net/compatClient.mjs';
import { createFailureCollector } from '../oracle/failureCollector.mjs';
import { runAgentGame } from './runAgentGame.mjs';
import { countEarlyCommitLost } from './loadStats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const cfg = JSON.parse(process.env.LOAD_WORKER_CONFIG || '{}');
const { workerIndex = 0, runId = 'load', seed = 'load', botTimes = [20, 40, 60], modes = ['friend-live', 'random-live'], chaos = 0.3, miniGameTimeScale = 1 } = cfg;

addWordsFromText(fs.readFileSync(path.join(REPO_ROOT, 'data', 'dictionary.txt'), 'utf8'));
setBotWordsFromText(fs.readFileSync(path.join(REPO_ROOT, 'data', 'bot-words.txt'), 'utf8'));
const wordList = createBotWordList({ sourceWords: BOT_WORDS, maxWordLen: 6, cap: 40_000, isWordValid: (w) => isValid(w) });

const stagingConfig = loadStagingConfig();
const observerApp = firebase.initializeApp(stagingConfig, `load-observer-w${workerIndex}`);
const observerDb = observerApp.database();
startServerClock({ db: observerDb });
const failures = createFailureCollector({ outDir: path.join(REPO_ROOT, '.simulator-data'), runId: `${runId}/w${workerIndex}` });

let target = 0;
let stopping = false;
let gameCounter = 0;
const running = new Map(); // gameIndex -> AbortController
let scheduled = 0;         // starts queued by the stagger but not yet begun
// Back off after games that could not even start (e.g. past the Spark
// connection cap) so we measure the cap instead of hammering it.
let setupFailStreak = 0;
let cooldownUntil = 0;
let pending = [];

const sink = (s) => { pending.push(s); };
setInterval(() => {
  if (pending.length) { process.send?.({ type: 'samples', list: pending }); pending = []; }
  process.send?.({ type: 'status', active: running.size, connections: running.size * 2 + 1 });
}, 1000).unref();

function startGame() {
  scheduled = Math.max(0, scheduled - 1);
  if (stopping || running.size >= target) return;
  const gameIndex = workerIndex * 100_000 + gameCounter++;
  const ac = new AbortController();
  running.set(gameIndex, ac);
  process.send?.({ type: 'gameStarted' });
  runAgentGame({
    runId: `${runId}-w${workerIndex}`, gameIndex, seed, target: 'staging', observerDb,
    wordList, isWordValid: isValid, failures,
    modes, strategies: ['invite', 'code'], chaos, miniGameTimeScale, botTimes, untimedShare: 0,
    network: 'off', signal: ac.signal,
    clientOpts: { metrics: sink, stagingConfig },
    agentOpts: { onSample: sink },
  }).then((r) => {
    if (!r.roomId && !r.aborted) {
      setupFailStreak++;
      cooldownUntil = Date.now() + Math.min(60_000, 2000 * 2 ** Math.min(setupFailStreak, 5));
    } else if (r.roomId) {
      setupFailStreak = 0;
    }
    const classes = (r.violations ?? []).map(v => v.class);
    process.send?.({ type: 'game', summary: {
      gameId: r.gameId, roomId: r.roomId, status: r.status, ok: r.ok, aborted: !!r.aborted,
      durationMs: r.durationMs, turns: r.turns,
      setupFailed: !r.roomId,
      violationClasses: classes,
      firstViolation: r.violations?.[0] ? `${r.violations[0].class}: ${String(r.violations[0].detail).slice(0, 200)}` : null,
      earlyCommitLost: Object.values(r.stats ?? {}).reduce((n, s) => n + countEarlyCommitLost(s.deadline), 0),
    } });
  }).catch((err) => {
    process.send?.({ type: 'game', summary: { setupFailed: true, violationClasses: ['worker-error'], firstViolation: String(err?.message ?? err) } });
  }).finally(() => {
    running.delete(gameIndex);
    reconcile();
  });
}

function reconcile() {
  if (stopping) return;
  // Stagger starts a little so a step doesn't hit auth/db in one burst.
  const wait = Math.max(0, cooldownUntil - Date.now());
  let n = 0;
  while (running.size + scheduled < target) {
    scheduled++;
    setTimeout(startGame, wait + n * 400);
    n++;
  }
  if (running.size > target) {
    const extra = [...running.entries()].slice(0, running.size - target);
    for (const [, ac] of extra) ac.abort();
  }
}

process.on('message', async (msg) => {
  if (msg?.cmd === 'target') {
    target = Math.max(0, Number(msg.n) || 0);
    reconcile();
  } else if (msg?.cmd === 'stop') {
    stopping = true;
    for (const ac of running.values()) ac.abort();
    const t0 = Date.now();
    while (running.size && Date.now() - t0 < 60_000) await new Promise(r => setTimeout(r, 250));
    if (pending.length) process.send?.({ type: 'samples', list: pending });
    stopServerClock();
    try { await observerApp.delete(); } catch { /* swallow */ }
    process.send?.({ type: 'stopped', failures: failures.summary() });
    setTimeout(() => process.exit(0), 200);
  }
});

process.send?.({ type: 'ready', workerIndex });
