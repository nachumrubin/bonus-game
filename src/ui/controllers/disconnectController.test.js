import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { CMD } from '../../events/commands.js';
import { DISCONNECT_INTENT, DISCONNECT_OPEN, DISCONNECT_CLOSE } from '../screens/disconnectScreen.js';
import { createDisconnectController, isPresenceOnline, isAppClosed } from './disconnectController.js';

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

test('isPresenceOnline: backgrounded:true + connected:true means alive but paused', () => {
  // Mobile tab backgrounded with WebSocket still alive → throttled heartbeat
  // but game is still open. No disconnect overlay; the missed-turns forfeit
  // handles long absences instead.
  assert.equal(isPresenceOnline({ backgrounded: true, connected: true }, 1_000), true);
});

test('isPresenceOnline: backgrounded:true + connected:false is app-close (returns offline)', () => {
  // visibilitychange writes backgrounded:true, then Firebase onDisconnect
  // fires connected:false. The closed-flag wins over the backgrounded flag
  // so the disconnect path can route to AUTO_WIN via isAppClosed().
  assert.equal(isPresenceOnline({ backgrounded: true, connected: false, lastSeen: 0 }, 1_000_000, 1000), false);
});

test('isPresenceOnline: missing connected falls back to lastSeen grace', () => {
  // Legacy / partial entries without a connected field — keep grace fallback.
  assert.equal(isPresenceOnline({ lastSeen: 900 }, 1_000, 200), true);
  assert.equal(isPresenceOnline({ lastSeen: 100 }, 1_000, 200), false);
});

test('offline opponent opens disconnect overlay after grace elapses; online closes it', () => {
  bus._reset();
  const session = makeSession();
  let presenceCb = null;
  let opened = 0;
  let closed = 0;
  // The controller accumulates elapsed time across presence callbacks. Mock
  // `now` advancing so the grace period actually passes between the first
  // offline event and the second.
  let mockNow = 10_000;
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
    now: () => mockNow,
    graceMs: 1_000,
  });
  // First offline event — anchors disconnectStart at mockNow = 10_000.
  presenceCb({ connected: false, lastSeen: 1 });
  assert.equal(opened, 0, 'overlay does not open until grace has elapsed');

  // Advance time past the grace window, then re-emit the same offline state.
  mockNow = 12_000; // 2s elapsed > graceMs (1s)
  presenceCb({ connected: false, lastSeen: 1 });
  assert.equal(opened, 1, 'overlay opens once accumulated elapsed >= grace');

  // Opponent comes back online — overlay closes.
  presenceCb({ connected: true, lastSeen: mockNow });
  assert.equal(closed, 1);
  ctl.dispose();
});

// ── App-close detection (GAP_REPORT item 9) ──────────────────────────
// Deliberate quit: visibilitychange writes backgrounded:true, then Firebase
// onDisconnect fires connected:false. isAppClosed must distinguish this
// from a generic disconnect so the controller can route to immediate
// AUTO_WIN (bypassing the 30s grace).
test('isAppClosed: returns true only for backgrounded:true + connected:false', () => {
  assert.equal(isAppClosed({ backgrounded: true, connected: false }), true);
  // Either field alone doesn't qualify
  assert.equal(isAppClosed({ backgrounded: true, connected: true }), false, 'still alive in background');
  assert.equal(isAppClosed({ backgrounded: false, connected: false }), false, 'generic disconnect, not app-close');
  assert.equal(isAppClosed({}), false);
  assert.equal(isAppClosed(null), false);
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
