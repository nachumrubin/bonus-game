#!/usr/bin/env node
// Phase 2a: extract lemmas + paradigm tags from HSpell's wolig.dat.
//
// HSpell's wolig.dat is a Hebrew lexicon where each entry has the form:
//
//   <lemma> <paradigm-tag> [tags...]
//
// Example (illustrative):
//   כלב   n_masc_regular
//   ילדה  n_fem_regular  H
//   כתב   v_paal
//   ירושלים  proper_noun  P
//
// Tags (single capital letters in HSpell convention):
//   P = proper noun
//   F = foreign / loanword
//   A = archaic / biblical-only
//   T = Talmudic / Aramaic
//   etc. (see HSpell docs)
//
// This script normalizes those entries into a TSV the downstream stages can
// consume.
//
// Input:  tools/dictionary-build/sources/hspell-*/wolig.dat
// Output: tools/dictionary-build/output/hspell-lemmas.tsv
//         (columns: lemma\tparadigm\ttags)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.join(HERE, 'sources');
const OUTPUT = path.join(HERE, 'output', 'hspell-lemmas.tsv');

function findWoligDat() {
  const dirs = fs.readdirSync(SOURCES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('hspell-'))
    .map((d) => path.join(SOURCES, d.name));
  for (const d of dirs.sort().reverse()) {
    const candidate = path.join(d, 'wolig.dat');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`wolig.dat not found under ${SOURCES}. Run 01-fetch-hspell.sh first.`);
}

function parseWoligDat(text) {
  const HEBREW = /^[א-ת]/;
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*#.*$/, '').trim();
    if (!line || !HEBREW.test(line)) continue;
    const parts = line.split(/\s+/);
    const lemma = parts[0];
    const paradigm = parts[1] || 'unknown';
    const tags = parts.slice(2).join(',');
    out.push({ lemma, paradigm, tags });
  }
  return out;
}

function main() {
  const datPath = findWoligDat();
  // HSpell source files are ISO-8859-8 (legacy Hebrew encoding), not UTF-8.
  const buf = fs.readFileSync(datPath);
  const text = new TextDecoder('iso-8859-8').decode(buf);
  const entries = parseWoligDat(text);
  const lines = ['lemma\tparadigm\ttags', ...entries.map((e) => `${e.lemma}\t${e.paradigm}\t${e.tags}`)];
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, lines.join('\n') + '\n', 'utf8');
  console.log(`Extracted ${entries.length} lemmas → ${OUTPUT}`);
}

main();
