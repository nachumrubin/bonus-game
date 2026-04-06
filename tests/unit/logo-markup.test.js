const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('home logo uses inline provided svg markup', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /class="logo-container"/);
  assert.match(html, /class="boost-logo" viewBox="0 0 2048 952"/);
  assert.match(html, /linearGradient id="logo-bg"/);
  assert.match(html, /linearGradient id="logo-gold"/);
  assert.match(html, /linearGradient id="logo-spark"/);
  assert.match(html, /filter id="logo-shadow"/);
  assert.match(html, /<rect width="2048" height="952" fill="url\(#logo-bg\)"\/>/);
  assert.match(html, /M1908 841l22 37 37 22-37 22-22 37-22-37-37-22 37-22z/);
  assert.doesNotMatch(html, /src="\.\/assets\/boost-logo\.svg"/);
});
