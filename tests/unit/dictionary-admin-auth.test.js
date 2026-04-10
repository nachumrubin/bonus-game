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

test('dictionary UI exposes separate suggest/admin tabs', () => {
  assert.match(source, /dict-tab-suggest-panel/, 'expected suggest tab panel');
  assert.match(source, /dict-tab-admin-panel/, 'expected admin tab panel');
  assert.match(source, /switchDictionaryTab\('admin'\)/, 'expected explicit admin tab switching');
});

test('admin suggestion list filters previously rejected words', () => {
  assert.match(source, /fbRef\('dictionaryRejected'\)\.get\(\)/, 'expected rejected list query');
  assert.match(source, /!rejectedWords\.has\(entry\.word\)/, 'expected rejected-word filtering');
});
