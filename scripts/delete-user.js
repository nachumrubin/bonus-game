#!/usr/bin/env node
//
// scripts/delete-user.js
//
// Full delete of a user account so they can be re-created from scratch.
// Intended for cleaning up early/buggy test accounts.
//
// Removes:
//   - Firebase Auth user
//   - users/{uid}                                  (profile + activeRoom + asyncRooms index)
//   - usernames/{lowercase(displayName)}           (if still pointing at this uid)
//   - userIds/{userId}                             (if still pointing at this uid)
//   - globalRatings/{uid}
//   - friends/{uid}                                (their own friends list)
//   - friends/{otherUid}/{uid}                     (their entry in every friend's list)
//   - friendRequests/{uid}                         (requests addressed to them)
//   - friendRequests/{otherUid}/{uid}              (requests they sent, scanned)
//   - invites/{uid}                                (invites addressed to them)
//   - inviteAcks/{uid}                             (acks where they were the inviter)
//   - presence/{uid}
//   - matchmakingQueue/{mode}/{uid}                (scanned across all modes)
//
// Active rooms (`rooms/{roomId}`) are NOT touched — they still reference the
// deleted uid in players.{0|1}.uid. Inspect/finish/abandon those manually
// before deletion if they matter.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//   node scripts/delete-user.js <uid> [--dry-run] [--yes]
//
// Setup:
//   1. Firebase Console → Project Settings → Service Accounts → "Generate
//      new private key". Save the JSON somewhere outside the repo.
//   2. npm install --save-dev firebase-admin
//   3. Set GOOGLE_APPLICATION_CREDENTIALS to the JSON path.
//
// Flags:
//   --dry-run    Print every path that would be deleted; write nothing.
//   --yes        Skip the interactive confirmation prompt.

const admin = require('firebase-admin');
const readline = require('node:readline');

const DATABASE_URL = 'https://boost-8ef11-default-rtdb.firebaseio.com';

function parseArgs(argv) {
  const args = { uid: null, dryRun: false, yes: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run')       args.dryRun = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a.startsWith('--')) { console.error(`Unknown flag: ${a}`); process.exit(2); }
    else if (!args.uid)          args.uid = a;
    else                         { console.error(`Unexpected argument: ${a}`); process.exit(2); }
  }
  if (!args.uid) {
    console.error('Usage: node scripts/delete-user.js <uid> [--dry-run] [--yes]');
    process.exit(2);
  }
  return args;
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function findFriendsReferencingUid(db, uid) {
  // friends/{otherUid}/{uid} → scan the whole "friends" root.
  const snap = await db.ref('friends').get();
  const map = snap.val() ?? {};
  const refs = [];
  for (const [otherUid, friendsOfOther] of Object.entries(map)) {
    if (otherUid === uid) continue; // their own list is wiped separately
    if (friendsOfOther && typeof friendsOfOther === 'object' && uid in friendsOfOther) {
      refs.push(`friends/${otherUid}/${uid}`);
    }
  }
  return refs;
}

async function findFriendRequestsFromUid(db, uid) {
  // friendRequests/{recipientUid}/{senderUid=uid}
  const snap = await db.ref('friendRequests').get();
  const map = snap.val() ?? {};
  const refs = [];
  for (const [recipientUid, byRecipient] of Object.entries(map)) {
    if (recipientUid === uid) continue; // their inbox is wiped separately
    if (byRecipient && typeof byRecipient === 'object' && uid in byRecipient) {
      refs.push(`friendRequests/${recipientUid}/${uid}`);
    }
  }
  return refs;
}

async function findMatchmakingQueueEntries(db, uid) {
  // matchmakingQueue/{mode}/{uid}
  const snap = await db.ref('matchmakingQueue').get();
  const map = snap.val() ?? {};
  const refs = [];
  for (const [mode, byMode] of Object.entries(map)) {
    if (byMode && typeof byMode === 'object' && uid in byMode) {
      refs.push(`matchmakingQueue/${mode}/${uid}`);
    }
  }
  return refs;
}

async function main() {
  const { uid, dryRun, yes } = parseArgs(process.argv);

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Missing GOOGLE_APPLICATION_CREDENTIALS. Point it at your service-account JSON.');
    process.exit(2);
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: DATABASE_URL,
  });
  const db = admin.database();

  // 1. Read the profile so we can clear the displayName/userId indexes.
  const profileSnap = await db.ref(`users/${uid}/profile`).get();
  const profile = profileSnap.val();
  const displayName = profile?.displayName ?? null;
  const userId      = profile?.userId      ?? null;

  // 2. Verify auth user exists.
  let authUser = null;
  try {
    authUser = await admin.auth().getUser(uid);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }

  console.log('─'.repeat(60));
  console.log(`uid:          ${uid}`);
  console.log(`auth user:    ${authUser ? (authUser.email ?? '(no email)') : '(none)'}`);
  console.log(`displayName:  ${displayName ?? '(none)'}`);
  console.log(`userId:       ${userId ?? '(none)'}`);
  console.log('─'.repeat(60));

  // 3. Build the multi-location update map. Setting a path to null deletes it.
  const updates = {};
  updates[`users/${uid}`]         = null;
  updates[`globalRatings/${uid}`] = null;
  updates[`friends/${uid}`]       = null;
  updates[`friendRequests/${uid}`] = null;
  updates[`invites/${uid}`]       = null;
  updates[`inviteAcks/${uid}`]    = null;
  updates[`presence/${uid}`]      = null;

  // Username index — only nuke if it still points at this uid.
  if (displayName) {
    const key = String(displayName).toLowerCase();
    const cur = (await db.ref(`usernames/${key}`).get()).val();
    if (cur === uid) updates[`usernames/${key}`] = null;
    else if (cur != null) console.log(`Skipping usernames/${key}: held by ${cur}, not ${uid}`);
  }
  // UserId index — same guard.
  if (userId) {
    const cur = (await db.ref(`userIds/${userId}`).get()).val();
    if (cur === uid) updates[`userIds/${userId}`] = null;
    else if (cur != null) console.log(`Skipping userIds/${userId}: held by ${cur}, not ${uid}`);
  }

  // Cross-tree references (scans).
  const [friendRefs, requestRefs, queueRefs] = await Promise.all([
    findFriendsReferencingUid(db, uid),
    findFriendRequestsFromUid(db, uid),
    findMatchmakingQueueEntries(db, uid),
  ]);
  for (const p of friendRefs)  updates[p] = null;
  for (const p of requestRefs) updates[p] = null;
  for (const p of queueRefs)   updates[p] = null;

  console.log(`Paths to delete (${Object.keys(updates).length}):`);
  for (const p of Object.keys(updates).sort()) console.log(`  - ${p}`);
  console.log('─'.repeat(60));

  if (dryRun) {
    console.log('Dry run — no writes performed. Auth user would also be deleted.');
    process.exit(0);
  }

  if (!yes) {
    const ok = await confirm(`Delete uid ${uid} and ${Object.keys(updates).length} RTDB paths + auth account? Type "yes": `);
    if (!ok) { console.log('Aborted.'); process.exit(1); }
  }

  // 4. Apply atomic multi-location delete.
  await db.ref().update(updates);
  console.log(`✓ RTDB paths deleted (${Object.keys(updates).length}).`);

  // 5. Delete the auth account.
  if (authUser) {
    await admin.auth().deleteUser(uid);
    console.log('✓ Auth user deleted.');
  } else {
    console.log('• No auth user to delete.');
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
