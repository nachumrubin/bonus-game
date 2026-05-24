import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE_ONLINE_SESSION_KEY,
  clearActiveOnlineSession,
  readActiveOnlineSession,
  saveActiveOnlineSession,
} from './sessionPersistence.js';

function storage() {
  const data = new Map();
  return {
    setItem(k, v) { data.set(k, String(v)); },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    removeItem(k) { data.delete(k); },
    _data: data,
  };
}

test('saveActiveOnlineSession stores only roomId + userId', () => {
  const s = storage();
  assert.equal(saveActiveOnlineSession(s, { roomId: 'r1', userId: 'u1', extra: 'ignored' }), true);
  assert.deepEqual(JSON.parse(s.getItem(ACTIVE_ONLINE_SESSION_KEY)), { roomId: 'r1', userId: 'u1' });
});

test('readActiveOnlineSession tolerates missing or malformed values', () => {
  const s = storage();
  assert.equal(readActiveOnlineSession(s), null);
  s.setItem(ACTIVE_ONLINE_SESSION_KEY, '{bad json');
  assert.equal(readActiveOnlineSession(s), null);
  s.setItem(ACTIVE_ONLINE_SESSION_KEY, JSON.stringify({ roomId: 'r1' }));
  assert.equal(readActiveOnlineSession(s), null);
});

test('readActiveOnlineSession round-trips and clear removes it', () => {
  const s = storage();
  saveActiveOnlineSession(s, { roomId: 'r2', userId: 'u2' });
  assert.deepEqual(readActiveOnlineSession(s), { roomId: 'r2', userId: 'u2' });
  clearActiveOnlineSession(s);
  assert.equal(readActiveOnlineSession(s), null);
});
