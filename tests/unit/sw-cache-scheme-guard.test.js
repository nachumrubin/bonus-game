const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SW_FILE = 'sw.js';

test('service worker only caches http(s) requests', () => {
  const sw = fs.readFileSync(SW_FILE, 'utf8');

  assert.match(sw, /new URL\(e\.request\.url\)/, 'sw.js should parse request URL before caching');
  assert.match(
    sw,
    /if\(requestUrl\.protocol === 'http:' \|\| requestUrl\.protocol === 'https:'\)/,
    'sw.js should guard cache.put with an http(s) protocol check'
  );
});
