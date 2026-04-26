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

  assert.match(css, /#sg,\s*\.game-screen\s*\{[^}]*height:\s*100vh;[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.game-area,\s*\.game-main\s*\{[^}]*flex:\s*1;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*var\(--side-panel-w\) var\(--board-size\) var\(--side-panel-w\);[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.bot,\s*\.rack-bar\s*\{[^}]*flex-shrink:\s*0;[^}]*position:\s*relative;[^}]*height:\s*var\(--rack-h\);/s);
  assert.match(html, /class="bot rack-bar"/);
});

test('board area uses bounded square container and JS computes from board-area bounds', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');

  assert.match(css, /--board-size:\s*min\(/s);
  assert.match(css, /\.board-area\s*\{[^}]*width:\s*var\(--board-size\);[^}]*height:\s*var\(--board-size\);/s);
  assert.match(js, /const boardAreaH = boardArea\.clientHeight;/);
  assert.match(js, /const boardAreaW = boardArea\.clientWidth;/);
  assert.match(js, /const S = Math\.min\(boardAreaH - 8, boardAreaW - 8, 620\);/);
});
