import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from './mockFirebase.js';
import { startPresence, watchPresence } from './presenceService.js';

test('startPresence writes fresh timestamps and clears room on stop', async () => {
  const db = makeMockDb();
  let now = 1000;
  const handle = await startPresence(db, {
    uid: 'u1',
    currentRoom: 'room-1',
    serverTimestamp: () => now,
  });

  assert.equal(db._data.presence.u1.connected, true);
  assert.equal(db._data.presence.u1.lastSeen, 1000);
  assert.equal(db._data.presence.u1.currentRoom, 'room-1');

  now = 2000;
  await handle.stop();

  assert.equal(db._data.presence.u1.connected, false);
  assert.equal(db._data.presence.u1.lastSeen, 2000);
  assert.equal(db._data.presence.u1.currentRoom, undefined);
});

test('watchPresence emits offline fallback for missing users and live updates', async () => {
  const db = makeMockDb();
  const seen = [];
  const off = watchPresence(db, 'u2', (presence) => seen.push(presence));

  assert.deepEqual(seen[0], { connected: false, lastSeen: 0 });

  await db.ref('presence/u2').set({ connected: true, lastSeen: 3000 });
  assert.deepEqual(seen.at(-1), { connected: true, lastSeen: 3000 });

  off();
});
