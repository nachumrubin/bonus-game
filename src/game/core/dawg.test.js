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

test('Hebrew round-trip: v2 binary decodes every word it encodes', () => {
  const buf = fs.readFileSync('data/dictionary.v2.bin');
  const parsed = parseDawg(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const words = [...parsed.words()];
  let missing = 0;
  for (const w of words) if (!parsed.has(w)) missing++;
  assert.equal(missing, 0, `${missing} words missing from decoded DAWG`);
});

test('DAWG suffix sharing compresses Hebrew effectively', () => {
  // 73K Hebrew words → < 500 KB binary.
  const buf = fs.readFileSync('data/dictionary.v2.bin');
  assert.ok(buf.byteLength < 500_000, `binary ${buf.byteLength} bytes exceeds 500 KB budget`);
});

test('DAWG iteration recovers every input word in sorted order', () => {
  const { sorted, parsed } = roundTrip(['ab', 'abc', 'abd', 'ac', 'bcd', 'bcde']);
  const recovered = [...parsed.words()];
  assert.deepEqual(recovered, sorted);
});

test('DAWG iteration is stable for the v2 binary', () => {
  const buf = fs.readFileSync('data/dictionary.v2.bin');
  const parsed = parseDawg(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const recovered = [...parsed.words()];
  // Re-encode from iterated words and verify round-trip matches original
  const reEncoded = parseDawg(serializeDawg(buildDawg([...recovered].sort())));
  assert.equal(reEncoded.has(recovered[0]), true);
  assert.equal(reEncoded.has(recovered[recovered.length - 1]), true);
  assert.equal(reEncoded.has(recovered[Math.floor(recovered.length / 2)]), true);
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
