const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addWordsToDictionaryText,
  decodeBase64ToUtf8,
  encodeUtf8ToBase64,
  parseInputWords,
  replaceDictionaryB64InHtml,
} = require('../../scripts/add-dictionary-words');

test('parseInputWords accepts space and comma separated inputs', () => {
  const words = parseInputWords(['שלום,עולם', 'בדיקה', 'עוד,מילה']);
  assert.deepEqual(words, ['שלום', 'עולם', 'בדיקה', 'עוד', 'מילה']);
});

test('addWordsToDictionaryText appends only new words', () => {
  const dictionary = ['שלום', 'עולם'].join('\n');
  const result = addWordsToDictionaryText(dictionary, ['עולם', 'בדיקה', 'שלום', 'חדש']);

  assert.deepEqual(result.appended, ['בדיקה', 'חדש']);
  assert.equal(result.totalWords, 4);
  assert.equal(result.nextDictionaryText, ['שלום', 'עולם', 'בדיקה', 'חדש'].join('\n'));
});

test('replaceDictionaryB64InHtml swaps the embedded base64 payload', () => {
  const dictionary = ['שלום', 'עולם'].join('\n');
  const b64 = encodeUtf8ToBase64(dictionary);
  const html = `<script>\nasync function loadDict() {\n  const B64 = "${b64}";\n}\n</script>`;

  const updatedText = ['שלום', 'עולם', 'חדש'].join('\n');
  const updatedB64 = encodeUtf8ToBase64(updatedText);
  const nextHtml = replaceDictionaryB64InHtml(html, updatedB64);

  const match = nextHtml.match(/const B64 = "(.*?)";/s);
  assert.ok(match && match[1], 'Expected to find updated B64 payload');
  assert.equal(decodeBase64ToUtf8(match[1]), updatedText);
});
