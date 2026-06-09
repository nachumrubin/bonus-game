#!/usr/bin/env node
// Phase 1 (continued): enumerate all legal surface forms from HSpell, with
// each form traced back to its source lemma + paradigm.
//
// We invoke a locally-patched wolig.pl with the `-p` (pairs) flag. The patch
// (see patch-wolig.mjs) makes wolig.pl emit tab-separated triples:
//   surface \t lemma \t details
// where `details` is HSpell's native paradigm description (e.g.
// "ז,ע,יחיד,נפרד" = masculine noun, singular, free state).
//
// Inputs:  tools/dictionary-build/sources/hspell-*/wolig.pl + wolig.dat
//          (built by 01-fetch-hspell.sh and patched by patch-wolig.mjs)
// Outputs: tools/dictionary-build/output/hspell-surface-pairs.tsv
//          tools/dictionary-build/output/hspell-surface-forms.txt
//            (just the deduped surface column, kept for back-compat with
//             05-merge-and-gate.js's fallback path)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.join(HERE, 'sources');
const OUTPUT_FORMS = path.join(HERE, 'output', 'hspell-surface-forms.txt');
const OUTPUT_PAIRS = path.join(HERE, 'output', 'hspell-surface-pairs.tsv');

function findHspellDir() {
  const candidates = fs.readdirSync(SOURCES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('hspell-'))
    .map((d) => path.join(SOURCES, d.name));
  if (candidates.length === 0) {
    throw new Error(`No hspell-* directory under ${SOURCES}. Run 01-fetch-hspell.sh first.`);
  }
  return candidates.sort().reverse()[0]; // newest
}

function enumerateViaWolig(hspellDir) {
  // HSpell ships wolig as a Perl script (wolig.pl), not a compiled binary,
  // AND it emits Hebrew text in legacy ISO-8859-8 encoding (single-byte),
  // not UTF-8. We capture stdout as raw bytes and decode it ourselves.
  //
  // The local copy of wolig.pl is patched (see patch-wolig.mjs) to support
  // a `-p` flag that emits "surface\tlemma\tdetails" triples.
  const woligPl = path.join(hspellDir, 'wolig.pl');
  const lexicon = path.join(hspellDir, 'wolig.dat');
  if (!fs.existsSync(woligPl)) {
    throw new Error(`wolig.pl not found at ${woligPl}. Did 'make' succeed?`);
  }
  if (!fs.existsSync(lexicon)) {
    throw new Error(`wolig.dat not found at ${lexicon}.`);
  }
  // Verify the patch is applied so we don't silently fall back to non-pairs
  // output and then waste 1+ minutes producing useless data.
  const woligText = fs.readFileSync(woligPl).toString('binary');
  if (!woligText.includes('$pairs_output=0;')) {
    throw new Error(
      `wolig.pl is not patched for pairs output. Run: node tools/dictionary-build/patch-wolig.mjs`
    );
  }
  console.log(`Enumerating with perl ${woligPl} -p ${lexicon}…`);
  const stdoutBuf = execFileSync('perl', [woligPl, '-p', lexicon], {
    maxBuffer: 2 * 1024 * 1024 * 1024, // 2 GB — pairs output is ~3x bigger than bare forms
    cwd: hspellDir,
  });
  return new TextDecoder('iso-8859-8').decode(stdoutBuf);
}

function main() {
  const hspellDir = findHspellDir();
  const raw = enumerateViaWolig(hspellDir);
  // Each non-header line is "surface\tlemma\tdetails". Header comments start
  // with '#'. We accept lines where the first two tab-separated columns are
  // pure Hebrew.
  const HEBREW = /^[א-ת]+$/;
  const pairs = []; // [surface, lemma, details]
  const forms = new Set();
  let kept = 0, skipped = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) { skipped++; continue; }
    const parts = line.split('\t');
    if (parts.length < 3) { skipped++; continue; }
    const [surface, lemma, details] = parts;
    if (!HEBREW.test(surface) || !HEBREW.test(lemma)) { skipped++; continue; }
    pairs.push([surface, lemma, details]);
    forms.add(surface);
    kept++;
  }

  fs.mkdirSync(path.dirname(OUTPUT_PAIRS), { recursive: true });

  // Pairs file (used by 03d-inflect.js)
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const pairsHeader = 'surface\tlemma\tparadigm';
  const pairsLines = pairs.map((p) => p.join('\t'));
  fs.writeFileSync(OUTPUT_PAIRS, [pairsHeader, ...pairsLines].join('\n') + '\n', 'utf8');

  // Back-compat: bare surface-forms file (sorted, deduped).
  const sorted = [...forms].sort();
  fs.writeFileSync(OUTPUT_FORMS, sorted.join('\n') + '\n', 'utf8');

  console.log(`Kept ${kept} surface-form pairs (${forms.size} unique surfaces); skipped ${skipped} header/non-Hebrew lines.`);
  console.log(`Wrote ${OUTPUT_PAIRS}`);
  console.log(`Wrote ${OUTPUT_FORMS}`);
}

main();
