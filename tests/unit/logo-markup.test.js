const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('home logo uses local image asset markup', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /<div class="hlogo">/);
  assert.match(html, /<img src="boost_logo_final\.png" alt="בוסט"/);

  // Ensure the old inline SVG shell is not expected anymore.
  assert.doesNotMatch(html, /class="boost-logo" viewBox="0 0 2048 952"/);
});

test('home logo shell is frameless and home icons are displayed in large cropped format', () => {
  const root = path.join(__dirname, '..', '..');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  assert.match(css, /\.hlogo\{background:transparent;border:0;[^}]*box-shadow:none;/);
  assert.match(css, /\.menu-btn\{width:100%;height:94px;[^}]*font-size:22px;/);
  assert.match(css, /\.menu-btn-icon\{height:80px;width:120px;object-fit:cover;object-position:left center;/);
});
