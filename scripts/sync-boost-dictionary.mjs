#!/usr/bin/env node
// sync-boost-dictionary.mjs — bring the word list and the per-word information
// (the מילון "word origin" panel) over from a checkout of the boost-dictionary repo.
//
//   node scripts/sync-boost-dictionary.mjs <path/to/boost-dictionary>           # report only
//   node scripts/sync-boost-dictionary.mjs <path/to/boost-dictionary> --write   # write files
//
// Reads, from experiments/dicta_sole_source/candidate/ in that checkout:
//   dictionary.txt        → data/dictionary.txt (checked against candidate_manifest.json)
//   word_info.tsv.gz      → data/word-info/<shard>.tsv.gz + data/word-info/index.json
//
// word_info is ~62 MB uncompressed, so it is split by the word's first letter into
// gzip shards (one per letter, ~100 KB each). The game fetches only the shard of the
// word being looked up, and only when the player has the word-info toggle on
// (src/game/account/wordInfoService.js).
//
// Shard row format (UTF-8, LF, tab-separated, no header, sorted like dictionary.txt):
//   word <TAB> source <TAB> more <TAB> reading_1 [<TAB> reading_2 [<TAB> reading_3]]
// `source` is a code (D / U); its Hebrew text lives once in index.json `sources`.
//
// After --write, rebuild the bot list too (it is filtered by the dictionary):
//   node scripts/build-bot-words.mjs <he_full.txt> --write

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DICT_OUT = path.join(ROOT, 'data', 'dictionary.txt');
const INFO_DIR = path.join(ROOT, 'data', 'word-info');

const repo = process.argv[2];
const write = process.argv.includes('--write');
if (!repo || repo.startsWith('--')) {
  console.error('usage: node scripts/sync-boost-dictionary.mjs <path/to/boost-dictionary> [--write]');
  process.exit(1);
}

const CANDIDATE = path.join(repo, 'experiments', 'dicta_sole_source', 'candidate');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fail = (msg) => { console.error(`error: ${msg}`); process.exit(1); };

// ── dictionary.txt ────────────────────────────────────────────────────────────
const dictBytes = fs.readFileSync(path.join(CANDIDATE, 'dictionary.txt'));
const manifest = JSON.parse(fs.readFileSync(path.join(CANDIDATE, 'candidate_manifest.json'), 'utf8'));
const expected = manifest?.outputs?.['dictionary.txt'];
if (expected && sha256(dictBytes) !== expected) fail('dictionary.txt does not match candidate_manifest.json');
const dictText = dictBytes.toString('utf8');
if (dictText.charCodeAt(0) === 0xfeff || dictText.includes('\r')) fail('dictionary.txt must be UTF-8 without BOM, LF');
const words = dictText.split('\n').filter(Boolean);

let upstream = '';
try { upstream = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}

const current = fs.existsSync(DICT_OUT) ? fs.readFileSync(DICT_OUT, 'utf8').split('\n').filter(Boolean) : [];
const currentSet = new Set(current);
const nextSet = new Set(words);
const added = words.filter((w) => !currentSet.has(w)).length;
const removed = current.filter((w) => !nextSet.has(w)).length;
console.log(`dictionary: ${current.length} → ${words.length} words (+${added} −${removed})`);

// ── word_info.tsv.gz ──────────────────────────────────────────────────────────
const infoText = zlib.gunzipSync(fs.readFileSync(path.join(CANDIDATE, 'word_info.tsv.gz'))).toString('utf8');
const lines = infoText.split('\n').filter(Boolean);
const header = lines.shift().split('\t');
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) fail(`word_info.tsv.gz has no "${name}" column`);
  return i;
};
const C = {
  word: col('word'), source: col('source'), sourceHe: col('source_he'), more: col('more'),
  readings: header.map((h, i) => (/^reading_\d+$/.test(h) ? i : -1)).filter((i) => i >= 0),
};

const sources = {};
const shards = new Map();          // shard key → rows
const seen = new Set();
for (const line of lines) {
  const f = line.split('\t');
  const word = f[C.word];
  if (!nextSet.has(word)) fail(`word_info has "${word}", which is not in dictionary.txt`);
  if (seen.has(word)) fail(`word_info lists "${word}" twice`);
  seen.add(word);
  const source = f[C.source];
  if (!/^[A-Z]$/.test(source)) fail(`bad source code "${source}" for "${word}"`);
  if (sources[source] && sources[source] !== f[C.sourceHe]) fail(`source ${source} has two texts`);
  sources[source] = f[C.sourceHe];
  const readings = C.readings.map((i) => f[i] ?? '').filter(Boolean);
  for (const r of readings) if (/[\t\n]/.test(r)) fail(`reading of "${word}" contains a tab/newline`);
  const more = Number(f[C.more] || 0);
  const key = shardKey(word);
  if (!shards.has(key)) shards.set(key, []);
  shards.get(key).push([word, source, String(more), ...readings].join('\t'));
}
const missing = words.filter((w) => !seen.has(w));
if (missing.length) fail(`${missing.length} dictionary words have no word_info row (e.g. ${missing.slice(0, 5).join(', ')})`);

const files = {};
const out = [];
let total = 0;
for (const key of [...shards.keys()].sort()) {
  const rows = shards.get(key);
  const gz = zlib.gzipSync(Buffer.from(rows.join('\n') + '\n', 'utf8'), { level: 9 });   // mtime 0: byte-identical reruns
  const name = `${key}.tsv.gz`;
  files[name] = { words: rows.length, bytes: gz.length, sha256: sha256(gz) };
  out.push([name, gz]);
  total += gz.length;
}
const index = {
  format: 1,
  upstream: { repo: 'nachumrubin/boost-dictionary', commit: upstream, path: 'experiments/dicta_sole_source/candidate/word_info.tsv.gz' },
  dictionarySha256: sha256(dictBytes),
  words: seen.size,
  columns: ['word', 'source', 'more', 'reading…'],
  shard: 'first letter, 4-digit lowercase hex code point',
  sources,
  files,
};
const biggest = Object.entries(files).sort((a, b) => b[1].bytes - a[1].bytes)[0];
console.log(`word info: ${seen.size} words in ${out.length} shards, ${(total / 1e6).toFixed(2)} MB gzipped `
  + `(largest ${biggest[0]}: ${(biggest[1].bytes / 1e3).toFixed(0)} KB, ${biggest[1].words} words)`);
console.log(`sources: ${Object.entries(sources).map(([k, v]) => `${k} = ${v}`).join(' | ')}`);

if (write) {
  fs.writeFileSync(DICT_OUT, dictBytes);
  fs.rmSync(INFO_DIR, { recursive: true, force: true });
  fs.mkdirSync(INFO_DIR, { recursive: true });
  for (const [name, gz] of out) fs.writeFileSync(path.join(INFO_DIR, name), gz);
  fs.writeFileSync(path.join(INFO_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  console.log(`wrote ${path.relative(ROOT, DICT_OUT)} and ${path.relative(ROOT, INFO_DIR)}/ (${out.length + 1} files)`);
  console.log('next: node scripts/build-bot-words.mjs <he_full.txt> --write');
}

function shardKey(word) {
  return word.codePointAt(0).toString(16).padStart(4, '0');
}
