const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('game.js', 'utf8');

test('dictionary admin login uses email/password auth', () => {
  assert.match(js, /signInWithEmailAndPassword\(/, 'expected email/password sign-in for admin login');
});

test('dictionary admin status derives from admin custom claim', () => {
  assert.match(js, /getIdTokenResult\(true\)/, 'expected token refresh for latest custom claims');
  assert.match(js, /claims\.admin === true/, 'expected admin custom claim check');
});

test('dictionary UI keeps basic suggestion area and advanced-settings entrypoint', () => {
  assert.match(html, /dict-main-section/, 'expected main dictionary section');
  assert.match(js, /openDictionaryAdvancedSettings\(\)/, 'expected advanced settings entrypoint');
  assert.match(html, /dict-admin-login-panel/, 'expected admin login panel');
});

test('admin suggestion list filters previously rejected words', () => {
  assert.match(js, /fbRef\('dictionaryRejected'\)\.get\(\)/, 'expected rejected list query');
  assert.match(js, /!rejectedWords\.has\(entry\.word\)/, 'expected rejected-word filtering');
});

test('admin decision requires confirmation before irreversible action', () => {
  assert.match(html, /dict-admin-confirm/, 'expected confirmation panel markup');
  assert.match(js, /confirmDictionaryDecision\(\)/, 'expected explicit confirmation action');
});
