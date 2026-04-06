const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('שאילתא overlay relies on text input without virtual keyboard markup', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /<div class="ovt">שאילתא — מילון<\/div>/);
  assert.match(html, /id="shin" type="text"/);
  assert.doesNotMatch(html, /id="hkb"/);
  assert.doesNotMatch(html, /function buildKB\(/);
  assert.doesNotMatch(html, /function kbPress\(/);
});

test('שאילתא toolbar button no longer uses keyboard icon', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /openShailta\(\)/);
  assert.match(html, /<span class="tb-ic">📖<\/span><span class="tb-tx">שאילתא<\/span>/);
  assert.doesNotMatch(html, /<span class="tb-ic">⌨️<\/span><span class="tb-tx">שאילתא<\/span>/);
});
