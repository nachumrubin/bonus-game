import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const RULES_FILE = ['firebase', 'database', 'rules', 'json'].join('.');

function rules() {
  return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')).rules;
}

function canWriteV2Room({ authUid, players, schemaVersion = 2, dataExists = false, currentTurnSlot = 0, oldVersion = 1, newVersion = 2 } = {}) {
  return !!authUid &&
    schemaVersion === 2 &&
    (authUid === players?.[0]?.uid || authUid === players?.[1]?.uid) &&
    (!dataExists || (newVersion === oldVersion + 1 && authUid === players?.[currentTurnSlot]?.uid));
}

test('room write rule requires authenticated v2 room participant and current-turn authority', () => {
  const expr = rules().rooms.$roomId['.write'];
  assert.equal(
    expr,
    "auth != null && newData.child('schemaVersion').val() === 2 && (auth.uid === newData.child('players/0/uid').val() || auth.uid === newData.child('players/1/uid').val()) && (!data.exists() || (newData.child('version').val() === data.child('version').val() + 1 && auth.uid === data.child('players').child(data.child('currentTurnSlot').val()).child('uid').val()))",
  );

  const players = { 0: { uid: 'a' }, 1: { uid: 'b' } };
  assert.equal(canWriteV2Room({ authUid: 'a', players }), true, 'room creation by participant');
  assert.equal(canWriteV2Room({ authUid: 'a', players, dataExists: true, currentTurnSlot: 0 }), true);
  assert.equal(canWriteV2Room({ authUid: 'b', players, dataExists: true, currentTurnSlot: 0 }), false);
  assert.equal(canWriteV2Room({ authUid: 'a', players, dataExists: true, currentTurnSlot: 0, oldVersion: 1, newVersion: 3 }), false);
  assert.equal(canWriteV2Room({ authUid: 'c', players }), false);
  assert.equal(canWriteV2Room({ authUid: null, players }), false);
  assert.equal(canWriteV2Room({ authUid: 'a', players, schemaVersion: 1 }), false);
});

test('room side-channel writes remain participant-scoped', () => {
  const roomRules = rules().rooms.$roomId;
  assert.equal(
    roomRules.ready.$slot['.write'],
    "auth != null && auth.uid === root.child('rooms').child($roomId).child('players').child($slot).child('uid').val()",
  );
  const participantExpr = "auth != null && (auth.uid === root.child('rooms').child($roomId).child('players').child('0').child('uid').val() || auth.uid === root.child('rooms').child($roomId).child('players').child('1').child('uid').val())";
  assert.equal(roomRules.settings['.write'], participantExpr);
  assert.equal(roomRules.livePreview['.write'], participantExpr);
  assert.equal(roomRules.status['.write'], participantExpr);
  assert.equal(
    roomRules.players.$slot.oneSignalSubId['.write'],
    "auth != null && auth.uid === root.child('rooms').child($roomId).child('players').child($slot).child('uid').val()",
  );
});

test('dictionary moderation rules require an /admins/{uid} whitelist entry', () => {
  const r = rules();
  const adminGate = "auth != null && root.child('admins').child(auth.uid).val() === true";
  assert.equal(r.dictionarySuggestions.$suggestionId['.write'], 'auth != null');
  assert.equal(r.dictionaryApproved.$word['.write'], adminGate);
  assert.equal(r.dictionaryRejected.$id['.write'], adminGate);
  // /admins itself is self-gated — only existing admins can add new admins.
  // Bootstrap the first admin uid manually via the Firebase Console.
  assert.equal(r.admins['.read'], 'auth != null');
  assert.equal(r.admins.$uid['.write'], adminGate);
});

test('ratings leaderboard is public read and indexed by rating', () => {
  const r = rules().globalRatings;
  assert.equal(r['.read'], true);
  assert.deepEqual(r['.indexOn'], ['rating']);
  assert.equal(r.$uid['.write'], 'auth != null');
  assert.match(r.$uid['.validate'], /rating/);
});

test('presence and matchmaking writes are scoped to authenticated uid', () => {
  const r = rules();
  assert.equal(r.presence.$uid['.write'], 'auth != null && auth.uid === $uid');
  assert.equal(r.matchmakingQueue.$mode.$uid['.write'], 'auth != null && (auth.uid === $uid || !newData.exists())');
});
