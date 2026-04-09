const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const INDEX_FILE = 'index.html';

test('service worker registration promotes waiting worker and reloads on controller change', () => {
  const html = fs.readFileSync(INDEX_FILE, 'utf8');

  assert.match(html, /function setupServiceWorkerLifecycle\(reg\)/);
  assert.match(html, /reg\.waiting\.postMessage\(\{type: 'SKIP_WAITING'\}\);/);
  assert.match(html, /reg\.addEventListener\('updatefound', function\(\)\{/);
  assert.match(html, /navigator\.serviceWorker\.addEventListener\('controllerchange', function\(\)\{/);
  assert.match(html, /window\.location\.reload\(\);/);
});
