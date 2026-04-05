const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('home logo uses inline provided svg markup', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /class="logo-container"/);
  assert.match(html, /class="boost-logo" viewBox="0 0 520 180"/);
  assert.match(html, /linearGradient id="logo-gold"/);
  assert.match(html, /filter id="logo-shadow"/);
  assert.match(html, /<circle cx="300" cy="95" r="56" fill="url\(#logo-gold\)"\/>/);
  assert.match(html, /M301 49L274 95h20l-18 42 50-58h-22l21-30z/);
  assert.doesNotMatch(html, /src="\.\/assets\/boost-logo\.svg"/);
});
