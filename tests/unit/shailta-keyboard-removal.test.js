const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('מילון overlay relies on text input without virtual keyboard markup', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'partials', 'screens', 'shailta-overlay.html'), 'utf8');

  assert.match(html, /<div class="ovt">מילון<\/div>/);
  assert.match(html, /id="shin" type="text"/);
  assert.doesNotMatch(html, /id="hkb"/);
  assert.doesNotMatch(html, /function buildKB\(/);
  assert.doesNotMatch(html, /function kbPress\(/);
});

test('מילון toolbar button no longer uses keyboard icon', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'partials', 'screens', 'game.html'), 'utf8');

  assert.match(html, /openShailta\(\)/);
  assert.match(html, /<span class="tb-ic">📖<\/span><span class="tb-tx">מילון<\/span>/);
  assert.doesNotMatch(html, /<span class="tb-ic">⌨️<\/span><span class="tb-tx">מילון<\/span>/);
});


test('החלפת אות overlay uses larger tile dimensions', () => {
  const root = path.join(__dirname, '..', '..');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

  assert.match(css, /#exch-rack \.bt2\{width:72px;height:72px;flex:none;\}/);
  assert.match(css, /#exch-rack \.bt2-l\{font-size:30px;\}/);
});
