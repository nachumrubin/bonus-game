const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const RULES_FILE = 'firebase.database.rules.json';

test('firebase rules index globalRatings by rating', () => {
  const raw = fs.readFileSync(RULES_FILE, 'utf8');
  const rulesDoc = JSON.parse(raw);

  assert.ok(rulesDoc && typeof rulesDoc === 'object', 'rules file should parse to an object');
  assert.ok(rulesDoc.rules && typeof rulesDoc.rules === 'object', 'rules root should include rules object');

  const ratingsRules = rulesDoc.rules.globalRatings;
  assert.ok(ratingsRules && typeof ratingsRules === 'object', 'globalRatings rules should exist');

  const indexes = ratingsRules['.indexOn'];
  assert.ok(Array.isArray(indexes), '.indexOn should be defined as an array');
  assert.ok(indexes.includes('rating'), '.indexOn should include rating for leaderboard ordering');
  assert.equal(ratingsRules.$uid['.write'], 'auth != null');
});

test('firebase rules include dictionary moderation protections', () => {
  const raw = fs.readFileSync(RULES_FILE, 'utf8');
  const rulesDoc = JSON.parse(raw);
  const rules = rulesDoc.rules || {};

  assert.ok(rules.dictionarySuggestions, 'dictionarySuggestions path should exist');
  assert.equal(
    rules.dictionarySuggestions.$suggestionId['.write'],
    'auth != null',
    'suggestions should require authentication'
  );

  assert.ok(rules.dictionaryApproved, 'dictionaryApproved path should exist');
  assert.equal(
    rules.dictionaryApproved.$word['.write'],
    'auth != null && auth.token.admin === true',
    'approved dictionary writes should require admin custom claim'
  );

  assert.ok(rules.dictionaryRejected, 'dictionaryRejected path should exist');
  assert.equal(
    rules.dictionaryRejected.$id['.write'],
    'auth != null && auth.token.admin === true',
    'rejected dictionary writes should require admin custom claim'
  );
});
