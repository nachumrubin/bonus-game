// emulatorClient.mjs
//
// Boots a connection to the local Firebase RTDB emulator and hands back authed
// db handles for the simulator's fake users. We deliberately reuse the same
// `@firebase/rules-unit-testing` package that powers `npm run test:emulator`
// so the simulator runs against the *real* rules — that's the whole point of
// emulator mode (catch rule rejections the mock would miss).
//
// Refuses to run if FIREBASE_DATABASE_EMULATOR_HOST is unset or points at
// anything other than localhost. The simulator must never accidentally hit a
// real Firebase project — there is no auth check inside this process that
// would stop a stray DEFAULT_FIREBASE_CONFIG from being used.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RULES_PATH = path.join(REPO_ROOT, 'firebase.database.rules.json');

// Match the project id passed to `firebase emulators:exec --project ...`.
// The emulator runs in singleProjectMode (see firebase.json); using a
// different id silently routes our writes to a separate namespace where the
// production rules are NOT applied, so authed transactions then fail
// permission_denied on the *bound* namespace.
const PROJECT_ID = 'demo-bonus-game';

function parseEmulatorHost() {
  const raw = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (!raw) {
    throw new Error(
      'FIREBASE_DATABASE_EMULATOR_HOST is not set. The simulator only runs '
      + 'against the local emulator. Use `npm run sim` which wraps the command '
      + 'in `firebase emulators:exec --only database`.'
    );
  }
  const [host, portRaw] = raw.split(':');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(
      `Refusing to run: FIREBASE_DATABASE_EMULATOR_HOST=${raw} is not localhost.`
    );
  }
  const port = Number(portRaw) || 9000;
  return { host, port };
}

/**
 * Boot a rules-unit-testing environment that talks to the running emulator.
 * The caller is responsible for tearing it down (call env.cleanup()).
 */
export async function bootEmulator() {
  const { host, port } = parseEmulatorHost();
  const rules = fs.readFileSync(RULES_PATH, 'utf8');
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: { rules, host, port },
  });
  return env;
}

/**
 * Make an authed db handle for a uid. Returns an object compatible with what
 * roomService / onlineGameSession expect (i.e. supports `.ref(path)`).
 */
export function makeUserDb(env, uid) {
  return env.authenticatedContext(uid).database();
}

/**
 * Run setup code with rules disabled. Used for createRoom() which writes to
 * BOTH players' /users/{uid}/activeRoom paths — production does that via
 * server-side logic, the simulator has to bypass the per-user rule check.
 */
export async function withRulesDisabled(env, fn) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.database());
  });
}

/**
 * Read a path with elevated privileges. Useful for invariant checks that need
 * to see the room state without being any specific player.
 */
export async function adminRead(env, dbPath) {
  let value = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await ctx.database().ref(dbPath).get();
    value = snap.exists() ? snap.val() : null;
  });
  return value;
}

/**
 * Wipe the entire database. Called once between full simulator runs so a
 * previous crashed run can't leak into a fresh one.
 */
export async function resetDatabase(env) {
  await env.clearDatabase();
}
