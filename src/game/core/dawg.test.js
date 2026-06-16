// Run with:  node --test src/game/core/dawg.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildDawg, serializeDawg, parseDawg } from './dawg.js';

function roundTrip(words) {
  const sorted = [...new Set(words)].sort();
  const dawg = buildDawg(sorted);
  const buf = serializeDawg(dawg);
  return { sorted, dawg, parsed: parseDawg(buf), bytes: buf.byteLength };
}

test('buildDawg + parseDawg round-trip a tiny ASCII set', () => {
  const { sorted, parsed } = roundTrip(['ab', 'abc', 'abd', 'ac', 'bcd', 'bcde']);
  for (const w of sorted) assert.equal(parsed.has(w), true, w);
});

test('parseDawg rejects words not in the input set', () => {
  const { parsed } = roundTrip(['ab', 'abc']);
  for (const neg of ['', 'a', 'abd', 'b', 'xyz', 'abcd']) {
    assert.equal(parsed.has(neg), false, `expected ${JSON.stringify(neg)} to be absent`);
  }
});

test('buildDawg throws when input is not sorted', () => {
  assert.throws(() => buildDawg(['b', 'a']), /sorted unique input/);
});

test('buildDawg throws on duplicates', () => {
  assert.throws(() => buildDawg(['a', 'a']), /sorted unique input/);
});

test('Hebrew round-trip: full 40K legacy dictionary', () => {
  const txt = fs.readFileSync('data/dictionary.base.txt', 'utf8');
  const words = [...new Set(txt.split(/\r?\n/).map((w) => w.trim()).filter(Boolean))].sort();
  const dawg = buildDawg(words);
  const parsed = parseDawg(serializeDawg(dawg));
  // Spot-check every word — this is the gate that catches any encoder bug.
  let missing = 0;
  for (const w of words) if (!parsed.has(w)) missing++;
  assert.equal(missing, 0, `${missing} words missing from decoded DAWG`);
});

test('DAWG suffix sharing compresses Hebrew effectively', () => {
  // 50K Hebrew words → < 350 KB binary. This is the size budget that drives
  // the wire-delivery promise of the v2 dictionary.
  const txt = fs.readFileSync('data/dictionary.base.txt', 'utf8');
  const words = [...new Set(txt.split(/\r?\n/).map((w) => w.trim()).filter(Boolean))].sort();
  const buf = serializeDawg(buildDawg(words));
  assert.ok(buf.byteLength < 350_000, `binary ${buf.byteLength} bytes exceeds 350 KB budget`);
});

test('DAWG iteration recovers every input word in sorted order', () => {
  const { sorted, parsed } = roundTrip(['ab', 'abc', 'abd', 'ac', 'bcd', 'bcde']);
  const recovered = [...parsed.words()];
  assert.deepEqual(recovered, sorted);
});

test('DAWG iteration is stable for Hebrew 40K', () => {
  const txt = fs.readFileSync('data/dictionary.base.txt', 'utf8');
  const words = [...new Set(txt.split(/\r?\n/).map((w) => w.trim()).filter(Boolean))].sort();
  const parsed = parseDawg(serializeDawg(buildDawg(words)));
  const recovered = [...parsed.words()];
  assert.equal(recovered.length, words.length);
  // Spot-check ordering at a few positions
  assert.equal(recovered[0], words[0]);
  assert.equal(recovered[words.length - 1], words[words.length - 1]);
  assert.equal(recovered[Math.floor(words.length / 2)], words[Math.floor(words.length / 2)]);
});

test('parseDawg rejects bad magic', () => {
  const buf = new ArrayBuffer(16);
  new DataView(buf).setUint32(0, 0xdeadbeef, true);
  assert.throws(() => parseDawg(buf), /bad DAWG magic/);
});

test('parseDawg rejects unsupported version', () => {
  const dawg = buildDawg(['ab']);
  const buf = serializeDawg(dawg);
  new DataView(buf).setUint32(4, 99, true); // corrupt the version
  assert.throws(() => parseDawg(buf), /unsupported DAWG version/);
});

test('prefixWalk returns -1 for unknown prefix, valid node id for known prefix', () => {
  const { parsed } = roundTrip(['abc', 'abd', 'xyz']);
  assert.equal(parsed.prefixWalk('ab') >= 0, true);
  assert.equal(parsed.prefixWalk('aq'), -1);
  // Walking a full word returns a node whose isFinal is true for accepted words
  const wordNode = parsed.prefixWalk('abc');
  assert.equal(parsed.isFinal(wordNode), true);
  const prefixNode = parsed.prefixWalk('ab');
  assert.equal(parsed.isFinal(prefixNode), false);
});
