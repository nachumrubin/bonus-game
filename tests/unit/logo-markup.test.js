const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('home logo uses lightning emblem markup', () => {
  const htmlPath = path.join(__dirname, '..', '..', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.match(html, /class="hlogo-bolt"/);
  assert.match(html, /<svg viewBox="0 0 24 24"/);
  assert.match(html, /class="hlogo-ch">ב<\/span>/);
  assert.match(html, /class="hlogo-ch">ס<\/span>/);
  assert.match(html, /class="hlogo-ch">ט<\/span>/);
});
