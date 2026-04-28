const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function setupFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-build-'));
  const scriptsDir = path.join(tempDir, 'scripts');
  fs.mkdirSync(scriptsDir);

  fs.copyFileSync('scripts/stamp-build.js', path.join(scriptsDir, 'stamp-build.js'));
  fs.copyFileSync('index.html', path.join(tempDir, 'index.html'));
  fs.copyFileSync('sw.js', path.join(tempDir, 'sw.js'));

  return tempDir;
}

test('stamp-build updates index.html and sw.js to the provided timestamp', () => {
  const fixture = setupFixture();
  const timestamp = '20300102030405';

  execFileSync('node', ['scripts/stamp-build.js', timestamp], {
    cwd: fixture,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  const index = fs.readFileSync(path.join(fixture, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(fixture, 'sw.js'), 'utf8');

  assert.match(index, new RegExp(`<meta name="version" content="${timestamp}">`));
  assert.match(index, new RegExp(`build ${timestamp}</div>`));
  assert.match(index, new RegExp(`navigator\\.serviceWorker\\.register\\('./sw\\.js\\?v=${timestamp}'`));
  assert.match(sw, new RegExp(`var CACHE_NAME = 'boost-${timestamp}'`));

  assert.equal((index.match(new RegExp(timestamp, 'g')) || []).length >= 3, true);
  assert.equal((sw.match(new RegExp(timestamp, 'g')) || []).length, 1);
});
