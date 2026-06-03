// Regression test for bug #2 — flicker false-positive disconnect overlay.
//
// Before the fix, disconnectController accumulated `totalDisconnectedMs`
// across reconnect/disconnect cycles without resetting on reconnect. Brief
// WebSocket blips (mobile network switch, background-tab throttle, slow
// Wi-Fi, Firebase WebSocket reconnect) summed up over a long game and
// triggered DISCONNECT_OPEN even though the opponent was online the whole
// time from their own perspective. Strict continuous-offline semantics:
// only an uninterrupted offline span > graceMs opens the overlay.

const test = require('node:test');
const assert = require('node:assert/strict');

let modulesPromise;
function loadModules() {
  modulesPromise ??= (async () => {
    const [busMod, ctlMod, screenMod] = await Promise.all([
      import('../../src/events/bus.js'),
      import('../../src/ui/controllers/disconnectController.js'),
      import('../../src/ui/screens/disconnectScreen.js'),
    ]);
    return {
      bus: busMod,
      createDisconnectController: ctlMod.createDisconnectController,
      DISCONNECT_OPEN: screenMod.DISCONNECT_OPEN,
      DISCONNECT_CLOSE: screenMod.DISCONNECT_CLOSE,
    };
  })();
  return modulesPromise;
}

function makeSession() {
  return {
    mySlot: 0,
    state: {
      mode: 'random-live',
      currentTurnSlot: 0,
      players: { 0: { uid: 'me' }, 1: { uid: 'opp' } },
    },
    dispatch() {},
  };
}

test('flicker pattern (brief blips with reconnects) does NOT accumulate to false-positive overlay', async () => {
  const { bus, createDisconnectController, DISCONNECT_OPEN } = await loadModules();
  bus._reset();
  const session = makeSession();
  let presenceCb = null;
  let opened = 0;
  let mockNow = 10_000;
  bus.on(DISCONNECT_OPEN, () => { opened++; });
  const ctl = createDisconnectController({
    bus, dbRef: () => ({}), sessionRef: () => session,
    watchPresence: (db, uid, cb) => { presenceCb = cb; return () => {}; },
    now: () => mockNow,
    graceMs: 1_000,
  });

  // Simulate 5 brief offlines (600ms each — under graceMs) interleaved with
  // brief online reconnects (300ms each). Each individual offline span is
  // SHORTER than graceMs (1000ms), but cumulative offline = 3000ms — well
  // past grace. Under the old accumulating behavior this would have fired
  // DISCONNECT_OPEN at least once.
  for (let i = 0; i < 5; i++) {
    presenceCb({ connected: false, lastSeen: 1 });
    mockNow += 600;
    presenceCb({ connected: true, lastSeen: mockNow });
    mockNow += 300;
  }
  assert.equal(opened, 0,
    'overlay must NOT fire for brief flickers (each shorter than grace) even if cumulative offline > grace');
  ctl.dispose();
});

test('continuous offline > grace still opens the overlay (sanity check the fix did not kill the actual feature)', async () => {
  const { bus, createDisconnectController, DISCONNECT_OPEN } = await loadModules();
  bus._reset();
  const session = makeSession();
  let presenceCb = null;
  let opened = 0;
  let mockNow = 10_000;
  bus.on(DISCONNECT_OPEN, () => { opened++; });
  const ctl = createDisconnectController({
    bus, dbRef: () => ({}), sessionRef: () => session,
    watchPresence: (db, uid, cb) => { presenceCb = cb; return () => {}; },
    now: () => mockNow,
    graceMs: 1_000,
  });
  presenceCb({ connected: false, lastSeen: 1 });   // start of offline span
  mockNow += 1_500;                                 // 1.5s offline (>grace)
  presenceCb({ connected: false, lastSeen: 1 });   // still offline
  assert.equal(opened, 1, 'continuous offline > grace must still open overlay');
  ctl.dispose();
});

test('overlay-open countdown still uses cumulative time (flicker after overlay open does not grant extra grace)', async () => {
  // Once the overlay has opened, brief re-connects shouldn't reset the
  // countdown — the player can't escape the AUTO_WIN deadline by quickly
  // toggling. Only when fully online does the overlay close.
  const { bus, createDisconnectController, DISCONNECT_OPEN, DISCONNECT_CLOSE } = await loadModules();
  bus._reset();
  const session = makeSession();
  let presenceCb = null;
  let opened = 0, closed = 0;
  let mockNow = 10_000;
  bus.on(DISCONNECT_OPEN, () => { opened++; });
  bus.on(DISCONNECT_CLOSE, () => { closed++; });
  const ctl = createDisconnectController({
    bus, dbRef: () => ({}), sessionRef: () => session,
    watchPresence: (db, uid, cb) => { presenceCb = cb; return () => {}; },
    now: () => mockNow,
    graceMs: 1_000,
  });
  // Force the overlay open.
  presenceCb({ connected: false, lastSeen: 1 });
  mockNow += 1_500;
  presenceCb({ connected: false, lastSeen: 1 });
  assert.equal(opened, 1);

  // Now a flicker: brief online → brief offline. The CLOSE fires for the
  // online moment (correct UX), but the accumulated time should not reset
  // — when offline resumes, the countdown picks up where it was.
  presenceCb({ connected: true, lastSeen: mockNow });
  assert.equal(closed, 1, 'overlay closes when actually online');
  mockNow += 200; // brief online
  presenceCb({ connected: false, lastSeen: 1 });
  mockNow += 100; // a bit more offline
  presenceCb({ connected: false, lastSeen: 1 });
  // We're at totalDisconnectedMs (~1500ms) + (100ms current span) = 1600ms.
  // Already past grace (1000ms), so the overlay should reopen.
  assert.equal(opened, 2, 'overlay reopens immediately when cumulative-during-open offline still > grace');
  ctl.dispose();
});
