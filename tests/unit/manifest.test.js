const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const INDEX_FILE = 'index.html';
const MANIFEST_FILE = 'manifest.json';

test('index links the static web manifest', () => {
  const html = fs.readFileSync(INDEX_FILE, 'utf8');

  assert.match(html, /<link rel="manifest" href="manifest\.json">/);
  assert.doesNotMatch(html, /manifestStartUrl/);
});

test('manifest start_url remains app-relative', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));

  assert.equal(manifest.start_url, './');
});
