const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('jcConfirm initializes Firebase when join-by-code opens from invite deep-link path', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(
    html,
    /async function jcConfirm\(\)\{\s*if\(!fbDb\)\{\s*await new Promise\(function\(res\)\{ loadFirebaseSDK\(res\); \}\);\s*initFirebase\(\);\s*\}/,
    'expected jcConfirm to ensure Firebase is initialized before reading room code state'
  );
});
