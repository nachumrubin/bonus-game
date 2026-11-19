import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createSortedTextLookup, createWordValidator, approvedFromSnapshot, blockedFromSnapshot } from './sortedDictionary.js';
import { DICT, BLOCKED_OVERLAY, addWordsFromText, isValid } from '../core/hebrewDictionary.js';

const _log = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _log; });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FULL = readFileSync(path.join(ROOT, 'data/dictionary.txt'), 'utf8');

test('binary search over the raw sorted text finds every word and nothing else', () => {
  const lookup = createSortedTextLookup('אב\nאבא\nבית\nשלום\n');
  for (const w of ['אב', 'אבא', 'בית', 'שלום']) assert.ok(lookup.has(w), w);
  for (const w of ['א', 'אבאב', 'בי', 'שלומ', 'ת', '']) assert.equal(lookup.has(w), false, w);
  assert.ok(createSortedTextLookup('שלום').has('שלום'), 'no trailing newline');
});

test('the production dictionary file is sorted for binary search (code-unit order, LF)', () => {
  assert.equal(FULL.includes('\r'), false);
  const lines = FULL.split('\n').filter(Boolean);
  for (let i = 1; i < lines.length; i++) assert.ok(lines[i - 1] < lines[i], `unsorted at line ${i}`);
  const lookup = createSortedTextLookup(FULL);
  for (let i = 0; i < lines.length; i += 997) assert.ok(lookup.has(lines[i]), lines[i]);
});

test('validator matches hebrewDictionary.isValid (finals, overlays, junk input)', () => {
  const sample = FULL.split('\n').filter(Boolean).filter((_, i) => i % 50 === 0);
  const text = sample.join('\n') + '\n';
  DICT.clear(); BLOCKED_OVERLAY.clear();
  addWordsFromText(text);
  const blockedWord = sample[10];
  const approvedWord = 'זזזזזז';
  BLOCKED_OVERLAY.add(blockedWord);
  DICT.add(approvedWord);
  const v = createWordValidator({ text, blocked: new Set([blockedWord]), approved: new Set([approvedWord]) });

  const probes = [
    ...sample.slice(0, 400),
    ...sample.slice(0, 200).map(w => w.replace(/[ךםןףץ]$/, ch => ({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' })[ch])),
    ...sample.slice(0, 200).map(w => w + 'א'),
    blockedWord, approvedWord, '', 'abc', ' שלום ', 'ש-ל-ו-ם', null, undefined,
  ];
  for (const p of probes) assert.equal(v(p), isValid(p), `parity for ${JSON.stringify(p)}`);
  DICT.clear(); BLOCKED_OVERLAY.clear();
});

test('overlay snapshots parse like the app does', () => {
  assert.deepEqual([...approvedFromSnapshot({ 'שלום': true, 'abc': true })], ['שלום']);
  assert.deepEqual([...blockedFromSnapshot({ a: 'מילה', b: { word: 'עוד' }, c: { normalizedWord: 'אחת' }, d: 42 })].sort(), ['אחת', 'מילה', 'עוד'].sort());
});
