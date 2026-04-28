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

test('dictionary UI keeps basic suggestion area and advanced-settings entrypoint', () => {
  assert.match(source, /dict-main-section/, 'expected main dictionary section');
  assert.match(source, /openDictionaryAdvancedSettings\(\)/, 'expected advanced settings entrypoint');
  assert.match(source, /dict-admin-login-panel/, 'expected admin login panel');
});

test('admin suggestion list filters previously rejected words', () => {
  assert.match(source, /fbRef\('dictionaryRejected'\)\.get\(\)/, 'expected rejected list query');
  assert.match(source, /!rejectedWords\.has\(entry\.word\)/, 'expected rejected-word filtering');
});

test('admin decision requires confirmation before irreversible action', () => {
  assert.match(source, /dict-admin-confirm/, 'expected confirmation panel markup');
  assert.match(source, /confirmDictionaryDecision\(\)/, 'expected explicit confirmation action');
});
