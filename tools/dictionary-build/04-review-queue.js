#!/usr/bin/env node
// Phase 2e: emit the human-review queue.
//
// Lemmas in lemmas-review.tsv (single-source, not auto-accepted) get written
// to review/pending-review.csv in a spreadsheet-friendly format for a native
// speaker to grade. Decisions get manually copied into
// review/manual-decisions.tsv after review.
//
// Re-running this script is safe: lemmas already in manual-decisions.tsv are
// excluded from the pending queue.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(HERE, 'output');
const REVIEW_DIR = path.join(HERE, 'review');

function readManualDecisions(file) {
  if (!fs.existsSync(file)) return new Set();
  const decided = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const clean = line.replace(/^\s*#.*$/, '').trim();
    if (!clean) continue;
    const [lemma] = clean.split('\t');
    if (lemma) decided.add(lemma);
  }
  return decided;
}

function main() {
  const reviewInput = path.join(OUTPUT_DIR, 'lemmas-review.tsv');
  if (!fs.existsSync(reviewInput)) {
    throw new Error(`Run 03c-filter-lemmas.js first; missing ${reviewInput}`);
  }
  const decided = readManualDecisions(path.join(REVIEW_DIR, 'manual-decisions.tsv'));

  const rows = fs.readFileSync(reviewInput, 'utf8').split(/\r?\n/);
  rows.shift(); // header

  const pending = ['lemma,paradigm,tags,sources,decision_(accept|reject|defer),reviewer,notes'];
  let written = 0;
  for (const row of rows) {
    if (!row) continue;
    const [lemma, paradigm, tags, sc] = row.split('\t');
    if (decided.has(lemma)) continue;
    pending.push(`${lemma},${paradigm},${tags},${sc},,,`);
    written++;
  }

  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  const outPath = path.join(REVIEW_DIR, 'pending-review.csv');
  fs.writeFileSync(outPath, pending.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${written} pending review entries → ${outPath}`);
  console.log(`(Already-reviewed lemmas in manual-decisions.tsv: ${decided.size})`);
}

main();
