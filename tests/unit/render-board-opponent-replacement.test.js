const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('renderBoard defines opRep for regular board cells before using it', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(
    html,
    /const opRep = window\._opponentLiveReplacement && window\._opponentLiveReplacement\.r===r && window\._opponentLiveReplacement\.c===c[\s\S]*?\}\s*else if \(opRep\)/,
    'expected renderBoard to compute regular-cell opRep before the opRep render branch'
  );
});
