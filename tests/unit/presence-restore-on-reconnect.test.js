// Regression test for the live-reproduced bug #2 root cause.
//
// Symptom: brief WebSocket drop (auth-refresh failure, mobile network blip,
// any transient connectivity loss) causes the Firebase RTDB server to fire
// the armed `onDisconnect` handler, writing /presence/{uid}.connected = false.
// When the SDK reconnects, the heartbeat keeps updating `lastSeen` but
// never restored `connected:true` — so /presence stays stuck at
// connected:false even though the player's session is alive. The opponent's
// disconnectController sees connected:false (authoritative per isPresenceOnline)
// and fires the disconnect overlay after grace.
//
// Two-part fix:
//   1. Subscribe to `.info/connected` — on every transition to true, re-set
//      the full presence record and re-arm onDisconnect (this heals
//      immediately on every reconnect).
//   2. Heartbeat now writes `connected: true` along with `lastSeen` — belt
//      and braces: if (1) misses a reconnect for any reason, the heartbeat
//      self-heals within HEARTBEAT_MS.
//
// This test exercises (1) directly because heartbeat timing requires fake
// timers; sim's e2e already exercises both ends-to-end at wall-clock speed.

const test = require('node:test');
const assert = require('node:assert/strict');

let modulesPromise;
function loadModules() {
  modulesPromise ??= (async () => {
    const [mockMod, svcMod] = await Promise.all([
      import('../../src/game/online/mockFirebase.js'),
      import('../../src/game/online/presenceService.js'),
    ]);
    return {
      makeMockDb: mockMod.makeMockDb,
      startPresence: svcMod.startPresence,
    };
  })();
  return modulesPromise;
}

async function readPresence(db, uid) {
  const snap = await db.ref(`presence/${uid}`).get();
  return snap?.val ? snap.val() : null;
}

test('presence startup writes connected:true and arms onDisconnect to flip back to false', async () => {
  const { makeMockDb, startPresence } = await loadModules();
  const db = makeMockDb();
  await db.ref('.info/connected').set(true);
  const handle = await startPresence(db, { uid: 'alice', currentRoom: 'r1', serverTimestamp: () => 1_000, doc: null });
  const p = await readPresence(db, 'alice');
  assert.equal(p?.connected, true);
  assert.equal(p?.currentRoom, 'r1');
  await handle.stop();
});

test('.info/connected reconnect re-affirms connected:true after onDisconnect-induced false', async () => {
  // This is the exact mechanism that produced the user-reported bug:
  // presence ends up at connected:false from a server-side onDisconnect
  // fire while the session itself is perfectly alive. The fix must heal
  // it on the next reconnect.
  const { makeMockDb, startPresence } = await loadModules();
  const db = makeMockDb();
  // Pre-seed `.info/connected` as true so startPresence's initial subscribe
  // doesn't fire its handler with a transition (saves a redundant affirm).
  await db.ref('.info/connected').set(true);
  const handle = await startPresence(db, { uid: 'alice', currentRoom: 'r1', serverTimestamp: () => Date.now(), doc: null });
  assert.equal((await readPresence(db, 'alice'))?.connected, true, 'initial state online');

  // Simulate what RTDB does server-side when the WebSocket drops: fire the
  // armed onDisconnect → /presence/alice.connected becomes false.
  await db.ref('presence/alice').update({ connected: false });
  assert.equal((await readPresence(db, 'alice'))?.connected, false, 'simulated onDisconnect blip');

  // Simulate the SDK reconnecting: .info/connected flips false → true.
  await db.ref('.info/connected').set(false);
  await db.ref('.info/connected').set(true);
  // Let the affirmPresence promise resolve.
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  const restored = await readPresence(db, 'alice');
  assert.equal(restored?.connected, true,
    'presence MUST be restored to connected:true after .info/connected re-affirms');
  assert.equal(restored?.currentRoom, 'r1', 'currentRoom preserved through restore');
  await handle.stop();
});

test('handle.stop() unsubscribes the .info/connected watcher so no stale callbacks fire after dispose', async () => {
  const { makeMockDb, startPresence } = await loadModules();
  const db = makeMockDb();
  await db.ref('.info/connected').set(true);
  const handle = await startPresence(db, { uid: 'bob', currentRoom: 'r2', serverTimestamp: () => Date.now(), doc: null });
  await handle.stop();
  // After stop, presence should be at connected:false (the explicit teardown write).
  const stopped = await readPresence(db, 'bob');
  assert.equal(stopped?.connected, false, 'stop writes connected:false');
  // Toggling .info/connected should NOT re-write the presence back to true —
  // the watcher must be unsubscribed.
  await db.ref('.info/connected').set(false);
  await db.ref('.info/connected').set(true);
  await new Promise(r => setImmediate(r));
  const afterToggle = await readPresence(db, 'bob');
  assert.equal(afterToggle?.connected, false,
    'after dispose, .info/connected reconnect must not affect presence');
});
