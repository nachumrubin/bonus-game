const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('index.html', 'utf8');
const dictMatch = source.match(/const B64 = "([A-Za-z0-9+/=]+)";/);
const dictBaseUrlMatch = source.match(/const DICT_BASE_URL = '([^']+)';/);

function extractLoaderSnippet() {
  const startMarker = 'function addWordsFromText(txt){';
  const endMarker = '\n\n// ── MOVE LOGGER ──';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not locate dictionary loader helper boundaries in index.html');
  }

  return 'let DICT = new Set();\n' + source.slice(start, end) + '\nglobalThis.__getDICT = () => DICT;';
}

test('addWordsFromText handles CRLF and trims whitespace', () => {
  const context = vm.createContext({ Set });
  vm.runInContext(extractLoaderSnippet(), context);

  context.addWordsFromText('אבא\r\n אמא \n\nדג\r\n');

  assert.deepEqual(Array.from(context.__getDICT()), ['אבא', 'אמא', 'דג']);
});

test('decodeDictionaryTextFromB64 decodes plain UTF-8 payloads', async () => {
  const plain = 'אבא\r\nאמא\nדג';
  const b64 = Buffer.from(plain, 'utf8').toString('base64');
  const context = vm.createContext({
    Set,
    Uint8Array,
    TextDecoder,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  });
  vm.runInContext(extractLoaderSnippet(), context);

  const out = await context.decodeDictionaryTextFromB64(b64);
  assert.equal(out, plain);
});

test('embedded startup dictionary decodes and yields a large word set', async () => {
  assert.ok(dictMatch && dictMatch[1], 'Embedded dictionary B64 payload was not found');
  const context = vm.createContext({
    Set,
    Uint8Array,
    TextDecoder,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  });
  vm.runInContext(extractLoaderSnippet(), context);
  const txt = await context.decodeDictionaryTextFromB64(dictMatch[1]);
  const words = txt.split(/\r?\n/).map(w => w.trim()).filter(Boolean);
  assert.ok(words.length >= 40000, `Expected >= 40000 words, got ${words.length}`);
});

test('dictionary loader defines external static dictionary URL', () => {
  assert.ok(dictBaseUrlMatch && dictBaseUrlMatch[1], 'expected DICT_BASE_URL declaration');
  assert.equal(dictBaseUrlMatch[1], './data/dictionary.base.txt');
});
