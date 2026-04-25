const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const JS_FILE = 'game.js';

test('manifest start_url uses a fully qualified URL', () => {
  const js = fs.readFileSync(JS_FILE, 'utf8');

  assert.match(
    js,
    /var manifestStartUrl = \(window\.location\.origin && window\.location\.origin !== 'null'\)[\s\S]*window\.location\.href\.split\('#'\)\[0\];/,
    'manifestStartUrl should derive an absolute URL from window.location'
  );

  assert.match(
    js,
    /start_url:\s*manifestStartUrl,/
  );

  assert.doesNotMatch(
    js,
    /start_url:\s*['"]\.['"],/,
    'start_url should not use a dot-relative path in blob manifest mode'
  );
});
