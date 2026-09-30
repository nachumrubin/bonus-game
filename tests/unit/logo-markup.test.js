const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('home logo is built from the four wood tiles spelling בוסט', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'partials', 'screens', 'home.html'), 'utf8');

  // screenTransitions animates `.hlogo` on entry — the wrapper must remain.
  assert.match(html, /<div class="hlogo"[^>]*>/);
  const letters = [...html.matchAll(/<span class="hl-l">(.)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(letters, ['ב', 'ו', 'ס', 'ט']);
  assert.match(html, /aria-label="בוסט"/);

  // Ensure the old inline SVG shell is not expected anymore.
  assert.doesNotMatch(html, /class="boost-logo" viewBox="0 0 2048 952"/);
});
