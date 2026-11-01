import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  createWordInfoService,
  decodeShardBytes,
  parseShard,
  shardFileFor,
} from './wordInfoService.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const INFO_DIR = path.join(ROOT, 'data', 'word-info');

// fetch() over the real data/word-info files, counting requests.
function diskFetch(calls = []) {
  return async (url) => {
    calls.push(url);
    const file = path.join(INFO_DIR, url.replace('./data/word-info/', ''));
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    const buf = fs.readFileSync(file);
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(buf.toString('utf8')),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };
}

test('shardFileFor names a shard by the first letter code point', () => {
  assert.equal(shardFileFor('אבא'), '05d0.tsv.gz');
  assert.equal(shardFileFor('תפוח'), '05ea.tsv.gz');
  assert.equal(shardFileFor(''), '');
});

test('parseShard reads word, source, more and up to three readings', () => {
  const map = parseShard('ספרים\tD\t2\tשם עצם, רבים\tשם תואר\n'
    + 'קנדה\tU\t0\tשם מדינה\n');
  assert.deepEqual(map.get('ספרים'), { source: 'D', more: 2, readings: ['שם עצם, רבים', 'שם תואר'] });
  assert.deepEqual(map.get('קנדה'), { source: 'U', more: 0, readings: ['שם מדינה'] });
});

test('decodeShardBytes inflates gzip and passes already-inflated bodies through', async () => {
  const text = 'מילה\tD\t0\tשם עצם\n';
  assert.equal(await decodeShardBytes(zlib.gzipSync(Buffer.from(text))), text);
  assert.equal(await decodeShardBytes(new TextEncoder().encode(text)), text);
  await assert.rejects(decodeShardBytes(zlib.gzipSync(Buffer.from(text)), { DecompressionStreamCtor: null }));
});

test('lookup returns readings and source text from the shipped data', async () => {
  const calls = [];
  const svc = createWordInfoService({ fetchFn: diskFetch(calls) });
  const info = await svc.lookup('אכלנו');
  assert.equal(info.word, 'אכלנו');
  assert.equal(info.source, 'D');
  assert.match(info.sourceText, /דיקטה/);
  assert.ok(info.readings.some((r) => r.includes('אָכַל')), info.readings.join(' | '));
  // Only index.json + the one shard were fetched; a second lookup in the same shard is cached.
  assert.deepEqual(calls, ['./data/word-info/index.json', './data/word-info/05d0.tsv.gz']);
  await svc.lookup('אבא');
  assert.equal(calls.length, 2);
});

test('lookup finds country names (UN list source)', async () => {
  const svc = createWordInfoService({ fetchFn: diskFetch() });
  const info = await svc.lookup('קנדה');
  assert.ok(info.readings[0].includes('שם מדינה'));
  assert.ok(info.sourceText.length > 0);
});

test('lookup resolves a board spelling without a final letter (מלכ → מלך)', async () => {
  const svc = createWordInfoService({ fetchFn: diskFetch() });
  const info = await svc.lookup('מלכ');
  assert.equal(info.word, 'מלך');
});

test('lookup returns null for a word with no entry, and rejects on network failure', async () => {
  const svc = createWordInfoService({ fetchFn: diskFetch() });
  assert.equal(await svc.lookup('קקקקקקק'), null);
  assert.equal(await svc.lookup('  '), null);
  const offline = createWordInfoService({ fetchFn: async () => { throw new Error('offline'); } });
  await assert.rejects(offline.lookup('בית'));
});

test('data/word-info matches data/dictionary.txt (rerun scripts/sync-boost-dictionary.mjs after a list change)', () => {
  const index = JSON.parse(fs.readFileSync(path.join(INFO_DIR, 'index.json'), 'utf8'));
  const dictBytes = fs.readFileSync(path.join(ROOT, 'data', 'dictionary.txt'));
  assert.equal(index.dictionarySha256, crypto.createHash('sha256').update(dictBytes).digest('hex'));
  const words = dictBytes.toString('utf8').split('\n').filter(Boolean);
  assert.equal(index.words, words.length);
  let total = 0;
  for (const [name, meta] of Object.entries(index.files)) {
    const buf = fs.readFileSync(path.join(INFO_DIR, name));
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), meta.sha256, name);
    total += meta.words;
  }
  assert.equal(total, words.length);
});
