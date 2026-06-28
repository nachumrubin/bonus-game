// refresh-friend-avatars.mjs — admin helper: rewrite every friend-list edge's
// cached avatar from the friend's current profile `equippedAvatar`.
//
// Why: `friends/{ownerUid}/{friendUid}` stores a *snapshot* of the friend's
// avatar taken when the friendship was created. It goes stale when the friend
// later equips a new (e.g. v2 store) avatar, and a friend's /users profile is
// not readable by other clients — so the app heals edges only as each user
// comes online. This script force-heals all of them in one pass.
//
// What it does:
//   • Reads /users to build a uid -> equippedAvatar map.
//   • Reads /friends and, for every edge friends/{owner}/{friend}, sets
//     `avatar` to the friend's current equippedAvatar (skips friends with no
//     equippedAvatar so existing values aren't wiped, and skips edges already
//     correct).
//   • Applies all changes as a single atomic multi-path update (Admin SDK,
//     bypasses security rules).
//
// Prerequisites (one-time):
//   npm i firebase-admin
//   A service-account key for the boost-8ef11 project, pointed at by
//   GOOGLE_APPLICATION_CREDENTIALS:
//     bash/zsh:    export GOOGLE_APPLICATION_CREDENTIALS="/abs/path/serviceAccount.json"
//     PowerShell:  $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\abs\path\serviceAccount.json"
//
// Usage:
//   node scripts/refresh-friend-avatars.mjs --dry-run   (report only, no write)
//   node scripts/refresh-friend-avatars.mjs             (apply)
//   node scripts/refresh-friend-avatars.mjs --names     (also refresh stale displayNames)

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const DATABASE_URL = 'https://boost-8ef11-default-rtdb.firebaseio.com';

function parseArgs(argv) {
  const o = { dryRun: false, names: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') o.dryRun = true;
    else if (argv[i] === '--names') o.names = true;
  }
  return o;
}

async function main() {
  const opts = parseArgs(process.argv);

  // applicationDefault() reads the service-account key from GOOGLE_APPLICATION_CREDENTIALS.
  const app = initializeApp({ credential: applicationDefault(), databaseURL: DATABASE_URL });
  const db = getDatabase(app);

  const [usersSnap, friendsSnap] = await Promise.all([
    db.ref('users').get(),
    db.ref('friends').get(),
  ]);
  const users = usersSnap.val() || {};
  const friends = friendsSnap.val() || {};

  // uid -> { avatar, name } from current profiles.
  const profileByUid = {};
  for (const [uid, node] of Object.entries(users)) {
    const p = node?.profile ?? {};
    profileByUid[uid] = { avatar: p.equippedAvatar ?? null, name: p.displayName ?? null };
  }

  const updates = {};
  let edgeCount = 0;
  let changed = 0;
  let skippedNoProfile = 0;
  const samples = [];

  for (const [ownerUid, edges] of Object.entries(friends)) {
    for (const [friendUid, edge] of Object.entries(edges || {})) {
      edgeCount++;
      const cur = profileByUid[friendUid];
      if (!cur || cur.avatar == null) { skippedNoProfile++; continue; }
      if (edge?.avatar !== cur.avatar) {
        updates[`friends/${ownerUid}/${friendUid}/avatar`] = cur.avatar;
        changed++;
        if (samples.length < 15) samples.push(`${ownerUid}→${friendUid}: ${edge?.avatar ?? '∅'} => ${cur.avatar}`);
      }
      if (opts.names && cur.name != null && edge?.name !== cur.name) {
        updates[`friends/${ownerUid}/${friendUid}/name`] = cur.name;
      }
    }
  }

  console.log(`Users: ${Object.keys(users).length}, friend edges: ${edgeCount}`);
  console.log(`Avatar fields to rewrite: ${changed}`);
  if (opts.names) {
    const nameWrites = Object.keys(updates).filter((k) => k.endsWith('/name')).length;
    console.log(`Name fields to rewrite:   ${nameWrites}`);
  }
  console.log(`Edges skipped (friend has no equippedAvatar): ${skippedNoProfile}`);
  if (samples.length) {
    console.log('\nSample avatar changes:');
    for (const s of samples) console.log(`  ${s}`);
  }

  const writeCount = Object.keys(updates).length;
  if (writeCount === 0) { console.log('\nNothing to update.'); process.exit(0); }

  if (opts.dryRun) { console.log('\nDry run — no write performed.'); process.exit(0); }

  await db.ref().update(updates);
  console.log(`\nApplied ${writeCount} field update(s) across friend edges.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
