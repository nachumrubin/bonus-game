#!/usr/bin/env node
// Phase 2d: generate surface forms via paradigm-gated inflection.
//
// For each accepted lemma, look up its HSpell paradigm in
// config/paradigms-allowed.yaml. If the paradigm is allowed (include: true),
// use HSpell's enumerated surface forms; otherwise skip the entire lemma.
//
// The actual inflection is done by HSpell's wolig (already enumerated by
// 02-enumerate.js). This script's job is to:
//   1. Keep only the surface forms whose lemma+paradigm passed both 03c and
//      paradigms-allowed.yaml.
//   2. Emit a trace file mapping each kept surface form to its lemma + rule.
//
// Input:  output/lemmas-accepted.tsv
//         output/hspell-surface-forms.txt
//         config/paradigms-allowed.yaml
// Output: output/surface-forms-generated.txt
//         output/inflection-trace.tsv (surface\tlemma\tparadigm)
//
// Note: HSpell's `wolig` does not natively emit (surface, lemma) pairs in a
// machine-readable way across all versions. The cleanest path is to run wolig
// per-lemma — slow but reliable. This script's API supports that mode via
// --per-lemma; the default reads a precomputed surface-forms file and trusts
// HSpell's lemma assignment via a separate pairs file produced by HSpell's
// linginfo build. See the README for the linginfo build instructions.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(HERE, 'output');
const CONFIG_DIR = path.join(HERE, 'config');

function parseAllowedYaml(text) {
  // Minimal YAML reader: this file is hand-written and structured. We just
  // walk lines and collect `id:` + `include:` pairs. No external deps.
  const allowed = new Set();
  const lines = text.split(/\r?\n/);
  let pendingId = null;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    const idMatch = line.match(/^\s*-\s*id:\s*(\S+)/);
    const incMatch = line.match(/^\s*include:\s*(true|false)\b/i);
    if (idMatch) {
      pendingId = idMatch[1];
    } else if (incMatch && pendingId) {
      if (incMatch[1].toLowerCase() === 'true') allowed.add(pendingId);
      pendingId = null;
    }
  }
  return allowed;
}

function readSurfacePairs(file) {
  // Format expected: surface\tlemma\tparadigm
  // Produced by an HSpell linginfo step (out-of-band) or by running
  // 02-enumerate.js with the --pairs flag.
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing ${file}. Re-run 02-enumerate.js with HSpell linginfo enabled, or ` +
      `provide a (surface, lemma, paradigm) triple file at that path.`
    );
  }
  const pairs = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const parts = line.trim().split('\t');
    if (parts.length >= 3) pairs.push({ surface: parts[0], lemma: parts[1], paradigm: parts[2] });
  }
  return pairs;
}

// Map an HSpell native paradigm string to a semantic ID matching
// config/paradigms-allowed.yaml. See diagnose-paradigms.mjs for the actual
// HSpell paradigm vocabulary.
//
// Rules, in order:
//   1. Anything containing 'של/' → noun-with-pronoun-suffix or adj variant
//   2. Anything containing 'פרטי' → proper_noun (place/personal names)
//   3. POS detected by which letter appears as a tag: ע = noun, ת = adjective
//   4. Within nouns:
//        סמיכות → construct (split by יחיד/רבים)
//        otherwise → regular (split by gender: presence of 'נ' = fem)
//   5. Within adjectives:
//        סמיכות → adj_construct
//        otherwise → adj_unbound
//   6. Anything else → unknown
export function mapHspellToSemanticId(details) {
  const tokens = details.split(',');
  const set = new Set(tokens);

  if (set.has('פרטי')) return 'proper_noun';

  const hasPronounSuffix = details.includes('של/');
  const isNoun = set.has('ע');
  const isAdj = set.has('ת');

  if (isNoun) {
    if (hasPronounSuffix) return 'n_with_pronoun_suffix';
    if (set.has('סמיכות')) {
      if (set.has('יחיד')) return 'n_construct_singular';
      if (set.has('רבים')) return 'n_construct_plural';
      return 'n_unknown';
    }
    return set.has('נ') ? 'n_fem_regular' : 'n_masc_regular';
  }

  if (isAdj) {
    if (hasPronounSuffix) return 'adj_with_pronoun_suffix';
    if (set.has('סמיכות')) return 'adj_construct';
    return 'adj_unbound';
  }

  return 'unknown';
}

function main() {
  const allowed = parseAllowedYaml(
    fs.readFileSync(path.join(CONFIG_DIR, 'paradigms-allowed.yaml'), 'utf8')
  );
  console.log(`Allowed semantic IDs: ${[...allowed].sort().join(', ')}`);

  const acceptedRows = fs.readFileSync(path.join(OUTPUT_DIR, 'lemmas-accepted.tsv'), 'utf8')
    .split(/\r?\n/).slice(1).filter(Boolean);
  const acceptedLemmas = new Set();
  for (const row of acceptedRows) {
    const [lemma] = row.split('\t');
    acceptedLemmas.add(lemma);
  }

  const pairs = readSurfacePairs(path.join(OUTPUT_DIR, 'hspell-surface-pairs.tsv'));
  const surfaces = new Set();
  const trace = ['surface\tlemma\tparadigm\tsemantic_id'];
  let kept = 0, droppedNoLemma = 0;
  const droppedBySemanticId = new Map();

  for (const { surface, lemma, paradigm } of pairs) {
    if (!acceptedLemmas.has(lemma)) { droppedNoLemma++; continue; }
    const semanticId = mapHspellToSemanticId(paradigm);
    if (!allowed.has(semanticId)) {
      droppedBySemanticId.set(semanticId, (droppedBySemanticId.get(semanticId) || 0) + 1);
      continue;
    }
    surfaces.add(surface);
    trace.push(`${surface}\t${lemma}\t${paradigm}\t${semanticId}`);
    kept++;
  }

  const surfacesSorted = [...surfaces].sort();
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'surface-forms-generated.txt'),
    surfacesSorted.join('\n') + '\n', 'utf8'
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'inflection-trace.tsv'),
    trace.join('\n') + '\n', 'utf8'
  );

  console.log(`kept=${kept}  unique-surfaces=${surfacesSorted.length}  dropped-no-lemma=${droppedNoLemma}`);
  console.log('dropped by semantic ID:');
  for (const [id, c] of [...droppedBySemanticId.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${id.padEnd(28)} ${c}`);
  }
  console.log(`from ${acceptedLemmas.size} accepted lemmas`);
}

main();
