const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');

test('dictionary admin login uses email/password auth', () => {
  assert.match(source, /signInWithEmailAndPassword\(/, 'expected email/password sign-in for admin login');
});

test('dictionary admin status derives from admin custom claim', () => {
  assert.match(source, /getIdTokenResult\(true\)/, 'expected token refresh for latest custom claims');
  assert.match(source, /claims\.admin === true/, 'expected admin custom claim check');
});
