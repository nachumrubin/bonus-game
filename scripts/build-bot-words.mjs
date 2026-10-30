#!/usr/bin/env node
// build-bot-words.mjs — rebuild data/bot-words.txt (the bot's vocabulary) from
// data/dictionary.txt, ordered by how common each word is.
//
// The bot's difficulty levels take the TOP of this list (easy: first 2,000 words of
// ≤3 letters, medium: first 20,000 of ≤5, hard: all of ≤6 — see main.js), so the
// order is what makes easy play everyday words. Words too rare to appear MIN_COUNT
// times in the frequency list are left out: the bot shouldn't play forms no human
// would think of.
//
// Frequency source: FrequencyWords (Hermit Dave, OpenSubtitles 2018, CC-BY-SA 4.0),
// https://github.com/hermitdave/FrequencyWords — content/2018/he/he_full.txt.
// It is not committed; download it and pass its path:
//
//   node scripts/build-bot-words.mjs <path/to/he_full.txt>           # report only
//   node scripts/build-bot-words.mjs <path/to/he_full.txt> --write   # write the list
//
// Rerun after every dictionary change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DICT_PATH = path.join(ROOT, 'data', 'dictionary.txt');
const OUT_PATH = path.join(ROOT, 'data', 'bot-words.txt');
const MIN_COUNT = 5;

const freqPath = process.argv[2];
const write = process.argv.includes('--write');
if (!freqPath || freqPath.startsWith('--')) {
  console.error('usage: node scripts/build-bot-words.mjs <he_full.txt> [--write]');
  process.exit(1);
}

const counts = new Map();
for (const line of fs.readFileSync(freqPath, 'utf8').split(/\r?\n/)) {
  const [word, n] = line.trim().split(/\s+/);
  if (word && /^\d+$/.test(n ?? '')) counts.set(word, (counts.get(word) ?? 0) + Number(n));
}

const dict = fs.readFileSync(DICT_PATH, 'utf8').split(/\r?\n/).map(w => w.trim()).filter(Boolean);
const words = dict
  .map((w, i) => ({ w, i, n: counts.get(w) ?? 0 }))
  .filter(e => e.w.length >= 2 && e.n >= MIN_COUNT)
  .sort((a, b) => b.n - a.n || a.i - b.i)
  .map(e => e.w);

// Pool sizes per difficulty, mirroring main.js VOCAB_CAPS and botSearch maxWordLen.
const pool = (maxLen, cap) => Math.min(cap, words.filter(w => w.length <= maxLen).length);
console.log(`dictionary ${dict.length} words, ${counts.size} in the frequency list`);
console.log(`bot list ${words.length} words (count ≥ ${MIN_COUNT})`);
console.log(`pools: easy ${pool(3, 2000)}  medium ${pool(5, 20000)}  hard ${pool(6, Infinity)}`);

if (write) {
  fs.writeFileSync(OUT_PATH, words.join('\n') + '\n', 'utf8');
  console.log(`wrote ${path.relative(ROOT, OUT_PATH)}`);
}
