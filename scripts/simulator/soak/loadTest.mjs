// loadTest.mjs — staging server-load test: ramp concurrent live games and
// measure what players experience, step by step, until something breaks.
//
//   npm run load -- --confirm-staging --max-games 60 --step-games 6 --step-minutes 4
//
// Each game is two full soak agents (two real Firebase connections) playing
// with real timers and the full human write mix (previews, reactions,
// liveBonus progress, presence heartbeats, transactions). Games are spread
// over forked worker processes so this machine is not the bottleneck.
//
// Per ramp step: commit (transaction) latency p50/p95/p99, opponent-visible
// latency, error rate by Firebase code, games that failed to start,
// correctness violations (desync, stuck turn, …), and lost last-second commits
// that were sent comfortably before the deadline. The ramp stops at the first
// step that breaks an SLO (unless --no-stop). Spark plan: 100 simultaneous
// connections ≈ 49 games (+1 observer per worker) — expect the cap there.
//
// STAGING ONLY. Refuses to run without --confirm-staging, and the staging
// config itself refuses the production project.

import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadStagingConfig } from '../net/compatClient.mjs';
import {
  DEFAULT_SLO, createStep, addSample, addGame, summarizeStep, sloBreaches, targetAt, splitTarget,
} from './loadStats.mjs';
import { fetchServerMetrics } from './stagingAdmin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SPARK_CONNECTION_CAP = 100;

export function parseLoadArgs(argv) {
  const o = {
    confirm: false, startGames: 4, stepGames: 6, stepMinutes: 4, maxGames: 60, workers: 0,
    botTimes: [20, 40, 60], chaos: 0.3, seed: String(Date.now()), miniGameTimeScale: 1,
    stopOnSlo: true, slo: { ...DEFAULT_SLO },
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--confirm-staging': o.confirm = true; break;
      case '--start-games': o.startGames = Number(next()); break;
      case '--step-games': o.stepGames = Number(next()); break;
      case '--step-minutes': o.stepMinutes = Number(next()); break;
      case '--max-games': o.maxGames = Number(next()); break;
      case '--workers': o.workers = Number(next()); break;
      case '--bot-times': o.botTimes = next().split(',').map(Number).filter(n => n >= 5); break;
      case '--chaos': o.chaos = Number(next()); break;
      case '--seed': o.seed = next(); break;
      case '--minigame-time-scale': o.miniGameTimeScale = Number(next()); break;
      case '--no-stop': o.stopOnSlo = false; break;
      case '--slo-tx-p95': o.slo.txP95Ms = Number(next()); break;
      case '--slo-visible-p95': o.slo.visibleP95Ms = Number(next()); break;
      case '--slo-error-rate': o.slo.errorRate = Number(next()); break;
      default:
    }
  }
  if (!o.workers) o.workers = Math.max(1, Math.min(os.cpus().length - 1, Math.ceil(o.maxGames / 8)));
  return o;
}

export function renderLoadReport(rep) {
  const L = [];
  const ms = (v) => (v == null ? '—' : `${v}`);
  L.push(`# Load test ${rep.runId}`, '');
  L.push(`Staging project **${rep.projectId}** · ${rep.opts.workers} worker processes · ramp ${rep.opts.startGames} → ${rep.opts.maxGames} games (+${rep.opts.stepGames} every ${rep.opts.stepMinutes} min) · turn speeds ${rep.opts.botTimes.join('/')} s`, '');
  L.push(`**Result:** ${rep.breakingPoint ? `first SLO breach at step ${rep.breakingPoint.step} (~${rep.breakingPoint.targetGames} concurrent games, ~${rep.breakingPoint.connections} connections): ${rep.breakingPoint.breaches.join('; ')}` : `no SLO breached up to ${rep.peak.games} concurrent games (${rep.peak.connections} connections)`}.`, '');
  L.push(`Peak: ${rep.peak.games} concurrent games, ${rep.peak.connections} simultaneous connections (Spark cap ${SPARK_CONNECTION_CAP}).`, '');
  L.push('## Per step', '');
  L.push('| Step | Target games | Active (avg) | Conns (avg) | Commits | Commits/s | Commit p50 / p95 / p99 ms | Opp-visible p50 / p95 ms | Error rate | Setup fails | Lost early commits | Violations | SLO |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of rep.steps) {
    const v = Object.entries(s.violations).map(([k, n]) => `${k}×${n}`).join(', ') || '—';
    L.push(`| ${s.index} | ${s.targetGames} | ${s.activeGamesAvg} | ${s.connectionsAvg} | ${s.txCount} | ${ms(s.txPerSec)} | ${ms(s.txP50)} / ${ms(s.txP95)} / ${ms(s.txP99)} | ${ms(s.visibleP50)} / ${ms(s.visibleP95)} | ${(s.errorRate * 100).toFixed(2)}% | ${s.setupFailed}/${s.gamesStarted} | ${s.earlyCommitLost} | ${v} | ${s.breaches.length ? (s.warmup ? '(warm-up) ' : '✗ ') + s.breaches.join('; ') : '✓'} |`);
  }
  L.push('');
  const codes = {};
  for (const s of rep.steps) for (const [k, n] of Object.entries(s.errorsByCode)) codes[k] = (codes[k] ?? 0) + n;
  L.push('## Errors by code', '', Object.keys(codes).length ? Object.entries(codes).map(([k, n]) => `- \`${k}\`: ${n}`).join('\n') : 'None.', '');
  L.push('## Games', '', `Finished ${rep.games.finished} (clean ${rep.games.clean}, with violations ${rep.games.withViolations}, setup failures ${rep.games.setupFailed}, stopped at ramp end ${rep.games.aborted}).`, '');
  if (rep.games.examples.length) L.push('Examples:', ...rep.games.examples.map(e => `- ${e}`), '');
  L.push('## Server side (Cloud Monitoring)', '');
  if (rep.serverMetrics?.points?.length) {
    L.push('| Minute (UTC) | DB load % | Active connections | Bytes sent |', '|---|---|---|---|');
    for (const p of rep.serverMetrics.points) L.push(`| ${p.t.slice(11, 16)} | ${p.databaseLoadPct ?? '—'} | ${p.activeConnections ?? '—'} | ${p.sentBytes ?? '—'} |`);
    const bytes = rep.serverMetrics.points.reduce((s, p) => s + (p.sentBytes ?? 0), 0);
    const gameMinutes = rep.steps.reduce((s, st) => s + st.activeGamesAvg * ((st.durationS ?? 0) / 60), 0);
    if (bytes && gameMinutes) {
      const perGameMin = bytes / gameMinutes;
      L.push('', `≈ ${(perGameMin / 1024).toFixed(1)} KB downloaded per game-minute → a 15-minute game ≈ ${(perGameMin * 15 / 1024 / 1024).toFixed(2)} MB. Spark's 10 GB/month ≈ ${Math.floor((10 * 1024 ** 3) / (perGameMin * 15)).toLocaleString()} such games per month.`);
    }
  } else {
    L.push(rep.serverMetrics?.note ?? 'Not fetched.', '', `Fetch later: \`node scripts/simulator/soak/stagingAdmin.mjs metrics --run ${rep.runId}\``);
  }
  L.push('');
  return L.join('\n');
}

async function main() {
  const opts = parseLoadArgs(process.argv.slice(2));
  if (!opts.confirm) {
    console.error('This drives real traffic at the STAGING Firebase project. Re-run with --confirm-staging.');
    process.exit(2);
  }
  const { projectId } = loadStagingConfig(); // throws if missing or production
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-load`;
  const outDir = path.join(REPO_ROOT, '.simulator-data', 'load', runId);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`[load] ${runId} → ${projectId}: ${opts.startGames}→${opts.maxGames} games, +${opts.stepGames}/${opts.stepMinutes}min, ${opts.workers} workers`);

  const workers = [];
  const status = new Map(); // workerIndex -> { active, connections }
  const steps = [];
  let current = null;
  const gamesAll = { finished: 0, clean: 0, withViolations: 0, setupFailed: 0, aborted: 0, examples: [] };
  let workerFailures = [];

  for (let i = 0; i < opts.workers; i++) {
    const child = fork(path.join(__dirname, 'loadWorker.mjs'), [], {
      env: { ...process.env, LOAD_WORKER_CONFIG: JSON.stringify({ workerIndex: i, runId, seed: `${opts.seed}/w${i}`, botTimes: opts.botTimes, chaos: opts.chaos, miniGameTimeScale: opts.miniGameTimeScale }) },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const w = { i, child, ready: false, stopped: false };
    child.on('message', (m) => {
      if (m.type === 'ready') w.ready = true;
      else if (m.type === 'samples' && current) for (const s of m.list) addSample(current, s);
      else if (m.type === 'gameStarted' && current) current.gamesStarted++;
      else if (m.type === 'status') status.set(i, { active: m.active, connections: m.connections });
      else if (m.type === 'game') {
        const g = m.summary;
        if (g.aborted) { gamesAll.aborted++; return; }
        gamesAll.finished++;
        if (g.setupFailed) gamesAll.setupFailed++;
        else if (g.violationClasses?.length) gamesAll.withViolations++;
        else gamesAll.clean++;
        if (g.firstViolation && gamesAll.examples.length < 12) gamesAll.examples.push(`${g.gameId ?? '?'} ${g.roomId ?? ''}: ${g.firstViolation}`);
        if (current) addGame(current, g);
      } else if (m.type === 'stopped') { w.stopped = true; workerFailures = workerFailures.concat(m.failures ?? []); }
    });
    child.on('exit', (code) => { w.stopped = true; if (code) console.error(`[load] worker ${i} exited with ${code}`); });
    workers.push(w);
  }
  const t0wait = Date.now();
  while (!workers.every(w => w.ready) && Date.now() - t0wait < 120_000) await sleep(250);
  if (!workers.every(w => w.ready)) throw new Error('workers failed to start');

  const startedAt = Date.now();
  const stepMs = opts.stepMinutes * 60_000;
  let breakingPoint = null;
  let peak = { games: 0, connections: 0 };
  let stop = false;
  process.on('SIGINT', () => { console.log('\n[load] SIGINT — ending after this tick'); stop = true; });

  const closeStep = () => {
    if (!current) return;
    current.endedAt = Date.now();
    const sum = summarizeStep(current);
    sum.breaches = sloBreaches(sum, opts.slo);
    // Step 0 is warm-up (sign-ins, first connections, room setup all at once):
    // reported, but it never stops the ramp.
    sum.warmup = sum.index === 0;
    steps.push(sum);
    console.log(`[load] step ${sum.index} target=${sum.targetGames} active≈${sum.activeGamesAvg} conns≈${sum.connectionsAvg} commit p95=${sum.txP95}ms visible p95=${sum.visibleP95}ms err=${(sum.errorRate * 100).toFixed(2)}% setupFail=${sum.setupFailed}/${sum.gamesStarted} ${sum.breaches.length ? '✗ ' + sum.breaches.join('; ') : '✓'}`);
    if (sum.breaches.length && !breakingPoint && !sum.warmup) {
      breakingPoint = { step: sum.index, targetGames: sum.targetGames, connections: sum.connectionsAvg, breaches: sum.breaches };
      if (opts.stopOnSlo) stop = true;
    }
  };

  while (!stop) {
    const elapsed = Date.now() - startedAt;
    const { step, target } = targetAt(elapsed, { startGames: opts.startGames, stepGames: opts.stepGames, stepMs, maxGames: opts.maxGames });
    const atMaxDone = target >= opts.maxGames && current && current.targetGames >= opts.maxGames && Date.now() - current.startedAt >= stepMs;
    if (atMaxDone) break;
    if (!current || step !== current.index) {
      closeStep();
      if (stop) break;
      current = createStep(step, target, Date.now());
      splitTarget(target, workers.length).forEach((n, i) => workers[i].child.send({ cmd: 'target', n }));
    }
    const active = [...status.values()].reduce((s, x) => s + x.active, 0);
    const connections = [...status.values()].reduce((s, x) => s + x.connections, 0);
    current.activeGamesSamples.push(active);
    current.connectionsSamples.push(connections);
    if (active > peak.games) peak.games = active;
    if (connections > peak.connections) peak.connections = connections;
    await sleep(1000);
  }
  closeStep();
  const endedAt = Date.now();

  console.log('[load] stopping workers…');
  for (const w of workers) { try { w.child.send({ cmd: 'stop' }); } catch { /* exited */ } }
  const t0 = Date.now();
  while (!workers.every(w => w.stopped) && Date.now() - t0 < 90_000) await sleep(250);
  for (const w of workers) if (!w.stopped) w.child.kill();

  const rep = { runId, projectId, opts, startedAt, endedAt, steps, breakingPoint, peak, games: gamesAll, workerFailures, serverMetrics: null };
  try {
    console.log('[load] fetching server-side metrics (Cloud Monitoring)…');
    rep.serverMetrics = await fetchServerMetrics({ startMs: startedAt, endMs: endedAt + 60_000 });
  } catch (e) {
    rep.serverMetrics = { points: [], note: `could not fetch: ${String(e?.message ?? e).slice(0, 200)}` };
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(rep, null, 1));
  const md = renderLoadReport(rep);
  fs.writeFileSync(path.join(outDir, 'report.md'), md);
  console.log('\n' + md);
  console.log(`[load] report: ${path.relative(REPO_ROOT, path.join(outDir, 'report.md'))}`);
  process.exit(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error('[load] fatal', err); process.exit(2); });
}
