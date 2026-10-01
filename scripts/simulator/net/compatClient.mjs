// compatClient.mjs — one real Firebase client per simulated player.
//
// Unlike emulatorClient.makeUserDb (rules-unit-testing contexts with a fake
// auth token), this builds a full firebase compat app per agent — the same
// SDK the browser app loads — and signs in anonymously, exactly like a real
// player opening the app. Each agent therefore has:
//   - its own WebSocket connection (one RTDB connection per player — this is
//     what counts against the Spark plan's 100-connection limit)
//   - a real auth.uid evaluated by the deployed/emulated rules
//   - real onDisconnect / goOffline / goOnline behaviour
//
// Targets:
//   'emu'      local emulators (auth :9099, database :9000, ns demo-bonus-game)
//   'staging'  a separate Firebase project; config from
//              scripts/simulator/staging.config.json (gitignored)
//   'prod'     refused unless the caller passes the token minted by the soak
//              runner's explicit --confirm-prod gate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/database';
import { withLatency } from './latency.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STAGING_CONFIG_PATH = path.resolve(__dirname, '..', 'staging.config.json');
export const PROD_PROJECT_ID = 'boost-8ef11';

const EMU_DB_HOST = process.env.SIM_EMU_DB_HOST || '127.0.0.1:9000';
const EMU_AUTH_URL = process.env.SIM_EMU_AUTH_URL || 'http://127.0.0.1:9099';
// The emulator loads firebase.database.rules.json into the DEFAULT instance
// namespace, `<projectId>-default-rtdb`. Any other ns (e.g. bare
// 'demo-bonus-game') runs with NO rules — every write is allowed, which hid
// rule-denied races in the first soak runs. Keep this in sync with
// assertRulesEnforced() below.
const EMU_NS = process.env.SIM_EMU_NS || 'demo-bonus-game-default-rtdb';

// Opaque token: only runSoak's prod gate creates one.
const PROD_TOKEN = Symbol('soak-prod-confirmed');
export function _mintProdToken() { return PROD_TOKEN; }

let appCounter = 0;

export function emulatorConfig() {
  return {
    apiKey: 'demo-key',
    projectId: 'demo-bonus-game',
    databaseURL: `http://${EMU_DB_HOST}?ns=${EMU_NS}`,
  };
}

export function loadStagingConfig(file = STAGING_CONFIG_PATH) {
  if (!fs.existsSync(file)) {
    throw new Error(`staging config not found at ${file} — copy staging.config.example.json and fill in the staging project's web config`);
  }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!cfg.databaseURL || !cfg.apiKey || !cfg.projectId) {
    throw new Error('staging config must include apiKey, projectId and databaseURL');
  }
  if (cfg.projectId === PROD_PROJECT_ID || String(cfg.databaseURL).includes(PROD_PROJECT_ID)) {
    throw new Error('staging config points at the PRODUCTION project — refusing');
  }
  return cfg;
}

/**
 * Fail fast if the emulator namespace we talk to does not enforce the
 * security rules: an unauthenticated write to /admins must be denied.
 */
export async function assertRulesEnforced() {
  const url = `http://${EMU_DB_HOST}/admins/__soak_rules_probe.json?ns=${EMU_NS}`;
  const res = await fetch(url, { method: 'PUT', body: 'true' });
  if (res.ok) {
    await fetch(url, { method: 'DELETE' }).catch(() => {});
    throw new Error(`emulator namespace "${EMU_NS}" accepted an unauthenticated write to /admins — security rules are NOT loaded there. Soak results would be meaningless.`);
  }
  return true;
}

function isLocalHost(hostPort) {
  const host = String(hostPort).split(':')[0];
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * Create and sign in a real Firebase client.
 * @param {{ target?: 'emu'|'staging'|'prod', label?: string, prodToken?: symbol, prodConfig?: object, stagingConfig?: object }} opts
 */
export async function makeCompatUser({ target = 'emu', label = 'agent', prodToken = null, prodConfig = null, stagingConfig = null, network = null, rng = Math.random } = {}) {
  let cfg;
  if (target === 'emu') {
    if (!isLocalHost(EMU_DB_HOST)) throw new Error(`emulator host ${EMU_DB_HOST} is not localhost — refusing`);
    cfg = emulatorConfig();
  } else if (target === 'staging') {
    cfg = stagingConfig ?? loadStagingConfig();
  } else if (target === 'prod') {
    if (prodToken !== PROD_TOKEN) throw new Error('prod target requires the soak runner confirmation gate');
    if (!prodConfig?.databaseURL) throw new Error('prod target requires prodConfig');
    cfg = prodConfig;
  } else {
    throw new Error(`unknown target ${target}`);
  }

  const appName = `${label}-${++appCounter}-${Date.now().toString(36)}`;
  const app = firebase.initializeApp(cfg, appName);
  const auth = app.auth();
  const rawDb = app.database();
  if (target === 'emu') {
    auth.useEmulator(EMU_AUTH_URL, { disableWarnings: true });
    const [host, port] = EMU_DB_HOST.split(':');
    rawDb.useEmulator(host, Number(port));
  }
  // Optional mobile-network simulation (see latency.mjs). goOffline/goOnline
  // always act on the raw connection.
  const netStats = {};
  const db = network ? withLatency(rawDb, { profile: network, rng, stats: netStats }) : rawDb;

  const t0 = Date.now();
  const cred = await auth.signInAnonymously();
  const signInMs = Date.now() - t0;
  const uid = cred.user.uid;

  let disposed = false;
  return {
    app, auth, db, uid, target, signInMs, network, netStats,
    goOffline() { try { rawDb.goOffline(); } catch { /* swallow */ } },
    goOnline() { try { rawDb.goOnline(); } catch { /* swallow */ } },
    async deleteUser() {
      try { await auth.currentUser?.delete(); } catch { /* swallow */ }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      try { rawDb.goOffline(); } catch { /* swallow */ }
      try { await app.delete(); } catch { /* swallow */ }
    },
  };
}
