#!/usr/bin/env node
// absorb-firebase-dict.mjs — "cut" words from /dictionaryApproved in Firebase
// and "paste" them into data/dictionary.txt, then remove them from Firebase.
//
// Usage:
//   node scripts/absorb-firebase-dict.mjs           # dry-run (no Firebase delete)
//   node scripts/absorb-firebase-dict.mjs --commit  # merge into text file + delete from Firebase
//
// For the Firebase delete step the firebase CLI must be logged in:
//   firebase login
// Then re-run with --commit.

import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const DICT_PATH = path.join(REPO_ROOT, 'data', 'dictionary.txt');

const PROD_CONFIG = {
  databaseURL: 'https://boost-8ef11-default-rtdb.firebaseio.com',
  projectId: 'boost-8ef11',
};

const commit = process.argv.includes('--commit');

async function main() {
  // 1. Read /dictionaryApproved from Firebase (public read, no auth needed)
  console.log('Connecting to Firebase…');
  firebase.initializeApp(PROD_CONFIG);
  const db = firebase.database();

  console.log('Reading /dictionaryApproved…');
  const snap = await db.ref('dictionaryApproved').get();
  const record = snap.val() || {};
  const firebaseWords = new Set(
    Object.values(record)
      .map((entry) => {
        const w = entry?.word ?? entry?.normalizedWord ?? entry ?? '';
        return String(w).replace(/[^א-ת]/g, '').trim();
      })
      .filter(Boolean),
  );

  await firebase.app().delete();
  console.log(`/dictionaryApproved contains ${firebaseWords.size} words.`);

  if (firebaseWords.size === 0) {
    console.log('Nothing to absorb. Exiting.');
    return;
  }

  // 2. Load current dictionary.txt
  console.log('Loading current dictionary.txt…');
  const existing = new Set(
    fs.readFileSync(DICT_PATH, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
  );
  console.log(`Current dictionary.txt: ${existing.size} words.`);

  // 3. Find words in Firebase not already in the text file
  const toAdd = [...firebaseWords].filter((w) => !existing.has(w));
  const alreadyIn = firebaseWords.size - toAdd.length;
  console.log(`Already in dictionary: ${alreadyIn}`);
  console.log(`New to dictionary:     ${toAdd.length}`);

  if (toAdd.length === 0) {
    console.log('All Firebase words already in dictionary.');
  } else {
    console.log('New words:', toAdd.join(', '));
  }

  if (!commit) {
    console.log('\nDry-run complete. Re-run with --commit to apply changes.');
    return;
  }

  // 4. Merge and rewrite dictionary.txt (sorted)
  if (toAdd.length > 0) {
    const merged = [...new Set([...existing, ...toAdd])].sort();
    fs.writeFileSync(DICT_PATH, merged.join('\n') + '\n', 'utf8');
    console.log(`dictionary.txt rebuilt: ${existing.size} → ${merged.length} words.`);
  }

  // 5. Delete /dictionaryApproved from Firebase via firebase CLI
  console.log('\nDeleting /dictionaryApproved from Firebase…');
  try {
    execSync(
      `firebase database:remove /dictionaryApproved --project ${PROD_CONFIG.projectId} --yes`,
      { stdio: 'inherit', cwd: REPO_ROOT },
    );
    console.log('Deleted /dictionaryApproved from Firebase.');
  } catch {
    console.error('\nFirebase CLI delete failed. You may not be logged in.');
    console.error('Run: firebase login');
    console.error('Then re-run: node scripts/absorb-firebase-dict.mjs --commit');
    console.error('\nTo delete manually, run:');
    console.error(`  firebase database:remove /dictionaryApproved --project ${PROD_CONFIG.projectId} --yes`);
    console.error('Or open the Firebase console and remove the dictionaryApproved node.');
    process.exit(1);
  }

  console.log('\nDone. dictionary.txt is now the source of truth for all accepted words.');
}

main().catch((err) => {
  console.error('[absorb-firebase-dict] fatal:', err);
  process.exit(1);
});
