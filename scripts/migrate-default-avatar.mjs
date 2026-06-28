// migrate-default-avatar.mjs — admin helper: move users still on the old default
// avatar ('crown', or no avatar set) to the new default store avatar.
//
// Why: the default avatar changed from the legacy 'crown' emoji to the neutral
// "anonymous player" store avatar (common_17). Existing accounts created with
// the old default keep showing the crown until their profile is updated.
//
// What it does:
//   • Reads /users and finds every profile whose equippedAvatar is 'crown' or
//     unset (null/empty) — i.e. anyone currently displaying the default.
//   • Sets users/{uid}/profile/equippedAvatar to common_17.
//   • Single atomic multi-path update (Admin SDK, bypasses security rules).
//
// By default only 'crown' is migrated. Pass --include-unset to also update
// accounts with no equippedAvatar (they render the crown via the UI fallback).
//
// Prerequisites (one-time):
//   npm i firebase-admin
//   A service-account key for the boost-8ef11 project, pointed at by
//   GOOGLE_APPLICATION_CREDENTIALS:
//     bash/zsh:    export GOOGLE_APPLICATION_CREDENTIALS="/abs/path/serviceAccount.json"
//     PowerShell:  $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\abs\path\serviceAccount.json"
//
// Usage:
//   node scripts/migrate-default-avatar.mjs --dry-run
//   node scripts/migrate-default-avatar.mjs --include-unset --dry-run
//   node scripts/migrate-default-avatar.mjs

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { DEFAULT_STORE_AVATAR_ID } from '../src/ui/screens/avatarStore.js';

const DATABASE_URL = 'https://boost-8ef11-default-rtdb.firebaseio.com';
const OLD_DEFAULT = 'crown';

function parseArgs(argv) {
  const o = { dryRun: false, includeUnset: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') o.dryRun = true;
    else if (argv[i] === '--include-unset') o.includeUnset = true;
  }
  return o;
}

async function main() {
  const opts = parseArgs(process.argv);

  // applicationDefault() reads the service-account key from GOOGLE_APPLICATION_CREDENTIALS.
  const app = initializeApp({ credential: applicationDefault(), databaseURL: DATABASE_URL });
  const db = getDatabase(app);

  const usersSnap = await db.ref('users').get();
  const users = usersSnap.val() || {};

  const updates = {};
  let crownCount = 0;
  let unsetCount = 0;
  for (const [uid, node] of Object.entries(users)) {
    if (!node?.profile) continue;
    const cur = node.profile.equippedAvatar;
    const isCrown = cur === OLD_DEFAULT;
    const isUnset = cur == null || cur === '';
    if (isCrown) crownCount++;
    else if (isUnset) unsetCount++;
    else continue;
    if (isUnset && !opts.includeUnset) continue;
    updates[`users/${uid}/profile/equippedAvatar`] = DEFAULT_STORE_AVATAR_ID;
  }

  console.log(`Users: ${Object.keys(users).length}`);
  console.log(`On 'crown': ${crownCount}`);
  console.log(`Unset avatar: ${unsetCount}${opts.includeUnset ? ' (included)' : ' (skipped — pass --include-unset)'}`);
  console.log(`Will set equippedAvatar='${DEFAULT_STORE_AVATAR_ID}' for ${Object.keys(updates).length} user(s).`);

  if (Object.keys(updates).length === 0) { console.log('Nothing to update.'); process.exit(0); }
  if (opts.dryRun) { console.log('\nDry run — no write performed.'); process.exit(0); }

  await db.ref().update(updates);
  console.log(`\nApplied: ${Object.keys(updates).length} profile(s) updated.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
