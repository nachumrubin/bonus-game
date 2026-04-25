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
  assert.match(css, /\.game-area,\s*\.game-main\s*\{[^}]*flex:\s*1;[^}]*grid-template-columns:\s*170px minmax\(520px, 1fr\) 170px;[^}]*grid-template-areas:\"left board right\";[^}]*column-gap:\s*48px;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.bot,\s*\.rack-bar\s*\{[^}]*flex-shrink:\s*0;[^}]*position:\s*relative;[^}]*height:\s*116px;/s);
  assert.match(html, /class="bot rack-bar"/);
});


test('board area keeps scaling boundary and rack stays in normal flow', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  assert.match(css, /--board-size:\s*min\(58vh, 620px\);/);
  assert.match(css, /\.board-area\s*\{[^}]*max-height:\s*100%;[^}]*transform-origin:\s*center;/s);
  assert.match(css, /\.rack-bar\s*\{[^}]*height:\s*116px;/s);
});


test('computeSizes uses board-area bounds to avoid rack overlap clipping', () => {
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');

  assert.match(js, /const boardAreaH = boardArea\.clientHeight;/);
  assert.match(js, /const boardAreaW = boardArea\.clientWidth;/);
  assert.match(js, /const S = Math\.min\(boardAreaH - 8, boardAreaW - 8, 620\);/);
});
