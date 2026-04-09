const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const INDEX_FILE = 'index.html';

test('index suppresses known extension async message-channel rejection noise', () => {
  const html = fs.readFileSync(INDEX_FILE, 'utf8');

  assert.match(html, /window\.addEventListener\('unhandledrejection', function\(e\)\{/);
  assert.match(html, /A listener indicated an asynchronous response by returning true/);
  assert.match(html, /message channel closed before a response was received/);
  assert.match(html, /e\.preventDefault\(\);/);
});
