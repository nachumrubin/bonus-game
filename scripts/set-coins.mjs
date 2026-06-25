// set-coins.mjs — admin helper: set a user's coin balance in the production
// Realtime Database. Use it to reset a corrupted / out-of-band-inflated balance
// (writing a user's profile requires auth as that user, so the client can't do
// it — this uses the Firebase Admin SDK, which bypasses security rules).
//
// Prerequisites (one-time):
//   npm i firebase-admin
//   A service-account key for the boost-8ef11 project. Point the standard
//   Google credential env var at it:
//     export GOOGLE_APPLICATION_CREDENTIALS="/abs/path/to/serviceAccount.json"
//
// Usage:
//   node scripts/set-coins.mjs --name "הודיה" --coins 1000
//   node scripts/set-coins.mjs --uid <firebaseUid> --coins 1000
//   node scripts/set-coins.mjs --name "הודיה"            (defaults to --coins 1000)
//   node scripts/set-coins.mjs --name "הודיה" --dry-run  (look up + print, no write)
//
// Options:
//   --name <displayName>  Find the user by profile.displayName (case-insensitive,
//                         trimmed). Errors if 0 or >1 match — use --uid then.
//   --uid <uid>           Target a specific Firebase uid directly.
//   --coins <n>           Balance to set. Default 1000. Clamped to 0..1,000,000.
//   --dry-run             Resolve the target and print current coins; do not write.

import admin from 'firebase-admin';

const DATABASE_URL = 'https://boost-8ef11-default-rtdb.firebaseio.com';

function parseArgs(argv) {
  const o = { name: null, uid: null, coins: 1000, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name')        o.name = argv[++i];
    else if (a === '--uid')    o.uid = argv[++i];
    else if (a === '--coins')  o.coins = Math.max(0, Math.min(1_000_000, Math.floor(Number(argv[++i]) || 0)));
    else if (a === '--dry-run') o.dryRun = true;
  }
  return o;
}

async function findUidByName(db, name) {
  const target = String(name).trim().toLowerCase();
  const snap = await db.ref('users').get();
  const users = snap.val() || {};
  const matches = [];
  for (const [uid, node] of Object.entries(users)) {
    const dn = node?.profile?.displayName;
    if (typeof dn === 'string' && dn.trim().toLowerCase() === target) {
      matches.push({ uid, displayName: dn, coins: Number(node?.profile?.coins) || 0 });
    }
  }
  return matches;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.name && !opts.uid) {
    console.error('Provide --name "<displayName>" or --uid <uid>. See header for usage.');
    process.exit(1);
  }

  admin.initializeApp({ databaseURL: DATABASE_URL }); // uses GOOGLE_APPLICATION_CREDENTIALS
  const db = admin.database();

  let uid = opts.uid;
  let label = uid;
  if (!uid) {
    const matches = await findUidByName(db, opts.name);
    if (matches.length === 0) { console.error(`No user with displayName "${opts.name}".`); process.exit(2); }
    if (matches.length > 1) {
      console.error(`Multiple users match "${opts.name}" — rerun with --uid:`);
      for (const m of matches) console.error(`  ${m.uid}  (coins=${m.coins})`);
      process.exit(3);
    }
    uid = matches[0].uid;
    label = `${matches[0].displayName} (${uid})`;
  }

  const coinsRef = db.ref(`users/${uid}/profile/coins`);
  const before = (await coinsRef.get()).val();
  console.log(`Target: ${label}`);
  console.log(`Current coins: ${before}`);

  if (opts.dryRun) { console.log('Dry run — no write performed.'); process.exit(0); }

  await coinsRef.set(opts.coins);
  console.log(`Set coins: ${before} -> ${opts.coins}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
