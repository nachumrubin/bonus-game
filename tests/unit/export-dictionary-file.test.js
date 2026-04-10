const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decodeBase64ToUtf8,
  DICTIONARY_B64_REGEX,
} = require('../../scripts/export-dictionary-file');

test('decodeBase64ToUtf8 decodes utf8 dictionary lines', () => {
  const encoded = Buffer.from('שלום\nעולם', 'utf8').toString('base64');
  assert.equal(decodeBase64ToUtf8(encoded), 'שלום\nעולם');
});

test('DICTIONARY_B64_REGEX matches embedded B64 assignment format', () => {
  const sample = 'const B64 = "YWJj";';
  const match = sample.match(DICTIONARY_B64_REGEX);
  assert.ok(match && match[2], 'expected B64 capture group to exist');
  assert.equal(match[2], 'YWJj');
});
