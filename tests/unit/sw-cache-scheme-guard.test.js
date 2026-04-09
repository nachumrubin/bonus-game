const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SW_FILE = 'sw.js';

test('service worker only caches http(s) requests', () => {
  const sw = fs.readFileSync(SW_FILE, 'utf8');

  assert.match(sw, /function isHttpRequest\(request\)/, 'sw.js should centralize request protocol checks');
  assert.match(sw, /new URL\(request\.url\)/, 'sw.js should parse request URL before caching');
  assert.match(
    sw,
    /requestUrl\.protocol === 'http:' \|\| requestUrl\.protocol === 'https:'/,
    'sw.js should allow only http(s) protocols'
  );
  assert.match(sw, /if\(!isHttpRequest\(e\.request\)\) return;/, 'fetch handler should skip unsupported schemes');
});
