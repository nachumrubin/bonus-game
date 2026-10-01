const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('home + login logo is the Blender render of the בוסט wood tiles', () => {
  const root = path.join(__dirname, '..', '..');
  for (const file of ['home.html', 'log-in-screen.html']) {
    const html = fs.readFileSync(path.join(root, 'partials', 'screens', file), 'utf8');

    // screenTransitions animates `.hlogo` on entry — the wrapper must remain.
    assert.match(html, /<div class="hlogo[^"]*" role="img" aria-label="בוסט">/, file);
    assert.match(html, /<img class="hl-img" src="assets\/ui\/boost-logo\.webp"/, file);

    // The CSS-built tiles and the old inline SVG shell are gone.
    assert.doesNotMatch(html, /class="hl-tile"/, file);
    assert.doesNotMatch(html, /class="boost-logo" viewBox="0 0 2048 952"/, file);
  }
  assert.ok(fs.existsSync(path.join(root, 'assets', 'ui', 'boost-logo.webp')));
});
