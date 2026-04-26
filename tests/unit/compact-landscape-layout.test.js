const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

function getCompactLandscapeBlock(css) {
  const marker = '@media (max-height: 520px) and (orientation: landscape) {';
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, 'compact landscape media query must exist');

  let depth = 0;
  let end = -1;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  assert.notEqual(end, -1, 'compact landscape media query must have closing brace');
  return css.slice(start, end + 1);
}

test('compact landscape uses required grid rows and in-flow rack', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const block = getCompactLandscapeBlock(css);

  assert.match(block, /\.game-screen\s*\{[\s\S]*height:\s*100dvh;[\s\S]*display:\s*grid;[\s\S]*grid-template-rows:\s*52px 24px 1fr 74px;[\s\S]*overflow:\s*hidden;/s);
  assert.match(block, /\.top-hud\s*\{[\s\S]*grid-row:\s*1;[\s\S]*height:\s*52px;/s);
  assert.match(block, /\.status-row\s*\{[\s\S]*grid-row:\s*2;[\s\S]*height:\s*24px;/s);

  assert.match(block, /\.game-main\s*\{[\s\S]*grid-row:\s*3;[\s\S]*min-height:\s*0;[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*100px minmax\(0, 1fr\) 100px;[\s\S]*gap:\s*10px;[\s\S]*overflow:\s*hidden;/s);
  assert.match(block, /\.rack-bar\s*\{[\s\S]*grid-row:\s*4;[\s\S]*height:\s*74px;[\s\S]*position:\s*static\s*!important;[\s\S]*margin:\s*0 10px 4px;/s);
  assert.doesNotMatch(block, /\.rack-bar\s*\{[\s\S]*position:\s*(fixed|absolute)/s);
});

test('compact landscape constrains board and side panels with required dimensions', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const block = getCompactLandscapeBlock(css);

  assert.match(block, /\.board-area\s*\{[\s\S]*width:\s*min\(100%, calc\(100dvh - 52px - 24px - 74px - 18px\)\);[\s\S]*height:\s*min\(100%, calc\(100dvh - 52px - 24px - 74px - 18px\)\);[\s\S]*aspect-ratio:\s*1 \/ 1;[\s\S]*transform:\s*none\s*!important;[\s\S]*position:\s*relative;/s);
  assert.match(block, /\.board-grid\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;[\s\S]*aspect-ratio:\s*1 \/ 1;/s);
  assert.match(block, /\.player-panel\s*\{[\s\S]*width:\s*100px;[\s\S]*max-height:\s*100%;[\s\S]*padding:\s*4px;[\s\S]*overflow:\s*hidden;/s);
  assert.match(block, /\.player-avatar,[\s\S]*\.player-panel \.avatar\s*\{[\s\S]*width:\s*42px;[\s\S]*height:\s*42px;/s);
});
