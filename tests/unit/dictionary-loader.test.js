const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('index.html', 'utf8');

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
