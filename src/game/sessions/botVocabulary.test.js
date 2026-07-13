import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createBotWordList, parseBotWordsText } from './botVocabulary.js';

const ALEF = '\u05d0';
const BET = '\u05d1';
const GIMEL = '\u05d2';
const DALET = '\u05d3';
const HE = '\u05d4';
const VAV = '\u05d5';
const MEM = '\u05de';
const LAMED = '\u05dc';
const KAF = '\u05db';
const FINAL_KAF = '\u05da';

test('parseBotWordsText reads the first Hebrew token per line and normalizes finals', () => {
  const text = [
    `${ALEF}${BET} 12.34`,
    `${MEM}${LAMED}${FINAL_KAF}`,
    '',
    '123',
    `${ALEF}${BET}`,
  ].join('\n');

  assert.deepEqual(parseBotWordsText(text), [
    `${ALEF}${BET}`,
    `${MEM}${LAMED}${KAF}`,
  ]);
});

test('createBotWordList preserves frequency order before applying the cap', () => {
  const common = `${ALEF}${BET}`;
  const rare = `${GIMEL}${DALET}`;

  assert.deepEqual(createBotWordList({
    sourceWords: [common, rare],
    maxWordLen: 2,
    cap: 1,
    isWordValid: () => true,
    preserveOrder: true,
  }), [common]);
});

test('createBotWordList: prepended admin-approved words survive the vocab cap', () => {
  // main.js prepends APPROVED_OVERLAY words to BOT_WORDS so a word added via
  // the settings screen is playable by the bot even under the easy/medium cap.
  // Here `approved` is prepended ahead of many bot words with cap=2 — it must
  // survive; an appended word would have been sliced off.
  const approved = `${GIMEL}${DALET}`;
  const botWords = [`${ALEF}${BET}`, `${MEM}${LAMED}`, `${KAF}${VAV}`];
  const list = createBotWordList({
    sourceWords: [approved, ...botWords],
    maxWordLen: 2,
    cap: 2,
    isWordValid: () => true,
    preserveOrder: true,
  });
  assert.equal(list[0], approved, 'approved word is kept (and first) under the cap');
  assert.equal(list.length, 2);
});

test('createBotWordList filters by length and dictionary validity', () => {
  const validShort = `${ALEF}${BET}`;
  const validLong = `${ALEF}${BET}${GIMEL}${DALET}${HE}${VAV}`;
  const invalid = `${GIMEL}${DALET}`;

  assert.deepEqual(createBotWordList({
    sourceWords: [validShort, validLong, invalid],
    maxWordLen: 5,
    isWordValid: (word) => word !== invalid,
  }), [validShort]);
});
