// migrate-suggestion-keys.mjs — admin helper: re-key legacy /dictionarySuggestions
// entries to the deterministic `suggestionKey(type, word, uid)` scheme.
//
// Why: de-dup in `submitWordSuggestion()` used to list the whole
// /dictionarySuggestions collection (admin-only read → "Permission denied" for
// normal users). It now reads/writes a single deterministic node per
// (type, word, uid). Suggestions written before that change use `push()`
// auto-ids and won't be found by the new de-dup, so a user could re-suggest a
// word they already suggested. This script rewrites the old rows in place.
//
// What it does:
//   • Reads every node under /dictionarySuggestions.
//   • Leaves already-canonical single-user nodes untouched.
//   • For each legacy node, splits multi-user `suggestedBy` arrays into one
//     deterministic node per uid, merging into any node that already exists
//     (keeps the earliest createdAt; a non-pending status wins over pending,
//     so admin approvals/credits are preserved).
//   • Deletes the old push-id nodes. Writes are applied as a single atomic
//     multi-path update (Admin SDK, bypasses security rules).
//
// Prerequisites (one-time):
//   npm i firebase-admin
//   A service-account key for the boost-8ef11 project, pointed at by
//   GOOGLE_APPLICATION_CREDENTIALS:
//     bash/zsh:    export GOOGLE_APPLICATION_CREDENTIALS="/abs/path/serviceAccount.json"
//     PowerShell:  $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\abs\path\serviceAccount.json"
//
// Usage:
//   node scripts/migrate-suggestion-keys.mjs --dry-run   (report only, no write)
//   node scripts/migrate-suggestion-keys.mjs             (apply the migration)

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { cleanDictionaryWord, suggestionKey } from '../src/game/account/dictionaryService.js';

const DATABASE_URL = 'https://boost-8ef11-default-rtdb.firebaseio.com';
const PATH = 'dictionarySuggestions';

function parseArgs(argv) {
  const o = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') o.dryRun = true;
  }
  return o;
}

function uidsOf(node) {
  const sb = node?.suggestedBy;
  if (Array.isArray(sb)) return sb.filter(Boolean);
  return sb ? [sb] : [];
}

// Lower number = "more advanced"/sticky status, so it wins a merge.
const STATUS_RANK = { approved: 0, rejected: 1, pending: 2 };
function mergeNodes(a, b) {
  if (!a) return b;
  const aRank = STATUS_RANK[a.status] ?? 2;
  const bRank = STATUS_RANK[b.status] ?? 2;
  const status = aRank <= bRank ? a.status : b.status;
  const createdAtVals = [a.createdAt, b.createdAt].filter((v) => typeof v === 'number');
  const createdAt = createdAtVals.length ? Math.min(...createdAtVals) : (a.createdAt ?? b.createdAt ?? null);
  return { ...a, status, createdAt };
}

function canonicalNode(word, type, uid, status, createdAt) {
  return {
    word,
    normalizedWord: word,
    type,
    status: status ?? 'pending',
    suggestedBy: [uid],
    createdAt: createdAt ?? null,
  };
}

async function main() {
  const opts = parseArgs(process.argv);

  // applicationDefault() reads the service-account key from GOOGLE_APPLICATION_CREDENTIALS.
  const app = initializeApp({ credential: applicationDefault(), databaseURL: DATABASE_URL });
  const db = getDatabase(app);

  const snap = await db.ref(PATH).get();
  const all = snap.val() || {};
  const entries = Object.entries(all);
  console.log(`Read ${entries.length} node(s) under /${PATH}.`);

  // Partition into already-canonical (leave alone) and legacy (re-key).
  const canonicalKeys = new Set();
  const legacy = [];
  const skippedMalformed = [];
  for (const [key, node] of entries) {
    const word = cleanDictionaryWord(node?.word ?? node?.normalizedWord ?? '');
    const type = node?.type === 'remove' ? 'remove' : 'add';
    const uids = uidsOf(node);
    if (!word || uids.length === 0) { skippedMalformed.push(key); continue; }
    if (uids.length === 1 && key === suggestionKey(type, word, uids[0])) {
      canonicalKeys.add(key);
      continue;
    }
    legacy.push({ key, word, type, uids, status: node?.status, createdAt: node?.createdAt });
  }

  // Build the desired deterministic nodes, merging into existing canonical rows.
  const desired = new Map();
  for (const e of legacy) {
    for (const uid of e.uids) {
      const dk = suggestionKey(e.type, e.word, uid);
      const existing = desired.get(dk) ?? all[dk] ?? null;
      const candidate = canonicalNode(e.word, e.type, uid, e.status, e.createdAt);
      desired.set(dk, mergeNodes(existing, candidate));
    }
  }

  // Assemble an atomic multi-path update: write desired nodes, delete legacy keys.
  const updates = {};
  for (const [dk, node] of desired) updates[`${PATH}/${dk}`] = node;
  for (const e of legacy) {
    if (!(`${PATH}/${e.key}` in updates)) updates[`${PATH}/${e.key}`] = null; // don't delete a key we're writing
  }

  console.log(`Canonical (unchanged): ${canonicalKeys.size}`);
  console.log(`Legacy nodes to re-key: ${legacy.length}`);
  console.log(`Deterministic nodes to write: ${desired.size}`);
  console.log(`Legacy nodes to delete: ${legacy.filter((e) => updates[`${PATH}/${e.key}`] === null).length}`);
  if (skippedMalformed.length) {
    console.log(`Skipped (no word/uid — left untouched): ${skippedMalformed.length} -> ${skippedMalformed.join(', ')}`);
  }

  if (legacy.length === 0) { console.log('Nothing to migrate.'); process.exit(0); }

  if (opts.dryRun) {
    console.log('\n--- Dry run: planned changes ---');
    for (const e of legacy) {
      const keys = e.uids.map((u) => suggestionKey(e.type, e.word, u));
      console.log(`  ${e.key}  ->  ${keys.join(' , ')}   (${e.word} / ${e.type} / ${e.uids.length} uid)`);
    }
    console.log('\nDry run — no write performed.');
    process.exit(0);
  }

  await db.ref().update(updates);
  console.log(`\nMigration applied: ${desired.size} written, ${legacy.length} legacy nodes removed.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
