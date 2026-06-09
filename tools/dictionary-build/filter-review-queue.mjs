#!/usr/bin/env node
// Strip rows from pending-review.csv whose lemma contains anything other
// than Hebrew letters. The dirty rows come from HSpell's internal source
// notation (w / Y / h / i / e / a markers used by wolig.dat before wolig.pl
// transforms them into proper Hebrew). Those lemmas would never validate
// as words anyway — they're pre-transformation placeholders.
//
// Reads pending-review.csv (no lock needed for read), writes the cleaned
// output to pending-review.clean.csv next to it. This avoids fighting
// Excel for write access on the original.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = path.join(HERE, 'review');
const INPUT = path.join(REVIEW_DIR, 'pending-review.csv');
const OUTPUT = path.join(REVIEW_DIR, 'pending-review.clean.csv');

const HEBREW_ONLY = /^[א-ת]+$/; // U+05D0..U+05EA = א..ת

function main() {
  const text = fs.readFileSync(INPUT, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) { console.log('empty file'); return; }

  const header = lines[0];
  const kept = [header];
  const dropped = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const firstComma = line.indexOf(',');
    const lemma = (firstComma < 0 ? line : line.slice(0, firstComma)).trim();
    if (!lemma) continue;
    if (HEBREW_ONLY.test(lemma)) {
      kept.push(line);
    } else {
      dropped.push(lemma);
    }
  }

  console.log(`Read ${lines.length - 1} rows from ${path.basename(INPUT)}.`);
  console.log(`Dropping ${dropped.length} rows with non-Hebrew lemmas.`);
  console.log(`First 30 dropped lemmas:`);
  for (const l of dropped.slice(0, 30)) console.log(`  ${JSON.stringify(l)}`);
  if (dropped.length > 30) console.log(`  ... and ${dropped.length - 30} more`);

  fs.writeFileSync(OUTPUT, kept.join('\n') + '\n', 'utf8');
  console.log(`\nWrote ${kept.length - 1} kept rows (plus header) to ${OUTPUT}`);
  console.log(`The original ${path.basename(INPUT)} is untouched.`);
}

main();
