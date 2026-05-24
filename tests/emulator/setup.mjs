// Emulator test harness — gives each test an authed Realtime Database client
// that runs against the LOCAL emulator with the production rules loaded.
//
// Why this exists: the spine's older mockFirebase.js ignores rules entirely,
// so tests pass even when the deployed rules would reject the same write.
// This harness fixes that gap. Tests using it catch cross-user writes,
// turn-check violations, missing rules, and version-mismatch bugs the way
// production would.
//
// Usage:
//   import { withTestEnv, makeUserApp, assertSucceeds, assertFails } from './setup.js';
//
//   await withTestEnv(async (env) => {
//     const alice = makeUserApp(env, 'alice');
//     await assertSucceeds(alice.ref('users/alice/lastSeen').set(Date.now()));
//   });
//
// All public helpers wrap `@firebase/rules-unit-testing` so callers don't
// have to know the SDK internals.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  assertSucceeds as rutAssertSucceeds,
  assertFails as rutAssertFails,
} from '@firebase/rules-unit-testing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RULES_PATH = path.join(REPO_ROOT, 'firebase.database.rules.json');

const PROJECT_ID = 'demo-bonus-game';
const EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const [EMU_HOST, EMU_PORT_RAW] = EMULATOR_HOST.split(':');
const EMU_PORT = Number(EMU_PORT_RAW) || 9000;

/**
 * Run a function with a fresh test environment. The environment is torn down
 * afterwards even on error. Rules are loaded from the current
 * firebase.database.rules.json so the tests track the file we'll deploy.
 *
 * @param {(env: import('@firebase/rules-unit-testing').RulesTestEnvironment) => Promise<void>} fn
 */
export async function withTestEnv(fn) {
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: EMU_HOST,
      port: EMU_PORT,
    },
  });
  try {
    // Each test starts with a clean DB so state doesn't leak.
    await env.clearDatabase();
    await fn(env);
  } finally {
    await env.cleanup();
  }
}

/**
 * Build an authed app for a specific user. The returned object exposes the
 * same `.database()` surface the production code uses.
 *
 * @param {import('@firebase/rules-unit-testing').RulesTestEnvironment} env
 * @param {string} uid
 */
export function makeUserApp(env, uid) {
  const ctx = env.authenticatedContext(uid);
  return {
    uid,
    db: ctx.database(),
    ref(path) { return ctx.database().ref(path); },
  };
}

/**
 * Build an unauthenticated app — used for negative tests that confirm
 * unauthed writes are denied.
 *
 * @param {import('@firebase/rules-unit-testing').RulesTestEnvironment} env
 */
export function makeAnonymousUserApp(env, uid) {
  const ctx = env.authenticatedContext(uid, {
    firebase: { sign_in_provider: 'anonymous' },
  });
  return {
    uid,
    db: ctx.database(),
    ref(path) { return ctx.database().ref(path); },
  };
}

export function makeAnonApp(env) {
  const ctx = env.unauthenticatedContext();
  return {
    uid: null,
    db: ctx.database(),
    ref(path) { return ctx.database().ref(path); },
  };
}

/**
 * Seed the database WITHOUT rule checks. Useful for "set up a room I then
 * try to write" patterns where seeding through normal rules is awkward.
 *
 * @param {import('@firebase/rules-unit-testing').RulesTestEnvironment} env
 * @param {(db: any) => Promise<void>} fn
 */
export async function seedWithoutRules(env, fn) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.database());
  });
}

// Re-export the SDK's assertions so callers have one place to import from.
export const assertSucceeds = rutAssertSucceeds;
export const assertFails = rutAssertFails;

/**
 * Convenience helper: read a path under elevated privileges (no rule check).
 * Returns the value or null. Useful for confirming a write actually landed.
 */
export async function adminRead(env, path) {
  let value = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await ctx.database().ref(path).get();
    value = snap.exists() ? snap.val() : null;
  });
  return value;
}
