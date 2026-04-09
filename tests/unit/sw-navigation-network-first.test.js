const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SW_FILE = 'sw.js';

test('service worker uses network-first strategy for navigations', () => {
  const sw = fs.readFileSync(SW_FILE, 'utf8');

  assert.match(sw, /var isNavigation = e\.request\.mode === 'navigate';/);
  assert.match(sw, /if\(isNavigation\)\{/);
  assert.match(sw, /fetch\(e\.request\)/, 'navigation branch should try network first');
  assert.match(sw, /return cached \|\| caches\.match\('\.\/index\.html'\);/, 'navigation fallback should use cached page or index.html');
});
