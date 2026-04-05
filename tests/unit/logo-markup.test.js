const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('home logo uses inline provided svg markup', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /class="logo-container"/);
  assert.match(html, /class="boost-logo" viewBox="0 0 420 120"/);
  assert.match(html, /linearGradient id="logo-gold"/);
  assert.match(html, /text-anchor="end"/);
  assert.match(html, />\s*בוסט\s*<\/text>/);
  assert.doesNotMatch(html, /src="\.\/assets\/boost-logo\.svg"/);
});
