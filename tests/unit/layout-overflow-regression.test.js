const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

test('player panel and timer styles enforce non-overflow sizing', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  assert.match(css, /\.player-card\s*\{[^}]*width:\s*150px;[^}]*min-width:\s*150px;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.player-avatar\s*\{[^}]*width:\s*86px;[^}]*height:\s*86px;[^}]*max-width:\s*100%;/s);
  assert.match(css, /\.score-box,.timer-box\s*\{[^}]*width:\s*100%;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.score-label\{[^}]*font-size:\s*14px;[^}]*white-space:\s*nowrap;/s);
  assert.match(css, /\.player-timer\s*\{[^}]*font-size:\s*28px;[^}]*white-space:\s*nowrap;/s);
});

test('game screen layout keeps rack in normal flow below board', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(css, /#sg,\s*\.game-screen\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.game-area,\s*\.game-main\s*\{[^}]*flex:\s*1;[^}]*padding:[^}]*16px[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.bot,\s*\.rack-bar\s*\{[^}]*flex-shrink:\s*0;[^}]*position:\s*relative;|\.bot,\s*\.rack-bar\s*\{[^}]*position:\s*relative;[^}]*flex-shrink:\s*0;/s);
  assert.match(html, /class="bot rack-bar"/);
});
