const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('home logo uses inline provided svg markup', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /class="logo-container"/);
  assert.match(html, /class="boost-logo" viewBox="0 0 320 120"/);
  assert.match(html, /class="st0" d="M250 20 h60 v70 h-50 v15 h55 v15 h-70 v-100 z"/);
  assert.match(html, /fill-rule="evenodd"/);
  assert.doesNotMatch(html, /src="\.\/assets\/boost-logo\.svg"/);
});
