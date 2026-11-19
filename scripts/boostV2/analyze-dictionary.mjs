#!/usr/bin/env node
// Boost 2.0 — offline dictionary + tile analysis (spec §45).
//
// Read-only. Never modifies the dictionary or the tile distribution.
// Extracts, from the CURRENT implementation:
//   - tile quantities + values           (src/game/core/letterDistribution.js)
//   - word-length distribution            (data/dictionary.txt, data/bot-words.txt)
//   - starting / ending letter frequency  (final forms normalised)
//   - repeated-letter / unique-letter pattern frequencies
//   - base word-score distribution
// and proposes Letter Hunt / Word Edge difficulty bands + Power Word checks.
//
// Two corpora are reported:
//   full   — every legal word in data/dictionary.txt (what the validator accepts)
//   common — data/bot-words.txt (frequency-ordered common words; a better proxy
//            for what players actually find on a rack)
// Dictionary frequency is an initial proxy for difficulty, NOT proof of
// in-game completion rates (spec §45) — the headless simulation measures those.
//
// Usage: node scripts/boostV2/analyze-dictionary.mjs [--json out.json] [--md out.md]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HV, HD } from '../../src/game/core/letterDistribution.js';
import { normalizeLetter, normalizeWord } from '../../src/game/boostV2/hebrew.js';
import { TARGET_LETTERS } from '../../src/game/boostV2/rulesConfig.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_LEN = 10; // a word longer than the board can never be played

function loadWords(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8')
    .split(/\r?\n/)
    .map(w => w.trim())
    .filter(w => /^[א-ת]+$/.test(w))
    .map(normalizeWord)
    .filter(w => w.length >= 2 && w.length <= MAX_LEN);
}

function baseScore(w) {
  let s = 0;
  for (const ch of w) s += HV[ch] ?? 0;
  return s;
}

function letterCounts(w) {
  const m = new Map();
  for (const ch of w) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

function pct(n, d) { return d ? Math.round((n / d) * 10000) / 100 : 0; }

function analyzeCorpus(words) {
  const n = words.length;
  const len = {};
  const start = {};
  const end = {};
  let repeat1 = 0, repeat5 = 0, repeat2distinct = 0;
  const unique = { 4: 0, 5: 0, 7: 0 };
  const scoreHist = {};
  const scoreAtLeast = { 8: 0, 12: 0, 18: 0 };
  for (const w of words) {
    len[w.length] = (len[w.length] ?? 0) + 1;
    start[w[0]] = (start[w[0]] ?? 0) + 1;
    end[w[w.length - 1]] = (end[w[w.length - 1]] ?? 0) + 1;
    const counts = letterCounts(w);
    const reps = [...counts.values()].filter(v => v >= 2).length;
    if (reps >= 1) repeat1++;
    if (reps >= 1 && w.length >= 5) repeat5++;
    if (reps >= 2) repeat2distinct++;
    if (reps === 0) for (const k of [4, 5, 7]) if (w.length >= k) unique[k]++;
    const s = baseScore(w);
    scoreHist[s] = (scoreHist[s] ?? 0) + 1;
    for (const t of [8, 12, 18]) if (s >= t) scoreAtLeast[t]++;
  }
  const sortedScores = words.map(baseScore).sort((a, b) => a - b);
  const q = (p) => sortedScores[Math.min(sortedScores.length - 1, Math.floor(p * sortedScores.length))];
  return {
    words: n,
    lengthDistribution: len,
    lengthAtLeastPct: Object.fromEntries([4, 6, 8].map(k => [k, pct(words.filter(w => w.length >= k).length, n)])),
    lengthExactPct: Object.fromEntries([4, 6, 8].map(k => [k, pct(len[k] ?? 0, n)])),
    startLetterPct: Object.fromEntries(Object.entries(start).map(([k, v]) => [k, pct(v, n)])),
    endLetterPct: Object.fromEntries(Object.entries(end).map(([k, v]) => [k, pct(v, n)])),
    repeatedLetterPct: { anyRepeat: pct(repeat1, n), repeatInLen5Plus: pct(repeat5, n), twoDistinctRepeats: pct(repeat2distinct, n) },
    uniqueLetterPct: Object.fromEntries(Object.entries(unique).map(([k, v]) => [`len${k}Plus`, pct(v, n)])),
    baseScore: { p10: q(0.1), p25: q(0.25), median: q(0.5), p75: q(0.75), p90: q(0.9), atLeastPct: Object.fromEntries(Object.entries(scoreAtLeast).map(([k, v]) => [k, pct(v, n)])) },
  };
}

// Band letters into EASY / MEDIUM / HARD by a metric (higher = easier).
// Thresholds are explicit, so the proposal is reproducible and reviewable.
function band(letters, metric, { easyMin, mediumMin }) {
  const out = { EASY: [], MEDIUM: [], HARD: [] };
  for (const l of [...letters].sort((a, b) => metric[b] - metric[a])) {
    const v = metric[l] ?? 0;
    if (v >= easyMin) out.EASY.push(l);
    else if (v >= mediumMin) out.MEDIUM.push(l);
    else out.HARD.push(l);
  }
  return out;
}

export function runAnalysis() {
  const full = loadWords('data/dictionary.txt');
  const common = loadWords('data/bot-words.txt');
  const totalTiles = Object.values(HD).reduce((a, b) => a + b, 0);
  const tiles = Object.keys(HD).map(l => ({ letter: l, count: HD[l], value: HV[l] }));

  const fullA = analyzeCorpus(full);
  const commonA = analyzeCorpus(common);

  // Letter Hunt: the target letter must land ON the Boost square, so the
  // binding constraint is how often a player holds that tile. Metric = tile
  // count in the bag (jokers can stand in for any letter, equally for all).
  const tileMetric = Object.fromEntries(TARGET_LETTERS.map(l => [l, HD[l]]));
  const letterHunt = band(TARGET_LETTERS, tileMetric, { easyMin: 5, mediumMin: 3 });

  // Word Edge: the letter may already be on the board, so the binding
  // constraint is how many words start/end with it. Metric = share of COMMON
  // words with that start/end letter (normalised final forms).
  const startMetric = Object.fromEntries(TARGET_LETTERS.map(l => [l, commonA.startLetterPct[l] ?? 0]));
  const endMetric = Object.fromEntries(TARGET_LETTERS.map(l => [l, commonA.endLetterPct[l] ?? 0]));
  const wordEdgeStart = band(TARGET_LETTERS, startMetric, { easyMin: 5, mediumMin: 2.5 });
  const wordEdgeEnd = band(TARGET_LETTERS, endMetric, { easyMin: 4, mediumMin: 1.5 });

  return {
    generatedFrom: { dictionary: 'data/dictionary.txt', common: 'data/bot-words.txt', maxWordLength: MAX_LEN },
    tiles: { total: totalTiles, jokers: HD['?'], jokerValue: HV['?'], distribution: tiles },
    corpora: { full: fullA, common: commonA },
    proposals: {
      letterHunt: { metric: 'tile count in bag', thresholds: { easyMin: 5, mediumMin: 3 }, bands: letterHunt, metricValues: tileMetric },
      wordEdgeStart: { metric: '% of common words starting with letter', thresholds: { easyMin: 5, mediumMin: 2.5 }, bands: wordEdgeStart, metricValues: startMetric },
      wordEdgeEnd: { metric: '% of common words ending with letter', thresholds: { easyMin: 4, mediumMin: 1.5 }, bands: wordEdgeEnd, metricValues: endMetric },
    },
  };
}

function toMarkdown(r) {
  const L = [];
  const c = r.corpora.common, f = r.corpora.full;
  L.push('# Boost 2.0 — Dictionary & Tile Analysis (generated)', '');
  L.push('> Generated by `node scripts/boostV2/analyze-dictionary.mjs --md docs-md/boost-v2/ANALYSIS.md`. Do not hand-edit.');
  L.push('> Dictionary frequency is a proxy for difficulty, not measured completion rate (spec §45).', '');
  L.push(`Corpora: full = ${f.words.toLocaleString()} legal words (len 2–${r.generatedFrom.maxWordLength}); common = ${c.words.toLocaleString()} frequency-list words.`, '');
  L.push('## Tiles (extracted, unchanged)', '', `Total ${r.tiles.total} tiles, ${r.tiles.jokers} jokers (value ${r.tiles.jokerValue}).`, '');
  L.push('| Letter | Count | Value |', '|---|---|---|');
  for (const t of r.tiles.distribution) L.push(`| ${t.letter} | ${t.count} | ${t.value} |`);
  L.push('', '## Word-shape frequencies (% of words)', '', '| Metric | full | common |', '|---|---|---|');
  const row = (name, a, b) => L.push(`| ${name} | ${a} | ${b} |`);
  for (const k of [4, 6, 8]) row(`length ≥ ${k} (Long Word)`, f.lengthAtLeastPct[k], c.lengthAtLeastPct[k]);
  for (const k of [4, 6, 8]) row(`length = ${k} (Exact Target)`, f.lengthExactPct[k], c.lengthExactPct[k]);
  row('any repeated letter (Double Easy)', f.repeatedLetterPct.anyRepeat, c.repeatedLetterPct.anyRepeat);
  row('repeat in len ≥ 5 (Double Medium)', f.repeatedLetterPct.repeatInLen5Plus, c.repeatedLetterPct.repeatInLen5Plus);
  row('two distinct repeats (Double Hard)', f.repeatedLetterPct.twoDistinctRepeats, c.repeatedLetterPct.twoDistinctRepeats);
  for (const k of [4, 5, 7]) row(`all-unique, len ≥ ${k} (Unique)`, f.uniqueLetterPct[`len${k}Plus`], c.uniqueLetterPct[`len${k}Plus`]);
  for (const t of [8, 12, 18]) row(`base score ≥ ${t} (Power Word)`, f.baseScore.atLeastPct[t], c.baseScore.atLeastPct[t]);
  L.push('', `Base score quantiles (common): p10 ${c.baseScore.p10}, p25 ${c.baseScore.p25}, median ${c.baseScore.median}, p75 ${c.baseScore.p75}, p90 ${c.baseScore.p90}.`);
  L.push('Note: a single word on the board is usually 2–5 letters; Power Word evaluates ONE word, so these word-level rates overstate in-game ease for long words.', '');
  for (const [key, title] of [['letterHunt', 'Letter Hunt'], ['wordEdgeStart', 'Word Edge — START'], ['wordEdgeEnd', 'Word Edge — END']]) {
    const p = r.proposals[key];
    L.push(`## Proposed ${title} bands`, '', `Metric: ${p.metric}. Thresholds: EASY ≥ ${p.thresholds.easyMin}, MEDIUM ≥ ${p.thresholds.mediumMin}, else HARD.`, '');
    L.push('| Letter | Metric | Band |', '|---|---|---|');
    const all = Object.entries(p.metricValues).sort((a, b) => b[1] - a[1]);
    for (const [l, v] of all) {
      const b = Object.entries(p.bands).find(([, ls]) => ls.includes(l))?.[0];
      L.push(`| ${l} | ${v} | ${b} |`);
    }
    L.push('');
  }
  return L.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runAnalysis();
  const ai = process.argv.indexOf('--json');
  const mi = process.argv.indexOf('--md');
  if (ai > 0) writeFileSync(process.argv[ai + 1], JSON.stringify(r, null, 2));
  if (mi > 0) writeFileSync(process.argv[mi + 1], toMarkdown(r));
  if (ai < 0 && mi < 0) process.stdout.write(toMarkdown(r));
}
