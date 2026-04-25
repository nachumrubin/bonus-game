const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('index uses external stylesheet and game script while keeping firebase readiness inline', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  assert.match(html, /<script>window\._fbReady=false;<\/script>/);
  assert.match(html, /<link rel="stylesheet" href="style\.css">/);
  assert.match(html, /<script src="game\.js"><\/script>/);
  assert.doesNotMatch(html, /<style>[\s\S]*<\/style>/);
});
