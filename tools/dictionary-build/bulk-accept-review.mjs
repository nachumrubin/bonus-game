#!/usr/bin/env node
// Take the cleaned pending-review queue and append every remaining row as
// an "accept" decision to manual-decisions.tsv. Used when the user has
// inspected the queue at a high level and chosen to mass-accept, planning
// to handle individual rejects later via a separate reject mechanism.
//
// Idempotent: rows already present in manual-decisions.tsv (by lemma) are
// skipped, so re-running won't add duplicates.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLEAN_CSV = path.join(HERE, 'review', 'pending-review.clean.csv');
const DECISIONS_TSV = path.join(HERE, 'review', 'manual-decisions.tsv');

const REVIEWER = 'bulk-accept';
const NOTES = 'auto-accepted via bulk-accept-review.mjs';

function readExistingLemmas() {
  if (!fs.existsSync(DECISIONS_TSV)) return new Set();
  const text = fs.readFileSync(DECISIONS_TSV, 'utf8');
  const out = new Set();
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/^\s*#.*$/, '').trim();
    if (!clean) continue;
    const [lemma] = clean.split('\t');
    if (lemma) out.add(lemma);
  }
  return out;
}

function main() {
  if (!fs.existsSync(CLEAN_CSV)) {
    throw new Error(`Run filter-review-queue.mjs first; missing ${CLEAN_CSV}`);
  }
  const existing = readExistingLemmas();
  const csv = fs.readFileSync(CLEAN_CSV, 'utf8');
  const rows = csv.split(/\r?\n/);
  // First line is header
  rows.shift();

  const toAppend = [];
  let skippedExisting = 0;
  for (const row of rows) {
    if (!row.trim()) continue;
    // CSV is "lemma,paradigm,tags,sources,decision,reviewer,notes" but the
    // paradigm column may itself contain commas (HSpell modifiers like
    // "ע,נסמך=X"), so a strict CSV parser would be wrong. We only need the
    // lemma reliably; take everything before the first comma.
    const firstComma = row.indexOf(',');
    const lemma = (firstComma < 0 ? row : row.slice(0, firstComma)).trim();
    if (!lemma) continue;
    if (existing.has(lemma)) { skippedExisting++; continue; }
    // We don't know the precise POS from this minimal parse — leave it blank
    // for now; 03c-filter-lemmas only checks lemma + decision, not POS.
    toAppend.push(`${lemma}\t\taccept\t${REVIEWER}\t${NOTES}`);
    existing.add(lemma);
  }

  if (toAppend.length === 0) {
    console.log(`Nothing to add. (${skippedExisting} skipped as already-decided.)`);
    return;
  }

  // Append (don't overwrite — preserves existing decisions and the header comment).
  const existingText = fs.existsSync(DECISIONS_TSV) ? fs.readFileSync(DECISIONS_TSV, 'utf8') : '';
  const sep = existingText.endsWith('\n') || !existingText ? '' : '\n';
  fs.writeFileSync(DECISIONS_TSV, existingText + sep + toAppend.join('\n') + '\n', 'utf8');
  console.log(`Appended ${toAppend.length} accept decisions to ${path.basename(DECISIONS_TSV)}.`);
  console.log(`Skipped ${skippedExisting} that were already decided.`);
  console.log(`\nNext: re-run the build to incorporate the accepts:`);
  console.log(`  node tools/dictionary-build/03c-filter-lemmas.js`);
  console.log(`  node tools/dictionary-build/03d-inflect.js`);
  console.log(`  node tools/dictionary-build/05-merge-and-gate.js && node tools/dictionary-build/06-encode.js`);
}

main();
