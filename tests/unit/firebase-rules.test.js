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

  // /dictionarySuggestions was removed in June 2026 along with the
  // suggest→review pipeline. Admins now write directly to approved/rejected.
  assert.equal(rules.dictionarySuggestions, undefined,
    'dictionarySuggestions path should be removed (legacy suggest→review pipeline)');

  assert.ok(rules.dictionaryApproved, 'dictionaryApproved path should exist');
  assert.equal(
    rules.dictionaryApproved.$word['.write'],
    "auth != null && root.child('admins').child(auth.uid).val() === true",
    'approved dictionary writes should require an entry in /admins/$uid'
  );

  assert.ok(rules.dictionaryRejected, 'dictionaryRejected path should exist');
  assert.equal(
    rules.dictionaryRejected.$id['.write'],
    "auth != null && root.child('admins').child(auth.uid).val() === true",
    'rejected dictionary writes should require an entry in /admins/$uid'
  );
});
