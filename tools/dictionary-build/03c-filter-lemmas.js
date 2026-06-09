#!/usr/bin/env node
// Phase 2c: apply categorical filters to the corroborated lemma list.
//
// Filters applied (in order — earlier filters win for transparency in the
// audit log):
//   1. Manual reject decisions (from review/manual-decisions.tsv).
//   2. Policy blacklist (slurs etc. from config/policy-blacklist.txt).
//   3. Brand-name blacklist (config/brand-blacklist.txt).
//   4. Archaic blacklist (config/archaic-blacklist.txt).
//   5. HSpell proper-noun tag (unless rescued by manual accept).
//   6. HSpell foreign tag AND not in foreign-allow.txt AND not in legacy 40K.
//   7. HSpell archaic/Aramaic/Talmudic tags.
//   8. Single-letter and most two-letter words (unless in CLASSIC_ALLOW or
//      corroborated by ≥ 3 sources).
//
// Anything that survives is split into two buckets:
//   - lemmas-accepted.tsv:  auto-accepted (sources_count ≥ 2 with a non-HSpell
//                            corroborator that is W/K/L/A).
//   - lemmas-review.tsv:    survived filters but only HSpell-corroborated.
//
// Every dropped lemma is recorded in lemmas-dropped.tsv with the rule that
// dropped it — critical for "why is X not in the dictionary" debugging.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(HERE, 'output');
const CONFIG_DIR = path.join(HERE, 'config');
const REVIEW_DIR = path.join(HERE, 'review');

const CLASSIC_ALLOW = new Set([
  'בה','בהם','בהן','בו','בי','בך','בכם','בכן','בנו',
  'לה','להם','להן','לו','לי','לך','לכם','לכן','לנו',
]);

function readLineSet(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter(Boolean)
  );
}

function readManualDecisions(file) {
  const decisions = new Map(); // lemma -> 'accept'|'reject'|'defer'
  if (!fs.existsSync(file)) return decisions;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const clean = line.replace(/^\s*#.*$/, '').trim();
    if (!clean) continue;
    const [lemma, , decision] = clean.split('\t');
    if (lemma && decision) decisions.set(lemma, decision);
  }
  return decisions;
}

function main() {
  const inPath = path.join(OUTPUT_DIR, 'lemmas-corroborated.tsv');
  if (!fs.existsSync(inPath)) {
    throw new Error(`Run 03b-corroborate-lemmas.js first; missing ${inPath}`);
  }

  const policyBlack = readLineSet(path.join(CONFIG_DIR, 'policy-blacklist.txt'));
  const brandBlack = readLineSet(path.join(CONFIG_DIR, 'brand-blacklist.txt'));
  const archaicBlack = readLineSet(path.join(CONFIG_DIR, 'archaic-blacklist.txt'));
  const foreignAllow = readLineSet(path.join(CONFIG_DIR, 'foreign-allow.txt'));
  const manual = readManualDecisions(path.join(REVIEW_DIR, 'manual-decisions.tsv'));

  const rows = fs.readFileSync(inPath, 'utf8').split(/\r?\n/);
  rows.shift(); // header

  const accepted = ['lemma\tparadigm\ttags\tsources_count\tsource_flags'];
  const review = ['lemma\tparadigm\ttags\tsources_count\tsource_flags'];
  const dropped = ['lemma\tparadigm\ttags\trule\tdetail'];
  const stats = { accepted: 0, review: 0, dropped: 0, byRule: {} };

  function drop(lemma, paradigm, tags, rule, detail = '') {
    dropped.push(`${lemma}\t${paradigm}\t${tags}\t${rule}\t${detail}`);
    stats.dropped++;
    stats.byRule[rule] = (stats.byRule[rule] || 0) + 1;
  }

  for (const row of rows) {
    if (!row) continue;
    const [lemma, paradigm, tags, scStr, flags] = row.split('\t');
    const sourcesCount = parseInt(scStr, 10);
    const tagSet = new Set((tags || '').split(',').filter(Boolean));
    const manualDecision = manual.get(lemma);

    if (manualDecision === 'reject') { drop(lemma, paradigm, tags, 'manual-reject'); continue; }
    if (manualDecision !== 'accept') {
      if (policyBlack.has(lemma))   { drop(lemma, paradigm, tags, 'policy-blacklist'); continue; }
      if (brandBlack.has(lemma))    { drop(lemma, paradigm, tags, 'brand-blacklist'); continue; }
      if (archaicBlack.has(lemma))  { drop(lemma, paradigm, tags, 'archaic-blacklist'); continue; }
      if (tagSet.has('P'))          { drop(lemma, paradigm, tags, 'proper-noun-tag'); continue; }
      if (tagSet.has('F') && !foreignAllow.has(lemma) && !flags.includes('L')) {
        drop(lemma, paradigm, tags, 'foreign-no-allow');
        continue;
      }
      if (tagSet.has('A') || tagSet.has('T')) { drop(lemma, paradigm, tags, 'archaic-tag'); continue; }
      if (lemma.length < 3 && !CLASSIC_ALLOW.has(lemma) && sourcesCount < 3) {
        drop(lemma, paradigm, tags, 'too-short-undercorroborated');
        continue;
      }
    }

    // Survived. Bucket into accepted vs. review.
    const nonHSpellSources = flags.replace('H', '').length;
    if (manualDecision === 'accept' || nonHSpellSources >= 1) {
      accepted.push(row);
      stats.accepted++;
    } else {
      review.push(row);
      stats.review++;
    }
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'lemmas-accepted.tsv'), accepted.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'lemmas-review.tsv'), review.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'lemmas-dropped.tsv'), dropped.join('\n') + '\n', 'utf8');
  console.log(`accepted=${stats.accepted}  review=${stats.review}  dropped=${stats.dropped}`);
  console.log('drops by rule:', JSON.stringify(stats.byRule, null, 2));
}

main();
