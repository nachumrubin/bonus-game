// runSoak.mjs — play many real live online games between independent agents
// and report every bug the oracle catches.
//
//   npm run soak -- --games 50 --parallel 4
//   npm run soak -- --duration 30m --parallel 6 --chaos 0.5
//
// `npm run soak` wraps this in `firebase emulators:exec --only auth,database`
// (see launchSoak.mjs). Run directly with --target staging to play against
// a separate Firebase project (scripts/simulator/staging.config.json).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';

import { hashStringToU32 } from '../../../src/util/rng.js';
import { addWordsFromText, isValid } from '../../../src/game/core/hebrewDictionary.js';
import { setBotWordsFromText, createBotWordList, BOT_WORDS } from '../../../src/game/sessions/botVocabulary.js';
import { startServerClock, stopServerClock } from '../../../src/game/online/serverClock.js';
import { emulatorConfig, loadStagingConfig, assertRulesEnforced } from '../net/compatClient.mjs';
import { createFailureCollector } from '../oracle/failureCollector.mjs';
import { PERSONA_IDS } from '../agents/personas.mjs';
import { offsetBucket } from '../agents/timing.mjs';
import { runAgentGame, BOT_TIMES } from './runAgentGame.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT_DIR = path.join(REPO_ROOT, '.simulator-data');

const ALL_MODES = ['friend-live', 'random-live', 'friend-async', 'random-async'];
const ALL_STRATEGIES = ['invite', 'code'];

export function parseArgs(argv) {
  const o = {
    games: 10, durationMs: 0, parallel: 4, seed: String(Date.now()), chaos: 0.3,
    modes: ['friend-live', 'random-live'], strategies: ALL_STRATEGIES, personas: PERSONA_IDS,
    target: 'emu', stopOnFirst: false, miniGameTimeScale: 1, botTimes: BOT_TIMES, untimedShare: 0.15,
    network: 'mixed', verbose: false,
  };
  const list = (s) => String(s).split(',').map(x => x.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--games': o.games = Number(next()); break;
      case '--duration': o.durationMs = parseDuration(next()); break;
      case '--parallel': o.parallel = Number(next()); break;
      case '--seed': o.seed = next(); break;
      case '--chaos': o.chaos = Number(next()); break;
      case '--modes': o.modes = list(next()).filter(m => ALL_MODES.includes(m)); break;
      case '--strategies': o.strategies = list(next()).filter(s => ALL_STRATEGIES.includes(s)); break;
      case '--personas': o.personas = list(next()).filter(p => PERSONA_IDS.includes(p)); break;
      case '--bot-times': o.botTimes = list(next()).map(Number).filter(n => n >= 5); break;
      case '--untimed-share': o.untimedShare = Number(next()); break;
      case '--minigame-time-scale': o.miniGameTimeScale = Number(next()); break;
      case '--target': o.target = next(); break;
      case '--network': o.network = next(); break;
      case '--stop-on-first': o.stopOnFirst = true; break;
      case '--verbose': case '-v': o.verbose = true; break;
      case '--help': case '-h': printHelp(); process.exit(0);
      default:
    }
  }
  if (!o.modes.length) o.modes = ['friend-live'];
  if (!o.strategies.length) o.strategies = ALL_STRATEGIES;
  if (!o.personas.length) o.personas = PERSONA_IDS;
  if (!o.botTimes.length) o.botTimes = BOT_TIMES;
  if (!Number.isFinite(o.parallel) || o.parallel < 1) o.parallel = 1;
  if (!['emu', 'staging'].includes(o.target)) {
    throw new Error(`--target ${o.target} not supported here (emu | staging; prod mode is a separate, gated entry point)`);
  }
  return o;
}

export function parseDuration(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h)?$/.exec(String(s).trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return n * ({ s: 1000, m: 60_000, h: 3_600_000 }[m[2] ?? 'm']);
}

function printHelp() {
  console.log(`Usage: npm run soak -- [options]

  --games N               games to play (default 10; ignored with --duration)
  --duration 30m          keep starting games until this much time has passed
  --parallel P            games running at once (default 4)
  --seed STR              RNG seed (default: timestamp)
  --chaos 0..1            disruptive-behaviour dial (default 0.3)
  --modes a,b             friend-live,random-live,friend-async,random-async
  --strategies a,b        invite,code
  --personas a,b          ${PERSONA_IDS.join(',')}
  --bot-times 20,40,60    turn speeds to rotate (default the real presets)
  --untimed-share F       share of live games with no timer (default 0.15)
  --minigame-time-scale F compress mini-game play time (default 1 = real)
  --network P             mixed|off|wifi|4g|poor — simulated phone latency per
                          player (default mixed: 45% wifi, 40% 4g, 15% poor)
  --target emu|staging    (default emu)
  --stop-on-first         stop starting new games after the first failure
  -v, --verbose           per-game lines
`);
}

function loadWords() {
  addWordsFromText(fs.readFileSync(path.join(REPO_ROOT, 'data', 'dictionary.txt'), 'utf8'));
  setBotWordsFromText(fs.readFileSync(path.join(REPO_ROOT, 'data', 'bot-words.txt'), 'utf8'));
  return createBotWordList({ sourceWords: BOT_WORDS, maxWordLen: 6, cap: 40_000, isWordValid: (w) => isValid(w) });
}

function makeObserver(target) {
  const cfg = target === 'emu' ? emulatorConfig() : loadStagingConfig();
  const app = firebase.initializeApp(cfg, `soak-observer-${Date.now()}`);
  const db = app.database();
  if (target === 'emu') {
    const [host, port] = (process.env.SIM_EMU_DB_HOST || '127.0.0.1:9000').split(':');
    db.useEmulator(host, Number(port));
  }
  return { app, db };
}

// ── aggregation ──────────────────────────────────────────────────────────
export function aggregate(results) {
  const agg = {
    games: results.length, ok: 0, failed: 0, statuses: {}, matrix: {},
    durationsMs: [], turns: [], commands: {}, rejects: {}, syncRejected: 0, replans: 0,
    previews: 0, previewWrites: 0, lookups: 0, lookupsValid: 0,
    reactionsSent: 0, reactionsBlocked: 0, reactionsReceived: 0, reactionErrors: 0,
    minigame: {}, wheel: {}, awards: 0, vetoes: 0, liveBonusWrites: 0,
    deadlineBuckets: {}, deadlineOutcomes: {}, phases: {},
  };
  const add = (m, k, n = 1) => { m[k] = (m[k] ?? 0) + n; };
  for (const r of results) {
    if (r.ok) agg.ok++; else agg.failed++;
    add(agg.statuses, r.status ?? 'unknown');
    add(agg.matrix, `${r.strategy} × ${r.mode} × ${r.settings?.timelimit ? `${r.settings.botTime}s` : 'untimed'}`);
    agg.durationsMs.push(r.durationMs);
    agg.turns.push(r.turns ?? 0);
    for (const s of Object.values(r.stats ?? {})) {
      for (const [k, v] of Object.entries(s.commandsByKind ?? {})) add(agg.commands, k, v);
      for (const [k, v] of Object.entries(s.rejects ?? {})) add(agg.rejects, k, v);
      for (const f of ['syncRejected', 'replans', 'previews', 'previewWrites', 'lookups', 'lookupsValid', 'reactionsSent', 'reactionsBlocked', 'reactionsReceived', 'reactionErrors', 'liveBonusWrites']) agg[f] += s[f] ?? 0;
      for (const [k, v] of Object.entries(s.bonus?.minigame ?? {})) add(agg.minigame, k, v);
      for (const [k, v] of Object.entries(s.bonus?.wheel ?? {})) add(agg.wheel, k, v);
      agg.awards += s.bonus?.award ?? 0;
      agg.vetoes += s.bonus?.vetoed ?? 0;
      for (const d of s.deadline ?? []) {
        add(agg.phases, d.phase);
        if (d.phase === 'deadline' || d.phase === 'walkAway') {
          const b = d.phase === 'walkAway' ? 'walkAway' : offsetBucket(d.actualOffset ?? d.plannedOffset);
          add(agg.deadlineBuckets, b);
          add(agg.deadlineOutcomes, `${b} → ${d.outcome}`);
        }
      }
    }
  }
  return agg;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

export function renderMarkdown({ runId, opts, agg, failures, wallMs }) {
  const L = [];
  const fmtMs = (ms) => `${(ms / 1000).toFixed(0)}s`;
  L.push(`# Soak run ${runId}`, '');
  L.push(`Target **${opts.target}** · ${agg.games} games · ${opts.parallel} parallel · chaos ${opts.chaos} · wall ${fmtMs(wallMs)}`, '');
  L.push(`**${agg.ok} clean, ${agg.failed} with violations, ${failures.length} unique failure signatures**`, '');
  L.push('## Failures', '');
  if (!failures.length) L.push('None.', '');
  else {
    L.push('| Signature | Games | Count | Example | Bundle |', '|---|---|---|---|---|');
    for (const f of failures) L.push(`| ${f.signature} | ${f.games} | ${f.count} | ${String(f.example).replace(/\|/g, '\\|').slice(0, 140)} | ${f.bundles[0] ? path.relative(REPO_ROOT, f.bundles[0]) : '—'} |`);
    L.push('');
  }
  L.push('## Games', '');
  L.push(`Statuses: ${Object.entries(agg.statuses).map(([k, v]) => `${k} ${v}`).join(', ')}`, '');
  L.push(`Duration p50 ${fmtMs(pct(agg.durationsMs, 0.5))}, p95 ${fmtMs(pct(agg.durationsMs, 0.95))} · turns p50 ${pct(agg.turns, 0.5)}, p95 ${pct(agg.turns, 0.95)}`, '');
  L.push('| Setup | Games |', '|---|---|', ...Object.entries(agg.matrix).sort().map(([k, v]) => `| ${k} | ${v} |`), '');
  L.push('## Deadline races', '');
  L.push('Commit offset relative to the turn deadline (server clock), for turns aimed at the deadline band:', '');
  L.push('| Offset | Turns |', '|---|---|', ...Object.entries(agg.deadlineBuckets).sort().map(([k, v]) => `| ${k} | ${v} |`), '');
  L.push('| Offset → outcome | Turns |', '|---|---|', ...Object.entries(agg.deadlineOutcomes).sort().map(([k, v]) => `| ${k} | ${v} |`), '');
  L.push(`Turn phases: ${Object.entries(agg.phases).map(([k, v]) => `${k} ${v}`).join(', ')}`, '');
  L.push('## Player behaviour coverage', '');
  L.push(`Actions: ${Object.entries(agg.commands).sort().map(([k, v]) => `${k} ${v}`).join(', ')}`, '');
  L.push(`Rejections: ${Object.entries(agg.rejects).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} · replans ${agg.replans} · sync-rejected ${agg.syncRejected}`, '');
  L.push(`Drag previews ${agg.previews} (${agg.previewWrites} livePreview writes) · dictionary lookups ${agg.lookups} (${agg.lookupsValid} valid)`, '');
  L.push(`Reactions sent ${agg.reactionsSent}, blocked by cooldown ${agg.reactionsBlocked}, received ${agg.reactionsReceived}, errors ${agg.reactionErrors}`, '');
  L.push(`Mini-games: ${Object.entries(agg.minigame).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`, '');
  L.push(`Wheel: ${Object.entries(agg.wheel).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} · award cards ${agg.awards} · vetoes ${agg.vetoes} · liveBonus writes ${agg.liveBonusWrites}`, '');
  const unexercised = [
    ['exchange', agg.commands.exchange], ['freeSwap', agg.commands.freeSwap], ['lockOnly', agg.commands.lockOnly],
    ['illegal word', agg.commands.illegal], ['resign', agg.commands.resign], ['stall claim', agg.commands.stallClaim],
    ['mini-game', Object.keys(agg.minigame).length], ['wheel', Object.keys(agg.wheel).length], ['award card', agg.awards],
    ['deadline race', Object.keys(agg.deadlineBuckets).length],
  ].filter(([, v]) => !v).map(([k]) => k);
  L.push('', `Not exercised this run: ${unexercised.join(', ') || 'nothing — full coverage'}`, '');
  return L.join('\n');
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${hashStringToU32(opts.seed).toString(16).slice(0, 6)}`;
  const outDir = path.join(OUT_DIR, 'soak', runId);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`[soak] run ${runId} target=${opts.target} games=${opts.durationMs ? `${opts.durationMs / 60000}min` : opts.games} parallel=${opts.parallel} chaos=${opts.chaos}`);

  if (opts.target === 'emu') {
    await assertRulesEnforced();
    console.log('[soak] emulator enforces firebase.database.rules.json ✓');
  }
  const wordList = loadWords();
  console.log(`[soak] dictionary loaded; bot vocabulary ${wordList.length} words`);
  const observer = makeObserver(opts.target);
  startServerClock({ db: observer.db });
  const failures = createFailureCollector({ outDir: OUT_DIR, runId });

  const results = [];
  const t0 = Date.now();
  let started = 0;
  let stop = false;
  const unhandled = (reason) => {
    console.error('[soak] unhandled rejection', reason);
    failures.report({ gameId: 'process' }, [{ class: 'unhandled-rejection', detail: String(reason?.message ?? reason), stack: reason?.stack ?? null }], () => ({}));
  };
  process.on('unhandledRejection', unhandled);
  process.on('SIGINT', () => { console.log('\n[soak] SIGINT — finishing games in flight, no new games'); stop = true; });

  const more = () => !stop && (opts.durationMs ? Date.now() - t0 < opts.durationMs : started < opts.games);
  const progress = setInterval(() => {
    const failed = results.filter(r => !r.ok).length;
    console.log(`[soak] ${results.length} done (${failed} failed, ${failures.uniqueCount} signatures), ${started - results.length} in flight, ${Math.round((Date.now() - t0) / 1000)}s`);
  }, 30_000);

  async function worker() {
    while (more()) {
      const gameIndex = started++;
      const r = await runAgentGame({
        runId, gameIndex, seed: opts.seed, target: opts.target, observerDb: observer.db,
        wordList, isWordValid: isValid, failures,
        modes: opts.modes, strategies: opts.strategies, chaos: opts.chaos, personas: opts.personas,
        miniGameTimeScale: opts.miniGameTimeScale, botTimes: opts.botTimes, untimedShare: opts.untimedShare,
        network: opts.network,
      });
      results.push(r);
      const line = `[soak] g${gameIndex} ${r.ok ? 'OK  ' : 'FAIL'} ${r.status} ${r.strategy}/${r.mode}/${r.settings?.timelimit ? r.settings.botTime + 's' : 'untimed'} ${r.personas?.A ?? '?'}×${r.personas?.B ?? '?'} net=${r.networks?.A ?? '-'}/${r.networks?.B ?? '-'} turns=${r.turns} ${Math.round(r.durationMs / 1000)}s${r.ok ? '' : ' → ' + r.violations.map(v => v.class).join(', ')}`;
      if (opts.verbose || !r.ok) console.log(line);
      if (!r.ok && opts.stopOnFirst) stop = true;
    }
  }
  await Promise.all(Array.from({ length: opts.parallel }, (_, i) => sleep(i * 1500).then(worker)));
  clearInterval(progress);
  process.off('unhandledRejection', unhandled);

  const wallMs = Date.now() - t0;
  const agg = aggregate(results);
  const failureList = failures.summary();
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ runId, opts, wallMs, agg, failures: failureList, games: results.map(r => ({ ...r, stats: undefined })) }, null, 1));
  const md = renderMarkdown({ runId, opts, agg, failures: failureList, wallMs });
  fs.writeFileSync(path.join(outDir, 'summary.md'), md);
  console.log('\n' + md);
  console.log(`[soak] report: ${path.relative(REPO_ROOT, path.join(outDir, 'summary.md'))}`);

  stopServerClock();
  try { await observer.app.delete(); } catch { /* swallow */ }
  process.exit(agg.failed > 0 ? 1 : 0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error('[soak] fatal', err); process.exit(2); });
}
