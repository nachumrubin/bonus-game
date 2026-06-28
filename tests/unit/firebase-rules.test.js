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

  // /dictionarySuggestions was restored (June 2026 re-enablement) to allow
  // any authenticated user to submit word suggestions for admin review.
  // Admins can also update existing suggestions (to approve/reject them).
  assert.ok(rules.dictionarySuggestions, 'dictionarySuggestions path should exist');
  assert.equal(
    rules.dictionarySuggestions.$id['.write'],
    "auth != null && (!data.exists() || root.child('admins').child(auth.uid).val() === true)",
    'suggestion writes should be append-only for users; admins can also update existing entries'
  );

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

test('firebase rules protect the game-debug nodes (admin read, participant append-only)', () => {
  const rulesDoc = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
  const rules = rulesDoc.rules || {};
  const ADMIN_READ = "auth != null && root.child('admins').child(auth.uid).val() === true";

  for (const node of ['gameEvents', 'gameSnapshots', 'clientSnapshots', 'debugWarnings', 'debugReports', 'debugGameIndex']) {
    assert.ok(rules[node], `${node} path should exist`);
    assert.equal(rules[node]['.read'], ADMIN_READ, `${node} should be admin-read only`);
  }

  // Append-only for events/snapshots/warnings, restricted to room participants.
  for (const [node, idKey] of [['gameEvents', '$eventId'], ['gameSnapshots', '$version'], ['debugWarnings', '$warningId']]) {
    const w = rules[node].$gameId[idKey]['.write'];
    assert.match(w, /!data\.exists\(\)/, `${node} writes should be append-only`);
    assert.match(w, /players'\)\.child\('0'\)\.child\('uid'\)/, `${node} writes should require a room participant`);
  }

  // clientSnapshots: a player may only write under their OWN slot.
  const cs = rules.clientSnapshots.$gameId.$slot.$id['.write'];
  assert.match(cs, /!data\.exists\(\)/);
  assert.equal(
    cs,
    "auth != null && !data.exists() && auth.uid === root.child('rooms').child($gameId).child('players').child($slot).child('uid').val()",
    'clientSnapshots write must bind auth.uid to the $slot player'
  );

  // debugReports: any authenticated user may file, append-only.
  assert.equal(rules.debugReports.$reportId['.write'], 'auth != null && !data.exists()');
});
