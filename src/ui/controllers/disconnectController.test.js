import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { CMD } from '../../events/commands.js';
import { DISCONNECT_INTENT, DISCONNECT_OPEN, DISCONNECT_CLOSE } from '../screens/disconnectScreen.js';
import { createDisconnectController, isPresenceOnline } from './disconnectController.js';

function makeSession() {
  const dispatched = [];
  return {
    mySlot: 0,
    state: {
      mode: 'random-live',
      currentTurnSlot: 0,
      players: { 0: { uid: 'me', displayName: 'Me' }, 1: { uid: 'opp', displayName: 'Opp' } },
    },
    dispatch(cmd) { dispatched.push(cmd); },
    dispatched,
  };
}

test('isPresenceOnline: connected:false is authoritative (no lastSeen grace)', () => {
  // Firebase onDisconnect cleared the flag — opponent is gone, don't wait.
  assert.equal(isPresenceOnline({ connected: false, lastSeen: 900 }, 1_000, 200), false);
  assert.equal(isPresenceOnline({ connected: false, lastSeen: 100 }, 1_000, 200), false);
});

test('isPresenceOnline: connected:true returns true regardless of lastSeen', () => {
  assert.equal(isPresenceOnline({ connected: true }, 1_000), true);
  assert.equal(isPresenceOnline({ connected: true, lastSeen: 0 }, 1_000), true);
});

test('isPresenceOnline: backgrounded:true means alive but paused', () => {
  // Mobile tab backgrounded → throttled heartbeat. Don't fire disconnect overlay;
  // the missed-turns forfeit handles long absences instead.
  assert.equal(isPresenceOnline({ backgrounded: true, connected: false, lastSeen: 0 }, 1_000_000, 1000), true);
  assert.equal(isPresenceOnline({ backgrounded: true, connected: true }, 1_000), true);
});

test('isPresenceOnline: missing connected falls back to lastSeen grace', () => {
  // Legacy / partial entries without a connected field — keep grace fallback.
  assert.equal(isPresenceOnline({ lastSeen: 900 }, 1_000, 200), true);
  assert.equal(isPresenceOnline({ lastSeen: 100 }, 1_000, 200), false);
});

test('offline opponent opens disconnect overlay; online closes it', () => {
  bus._reset();
  const session = makeSession();
  let presenceCb = null;
  let opened = 0;
  let closed = 0;
  bus.on(DISCONNECT_OPEN, (p) => {
    opened++;
    assert.equal(p.opponentName, 'Opp');
  });
  bus.on(DISCONNECT_CLOSE, () => { closed++; });
  const ctl = createDisconnectController({
    bus,
    dbRef: () => ({}),
    sessionRef: () => session,
    watchPresence: (db, uid, cb) => {
      assert.equal(uid, 'opp');
      presenceCb = cb;
      return () => {};
    },
    now: () => 10_000,
    graceMs: 1_000,
  });
  presenceCb({ connected: false, lastSeen: 1 });
  presenceCb({ connected: true, lastSeen: 10_000 });
  assert.equal(opened, 1);
  assert.equal(closed, 1);
  ctl.dispose();
});

test('AUTO_WIN resigns opponent slot', () => {
  bus._reset();
  const session = makeSession();
  const ctl = createDisconnectController({
    bus,
    dbRef: () => ({}),
    sessionRef: () => session,
    watchPresence: () => () => {},
  });
  bus.emit(DISCONNECT_INTENT.AUTO_WIN, {});
  assert.equal(session.dispatched[0].type, CMD.RESIGN_GAME);
  assert.equal(session.dispatched[0].payload.slot, 1);
  ctl.dispose();
});
