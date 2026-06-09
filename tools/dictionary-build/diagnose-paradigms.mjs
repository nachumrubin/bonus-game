#!/usr/bin/env node
// Diagnose the paradigm vocabulary HSpell emits in inflection-trace.tsv.
// Used to design the HSpell-paradigm → semantic-ID mapping in 03d-inflect.js.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRACE = path.join(HERE, 'output', 'inflection-trace.tsv');

const text = fs.readFileSync(TRACE, 'utf8');
const lines = text.split(/\r?\n/);
const counts = new Map();
let total = 0;

for (let i = 1; i < lines.length; i++) {
  const parts = lines[i].split('\t');
  if (parts.length < 3) continue;
  const para = parts[2];
  counts.set(para, (counts.get(para) || 0) + 1);
  total++;
}

const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log(`Total surface→paradigm rows: ${total}`);
console.log(`Distinct paradigm strings:   ${sorted.length}\n`);

console.log('Top 60 paradigms by frequency:');
console.log('count\tparadigm');
for (const [p, c] of sorted.slice(0, 60)) {
  console.log(`${c}\t${p}`);
}

// Bucket by leading "shape" — first 2 tokens (gender, POS).
const buckets = new Map();
for (const [p, c] of sorted) {
  const head = p.split(',').slice(0, 2).join(',');
  buckets.set(head, (buckets.get(head) || 0) + c);
}
console.log('\nBuckets by (gender, POS) prefix:');
console.log('count\tprefix');
for (const [h, c] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${c}\t${h}`);
}

// Pronoun-suffix markers — what fraction of forms?
let withSlash = 0, withKav = 0;
for (const [p, c] of sorted) {
  if (p.includes('של/')) withSlash += c;
  if (p.includes('כב/')) withKav += c;
}
console.log(`\nForms with 'של/' in paradigm: ${withSlash}`);
console.log(`Forms with 'כב/' in paradigm: ${withKav}`);
