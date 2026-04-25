const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('שאילתה overlay relies on text input without virtual keyboard markup', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');

  assert.match(html, /<div class="ovt">שאילתה — מילון<\/div>/);
  assert.match(html, /id="shin" type="text"/);
  assert.doesNotMatch(html, /id="hkb"/);
  assert.doesNotMatch(js, /function buildKB\(/);
  assert.doesNotMatch(js, /function kbPress\(/);
});

test('שאילתה toolbar button no longer uses keyboard icon', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /openShailta\(\)/);
  assert.match(html, /<span class="tb-ic">📖<\/span><span class="tb-tx">שאילתה<\/span>/);
  assert.doesNotMatch(html, /<span class="tb-ic">⌨️<\/span><span class="tb-tx">שאילתה<\/span>/);
});


test('החלפת אות overlay uses larger tile dimensions', () => {
  const root = path.join(__dirname, '..', '..');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  assert.match(css, /#exch-rack \.bt2\{width:54px;height:64px;\}/);
  assert.match(css, /#exch-rack \.bt2-l\{font-size:28px;\}/);
});
