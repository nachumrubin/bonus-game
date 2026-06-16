#!/usr/bin/env node
// absorb-firebase-dict.mjs — "cut" words from /dictionaryApproved in Firebase
// and "paste" them into the v2 DAWG binary, then remove them from Firebase.
//
// Usage:
//   node scripts/absorb-firebase-dict.mjs           # dry-run (no Firebase delete)
//   node scripts/absorb-firebase-dict.mjs --commit  # merge into binary + delete from Firebase
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
import { buildDawg, serializeDawg, parseDawg } from '../src/game/core/dawg.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const BIN_PATH = path.join(REPO_ROOT, 'data', 'dictionary.v2.bin');
const META_PATH = path.join(REPO_ROOT, 'data', 'dictionary.v2.meta.json');

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

  // 2. Load current v2 binary
  console.log('Loading current v2 binary…');
  const binBuf = fs.readFileSync(BIN_PATH);
  const dawg = parseDawg(binBuf.buffer);
  const existingWords = new Set(dawg.words());
  console.log(`Current v2 binary: ${existingWords.size} words.`);

  // 3. Find words in Firebase not already in the binary
  const toAdd = [...firebaseWords].filter((w) => !existingWords.has(w));
  const alreadyIn = firebaseWords.size - toAdd.length;
  console.log(`Already in binary: ${alreadyIn}`);
  console.log(`New to binary:     ${toAdd.length}`);

  if (toAdd.length === 0) {
    console.log('All Firebase words already in binary.');
  } else {
    console.log('New words:', toAdd.join(', '));
  }

  if (!commit) {
    console.log('\nDry-run complete. Re-run with --commit to apply changes.');
    return;
  }

  // 4. Merge and rebuild binary
  if (toAdd.length > 0) {
    const merged = [...new Set([...existingWords, ...toAdd])].sort();
    console.log(`\nBuilding new DAWG from ${merged.length} words…`);
    const newDawg = buildDawg(merged);
    const newBuf = serializeDawg(newDawg);

    // Self-test
    const parsed = parseDawg(newBuf);
    let mismatches = 0;
    for (const w of merged) { if (!parsed.has(w)) mismatches++; }
    if (mismatches > 0) throw new Error(`Round-trip failure: ${mismatches} words missing`);

    fs.writeFileSync(BIN_PATH, Buffer.from(newBuf));
    fs.writeFileSync(META_PATH, JSON.stringify({
      format: 'dawg-v1',
      wordCount: merged.length,
      nodeCount: newDawg.nodes.length,
      byteSize: newBuf.byteLength,
      source: 'curated-pipeline',
      builtAt: new Date().toISOString(),
    }, null, 2) + '\n', 'utf8');
    console.log(`Binary rebuilt: ${existingWords.size} → ${merged.length} words (${newBuf.byteLength} bytes).`);
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

  console.log('\nDone. The binary is now the source of truth for all accepted words.');
}

main().catch((err) => {
  console.error('[absorb-firebase-dict] fatal:', err);
  process.exit(1);
});
