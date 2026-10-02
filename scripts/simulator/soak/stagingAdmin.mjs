// stagingAdmin.mjs — owner-level operations on the STAGING project, using the
// Firebase CLI's existing login (no service-account key needed):
//   - server-side RTDB metrics from Cloud Monitoring (database load %,
//     active connections, bytes sent) for a load-test time window
//   - wiping soak/load data out of the staging database
//
// Hard-refuses the production project. Usage:
//   node scripts/simulator/soak/stagingAdmin.mjs metrics --run <loadRunId>
//   node scripts/simulator/soak/stagingAdmin.mjs wipe --confirm-staging

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadStagingConfig, PROD_PROJECT_ID } from '../net/compatClient.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export const RTDB_METRICS = Object.freeze({
  databaseLoadPct: { type: 'firebasedatabase.googleapis.com/io/database_load', aligner: 'ALIGN_MEAN', reducer: 'REDUCE_MAX', scale: 100 },
  activeConnections: { type: 'firebasedatabase.googleapis.com/network/active_connections', aligner: 'ALIGN_MEAN', reducer: 'REDUCE_SUM' },
  sentBytes: { type: 'firebasedatabase.googleapis.com/network/sent_bytes_count', aligner: 'ALIGN_SUM', reducer: 'REDUCE_SUM' },
});

export function stagingProjectId() {
  const cfg = loadStagingConfig(); // already refuses prod
  if (cfg.projectId === PROD_PROJECT_ID) throw new Error('refusing to operate on production');
  return { projectId: cfg.projectId, databaseURL: cfg.databaseURL };
}

export async function getAdminToken() {
  const auth = require('firebase-tools/lib/auth');
  const acct = auth.getGlobalDefaultAccount();
  if (!acct?.tokens?.refresh_token) throw new Error('Firebase CLI is not logged in (npx firebase login)');
  const t = await auth.getAccessToken(acct.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  return t.access_token;
}

async function enableService(token, projectId, svc) {
  await fetch(`https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${svc}:enable`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
  });
}

/**
 * Per-minute server-side RTDB metrics between two times.
 * @returns {Promise<{ points: Array<{ t: string, databaseLoadPct?: number, activeConnections?: number, sentBytes?: number }>, note?: string }>}
 */
export async function fetchServerMetrics({ startMs, endMs }) {
  const { projectId } = stagingProjectId();
  const token = await getAdminToken();
  await enableService(token, projectId, 'monitoring.googleapis.com');
  const byMinute = new Map();
  const notes = [];
  for (const [name, m] of Object.entries(RTDB_METRICS)) {
    const q = new URLSearchParams({
      filter: `metric.type = "${m.type}"`,
      'interval.startTime': new Date(startMs).toISOString(),
      'interval.endTime': new Date(endMs).toISOString(),
      'aggregation.alignmentPeriod': '60s',
      'aggregation.perSeriesAligner': m.aligner,
      'aggregation.crossSeriesReducer': m.reducer,
    });
    const res = await fetch(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { notes.push(`${name}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`); continue; }
    const body = await res.json();
    for (const ts of body.timeSeries ?? []) {
      for (const p of ts.points ?? []) {
        const t = p.interval.endTime;
        const v = Number(p.value.doubleValue ?? p.value.int64Value ?? 0) * (m.scale ?? 1);
        const row = byMinute.get(t) ?? { t };
        row[name] = Math.round(v * 100) / 100;
        byMinute.set(t, row);
      }
    }
  }
  const points = [...byMinute.values()].sort((a, b) => a.t.localeCompare(b.t));
  return { points, note: notes.join('; ') || (points.length ? undefined : 'no points yet — Cloud Monitoring lags 3–5 min; re-run `stagingAdmin.mjs metrics --run <id>` later') };
}

/** Delete soak/load data from the staging database (owner token bypasses rules). */
export async function wipeStaging() {
  const { databaseURL, projectId } = stagingProjectId();
  if (databaseURL.includes(PROD_PROJECT_ID)) throw new Error('refusing to wipe production');
  const token = await getAdminToken();
  const paths = ['rooms', 'users', 'presence', 'invites', 'inviteAcks', 'pendingRooms', 'matchmakingQueue', 'asyncRooms', 'gameEvents', 'debugGameIndex', 'clientSnapshots', 'globalRatings', 'dictionarySuggestions'];
  for (const p of paths) {
    const res = await fetch(`${databaseURL}/${p}.json?access_token=${encodeURIComponent(token)}`, { method: 'DELETE' });
    console.log(`[wipe ${projectId}] /${p} → ${res.status}`);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
  if (cmd === 'wipe') {
    if (!rest.includes('--confirm-staging')) { console.error('add --confirm-staging to wipe the staging database'); process.exit(2); }
    await wipeStaging();
  } else if (cmd === 'metrics') {
    const runId = arg('--run');
    const file = path.join(REPO_ROOT, '.simulator-data', 'load', runId ?? '', 'report.json');
    if (!runId || !fs.existsSync(file)) { console.error('usage: stagingAdmin.mjs metrics --run <loadRunId>'); process.exit(2); }
    const rep = JSON.parse(fs.readFileSync(file, 'utf8'));
    const m = await fetchServerMetrics({ startMs: rep.startedAt, endMs: rep.endedAt + 60_000 });
    rep.serverMetrics = m;
    fs.writeFileSync(file, JSON.stringify(rep, null, 1));
    console.table(m.points);
    if (m.note) console.log(m.note);
  } else {
    console.error('usage: stagingAdmin.mjs metrics --run <id> | wipe --confirm-staging');
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
