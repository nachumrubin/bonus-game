#!/usr/bin/env node
// Phase 2b: corroborate each lemma against independent sources.
//
// A lemma is auto-accepted only if at least 2 sources contain it AND at least
// one of those sources is Wikipedia-frequency or the legacy 40K. Single-source
// (HSpell-only) lemmas go to the review queue, not auto-accept.
//
// Sources expected as text files (one lemma per line) under sources/:
//   - wiktionary-he-lemmas.txt   — extracted from Hebrew Wiktionary dump
//   - wikipedia-he-frequency.tsv — lemma\tfrequency from Wikipedia article corpus
//                                  (only lemmas with frequency ≥ N are corroborating)
//   - legacy-40k.txt             — copy of data/dictionary.base.txt
//   - academy-decisions.tsv      — lemma\tdecision (accepted/rejected) from
//                                  Academy of Hebrew Language (optional)
//
// Input:  output/hspell-lemmas.tsv + the above source files
// Output: output/lemmas-corroborated.tsv
//         (columns: lemma\tparadigm\ttags\tsources_count\tsource_flags)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(HERE, 'output');
const SOURCES_DIR = path.join(HERE, 'sources');

const WIKI_FREQ_MIN = 5; // tunable

function readLemmaSet(file) {
  if (!fs.existsSync(file)) {
    console.warn(`[warn] missing source: ${file} — skipping`);
    return new Set();
  }
  return new Set(
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim().split('\t')[0])
      .filter(Boolean)
  );
}

function readWikiFrequency(file) {
  if (!fs.existsSync(file)) {
    console.warn(`[warn] missing source: ${file} — skipping`);
    return new Set();
  }
  const accepted = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [lemma, freqStr] = line.trim().split('\t');
    const freq = parseInt(freqStr || '0', 10);
    if (lemma && freq >= WIKI_FREQ_MIN) accepted.add(lemma);
  }
  return accepted;
}

function main() {
  const lemmaTsv = path.join(OUTPUT_DIR, 'hspell-lemmas.tsv');
  if (!fs.existsSync(lemmaTsv)) {
    throw new Error(`Run 03a-extract-lemmas.js first; missing ${lemmaTsv}`);
  }
  const wikt = readLemmaSet(path.join(SOURCES_DIR, 'wiktionary-he-lemmas.txt'));
  const wiki = readWikiFrequency(path.join(SOURCES_DIR, 'wikipedia-he-frequency.tsv'));
  const legacy = readLemmaSet(path.join(SOURCES_DIR, 'legacy-40k.txt'));
  const academy = readLemmaSet(path.join(SOURCES_DIR, 'academy-decisions.tsv'));

  const rows = fs.readFileSync(lemmaTsv, 'utf8').split(/\r?\n/);
  const header = rows.shift();
  if (header !== 'lemma\tparadigm\ttags') {
    throw new Error(`unexpected lemma TSV header: ${header}`);
  }

  const out = ['lemma\tparadigm\ttags\tsources_count\tsource_flags'];
  for (const row of rows) {
    if (!row) continue;
    const [lemma, paradigm, tags] = row.split('\t');
    const flags = [];
    flags.push('H'); // HSpell — every row is from HSpell
    if (wikt.has(lemma)) flags.push('W');
    if (wiki.has(lemma)) flags.push('K'); // K = wiKipedia frequency
    if (legacy.has(lemma)) flags.push('L');
    if (academy.has(lemma)) flags.push('A');
    out.push(`${lemma}\t${paradigm}\t${tags}\t${flags.length}\t${flags.join('')}`);
  }
  const outPath = path.join(OUTPUT_DIR, 'lemmas-corroborated.tsv');
  fs.writeFileSync(outPath, out.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${out.length - 1} corroborated lemma rows → ${outPath}`);
}

main();
