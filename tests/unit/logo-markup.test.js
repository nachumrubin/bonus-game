const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('home logo uses svg asset-style wordmark markup', () => {
  const htmlPath = path.join(__dirname, '..', '..', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.match(html, /class="hlogo-mark"/);
  assert.match(html, /id="logoGold"/);
  assert.match(html, /class="bolt-disc"/);
  assert.match(html, /class="bolt-shape"/);
  assert.match(html, /<text class="glyph" x="28" y="96">ב<\/text>/);
});
