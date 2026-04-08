const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const INDEX_FILE = 'index.html';

test('manifest start_url uses a fully qualified URL', () => {
  const html = fs.readFileSync(INDEX_FILE, 'utf8');

  assert.match(
    html,
    /var manifestStartUrl = \(window\.location\.origin && window\.location\.origin !== 'null'\)[\s\S]*window\.location\.href\.split\('#'\)\[0\];/,
    'manifestStartUrl should derive an absolute URL from window.location'
  );

  assert.match(
    html,
    /start_url:\s*manifestStartUrl,/
  );

  assert.doesNotMatch(
    html,
    /start_url:\s*['"]\.['"],/,
    'start_url should not use a dot-relative path in blob manifest mode'
  );
});
