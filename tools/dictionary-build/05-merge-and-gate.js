#!/usr/bin/env node
// Phase 2f: merge paradigm-generated set with legacy 40K + Firebase-approved
// overlay, apply EXACT_REJECTS, run hard quality gates. Build fails if any
// gate trips.
//
// Inputs:
//   output/surface-forms-generated.txt       (from 03d)
//   ../../data/dictionary.base.txt           (legacy 40K)
//   config/policy-blacklist.txt
//   review/manual-decisions.tsv
//   config/gold-positive.txt
//   config/gold-negative.txt
//
// Output:
//   output/dictionary.curated.txt
//   output/curation-report.txt

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(HERE, 'output');
const CONFIG_DIR = path.join(HERE, 'config');
const REVIEW_DIR = path.join(HERE, 'review');
const REPO_ROOT = path.resolve(HERE, '..', '..');

// Mirrors src/game/core/hebrewDictionary.js — kept in sync manually. Both
// places need the same constants for the runtime check to match the build-
// time gate.
//
// Additions beyond the runtime set (queued for sync into hebrewDictionary.js
// once we run a full canary):
//   - ירושלים — proper noun present in HSpell (place name).
//   - עליי — plene spelling of עלי; the runtime set has only עלי.
const EXACT_REJECTS_EXTRAS = new Set(['ירושלים', 'עליי']);
const EXACT_REJECTS = new Set([...EXACT_REJECTS_EXTRAS, 'אותה','אותו','אותך','אותכם','אותכן','אותם','אותן','אותנו','אחריה','אחריהם','אחריהן','אחריו','אחריי','אחרייך','אחריך','אחריכם','אחריכן','אחרינו','איתה','איתו','איתי','איתך','איתכם','איתכן','איתם','איתן','איתנו','אלי','אליה','אליהם','אליהן','אליו','אלייך','אליך','אליכם','אליכן','אלינו','אצלה','אצלו','אצלי','אצלך','אצלכם','אצלכן','אצלם','אצלן','אצלנו','בלעדי','בלעדיה','בלעדיהם','בלעדיהן','בלעדיו','בלעדייך','בלעדיך','בלעדיכם','בלעדיכן','בלעדינו','בשבילה','בשבילהן','בשבילו','בשבילי','בשבילך','בשבילכם','בשבילכן','בשבילם','בשבילנו','כמוה','כמוהו','כמוך','כמוכם','כמוכן','כמונו','כמוני','כמותם','כמותן','לידה','לידו','לידי','לידך','לידכם','לידכן','לידם','לידן','לידנו','למענה','למענו','למעני','למענך','למענכם','למענכן','למענם','למענן','למעננו','לפניה','לפניהם','לפניהן','לפניו','לפניי','לפנייך','לפניך','לפניכם','לפניכן','לפנינו','מאחוריה','מאחוריהם','מאחוריהן','מאחוריו','מאחוריי','מאחורייך','מאחוריך','מאחוריכם','מאחוריכן','מאחורינו','מולה','מולו','מולי','מולך','מולכם','מולכן','מולם','מולן','מולנו','ממך','ממכם','ממכן','ממנה','ממנו','ממני','נגדה','נגדו','נגדי','נגדך','נגדכם','נגדכן','נגדם','נגדן','נגדנו','עלי','עליה','עליהם','עליהן','עליו','עלייך','עליך','עליכם','עליכן','עלינו','עמה','עמהן','עמו','עמי','עמך','עמכם','עמכן','עמם','עמנו','שלה','שלהם','שלהן','שלו','שלי','שלך','שלכם','שלכן','שלנו','תוכה','תוכו','תוכי','תוכך','תוכם','תוכן','תוכנו','נאצי']);
const CLASSIC_ALLOW = new Set(['בה','בהם','בהן','בו','בי','בך','בכם','בכן','בנו','לה','להם','להן','לו','לי','לך','לכם','לכן','לנו']);

const MIN_WORDS = 35000;   // safety net — if generated list is tiny, something broke
const MAX_WORDS = 1000000; // safety net — if it's absurdly huge, something also broke
const POSITIVE_GATE = 0.99;
const NEGATIVE_GATE = 0.02;
const MAX_LEGACY_LOSS_PCT = 0.005; // 0.5% — silent loss of legacy words is forbidden

function readWords(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((w) => w.trim().replace(/#.*$/, '').trim())
      .filter(Boolean)
  );
}

function readManualAccepts(file) {
  if (!fs.existsSync(file)) return new Set();
  const out = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const clean = line.replace(/^\s*#.*$/, '').trim();
    if (!clean) continue;
    const [lemma, , decision] = clean.split('\t');
    if (lemma && decision === 'accept') out.add(lemma);
  }
  return out;
}

function pct(num, denom) { return denom === 0 ? 1 : num / denom; }

function main() {
  const generated = readWords(path.join(OUTPUT_DIR, 'surface-forms-generated.txt'));
  const legacy = readWords(path.join(REPO_ROOT, 'data', 'dictionary.base.txt'));
  const manualAccepts = readManualAccepts(path.join(REVIEW_DIR, 'manual-decisions.tsv'));

  // Step 1: union
  const merged = new Set([...generated, ...legacy, ...manualAccepts]);

  // Step 2: apply EXACT_REJECTS as final policy filter
  for (const r of EXACT_REJECTS) merged.delete(r);

  // Step 3: legacy loss check — every legacy word should still be present
  // unless dropped intentionally (i.e. it's now in EXACT_REJECTS).
  const intentionallyDropped = new Set();
  const lostFromLegacy = [];
  for (const w of legacy) {
    if (EXACT_REJECTS.has(w)) { intentionallyDropped.add(w); continue; }
    if (!merged.has(w)) lostFromLegacy.push(w);
  }

  // Step 4: gold-set gates
  const goldPos = readWords(path.join(CONFIG_DIR, 'gold-positive.txt'));
  const goldNeg = readWords(path.join(CONFIG_DIR, 'gold-negative.txt'));
  let posHits = 0;
  for (const w of goldPos) if (merged.has(w)) posHits++;
  let negHits = 0;
  for (const w of goldNeg) if (merged.has(w)) negHits++;

  // Step 5: CLASSIC_ALLOW check — runtime adds these even if absent here,
  // but it's still a build sanity check.
  const classicMissing = [...CLASSIC_ALLOW].filter((w) => !merged.has(w));

  // --- Build report ---
  const report = [];
  report.push(`# Curation Report — ${new Date().toISOString()}`);
  report.push('');
  report.push(`Generated (from paradigm inflection): ${generated.size}`);
  report.push(`Legacy 40K:                           ${legacy.size}`);
  report.push(`Manual accepts:                       ${manualAccepts.size}`);
  report.push(`Merged total:                         ${merged.size}`);
  report.push(`EXACT_REJECTS removed (intentional):  ${intentionallyDropped.size} (of ${EXACT_REJECTS.size})`);
  report.push(`Lost from legacy 40K (UNINTENTIONAL): ${lostFromLegacy.length}`);
  report.push('');
  report.push(`Gold positive: ${posHits}/${goldPos.size} (${(pct(posHits, goldPos.size) * 100).toFixed(2)}%)`);
  report.push(`Gold negative: ${negHits}/${goldNeg.size} present (${(pct(negHits, goldNeg.size) * 100).toFixed(2)}%) — lower is better`);
  report.push(`CLASSIC_ALLOW missing: ${classicMissing.length}`);
  report.push('');

  // --- Gate checks ---
  const gateFailures = [];
  if (merged.size < MIN_WORDS) gateFailures.push(`merged size ${merged.size} < ${MIN_WORDS}`);
  if (merged.size > MAX_WORDS) gateFailures.push(`merged size ${merged.size} > ${MAX_WORDS}`);
  if (pct(lostFromLegacy.length, legacy.size) > MAX_LEGACY_LOSS_PCT) {
    gateFailures.push(`legacy loss ${lostFromLegacy.length}/${legacy.size} exceeds ${(MAX_LEGACY_LOSS_PCT * 100).toFixed(2)}%`);
  }
  if (pct(posHits, goldPos.size) < POSITIVE_GATE) {
    gateFailures.push(`gold-positive pass rate ${(pct(posHits, goldPos.size) * 100).toFixed(2)}% < ${(POSITIVE_GATE * 100).toFixed(2)}%`);
  }
  if (pct(negHits, goldNeg.size) > NEGATIVE_GATE) {
    gateFailures.push(`gold-negative leak rate ${(pct(negHits, goldNeg.size) * 100).toFixed(2)}% > ${(NEGATIVE_GATE * 100).toFixed(2)}%`);
  }
  for (const r of EXACT_REJECTS) {
    if (merged.has(r)) gateFailures.push(`EXACT_REJECTS member still present: ${r}`);
  }

  // Always write the report so it can be inspected even on failure.
  if (lostFromLegacy.length > 0) {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'legacy-loss.txt'),
      lostFromLegacy.sort().join('\n') + '\n', 'utf8'
    );
    report.push(`Legacy losses written to legacy-loss.txt — review and add to intentionally-dropped list, or fix pipeline.`);
  }
  if (gateFailures.length) {
    report.push('');
    report.push('GATE FAILURES:');
    for (const f of gateFailures) report.push(`  - ${f}`);
  } else {
    report.push('');
    report.push('All gates passed.');
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'curation-report.txt'), report.join('\n') + '\n', 'utf8');
  console.log(report.join('\n'));

  if (gateFailures.length) {
    console.error('\nBuild aborted — gate failures (see curation-report.txt).');
    process.exit(1);
  }

  const sorted = [...merged].sort();
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'dictionary.curated.txt'),
    sorted.join('\n') + '\n', 'utf8'
  );
  console.log(`\nWrote ${sorted.length} curated words → output/dictionary.curated.txt`);
}

main();
