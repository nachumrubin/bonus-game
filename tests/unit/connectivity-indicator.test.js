// Unit tests for the live connectivity indicator wifi-icon system.
//
// Covers:
//   1. connectivityService.startConnectivityMonitor — subscribes to
//      Firebase RTDB's `.info/connected`, dedupes, emits NET_STATUS_CHANGED.
//   2. connectivityIndicator — only shows during online-mode games, toggles
//      is-online / is-offline classes on the DOM element in response.

const test = require('node:test');
const assert = require('node:assert/strict');

let modulesPromise;
function loadModules() {
  modulesPromise ??= (async () => {
    const [busMod, mockMod, svcMod, ctlMod, evMod] = await Promise.all([
      import('../../src/events/bus.js'),
      import('../../src/game/online/mockFirebase.js'),
      import('../../src/game/online/connectivityService.js'),
      import('../../src/ui/controllers/connectivityIndicator.js'),
      import('../../src/events/eventTypes.js'),
    ]);
    return {
      bus: busMod,
      makeMockDb: mockMod.makeMockDb,
      startConnectivityMonitor: svcMod.startConnectivityMonitor,
      NET_STATUS_CHANGED: svcMod.NET_STATUS_CHANGED,
      createConnectivityIndicator: ctlMod.createConnectivityIndicator,
      EV: evMod.EV,
    };
  })();
  return modulesPromise;
}

function makeFakeNode() {
  const classes = new Set();
  const attrs = {};
  return {
    classList: {
      add(...cs) { for (const c of cs) classes.add(c); },
      remove(...cs) { for (const c of cs) classes.delete(c); },
      contains(c) { return classes.has(c); },
    },
    setAttribute(k, v) { attrs[k] = v; },
    _classes: classes,
    _attrs: attrs,
  };
}

function makeFakeDoc(elementsById) {
  return { getElementById: (id) => elementsById[id] ?? null };
}

test('connectivityService: emits NET_STATUS_CHANGED on transitions; dedupes same-state events', async () => {
  const { bus, makeMockDb, startConnectivityMonitor, NET_STATUS_CHANGED } = await loadModules();
  bus._reset();
  const db = makeMockDb();
  // Pre-seed .info/connected as true so the initial .on('value') callback
  // matches the service's default "assume connected" state and no startup
  // event fires. Real Firebase resolves `.info/connected` to true once the
  // WebSocket establishes; the mock needs explicit seeding.
  await db.ref('.info/connected').set(true);
  const events = [];
  bus.on(NET_STATUS_CHANGED, (p) => events.push(p));
  const monitor = startConnectivityMonitor({ db, bus });
  assert.equal(events.length, 0, 'no transition yet');

  // Simulate connection drop.
  await db.ref('.info/connected').set(false);
  assert.equal(events.length, 1);
  assert.equal(events[0].connected, false);

  // Dedupe: another false write should NOT emit again.
  await db.ref('.info/connected').set(false);
  assert.equal(events.length, 1, 'dedup: same-state writes must not re-emit');

  // Reconnect.
  await db.ref('.info/connected').set(true);
  assert.equal(events.length, 2);
  assert.equal(events[1].connected, true);

  monitor.stop();
});

test('connectivityIndicator: hides the icon when game mode is offline-solo', async () => {
  const { bus, createConnectivityIndicator, EV } = await loadModules();
  bus._reset();
  const node = makeFakeNode();
  const doc = makeFakeDoc({ 'net-status': node });
  const ctl = createConnectivityIndicator({ bus, doc });

  bus.emit(EV.GAME_STARTED, { mode: 'offline-solo' });
  assert.equal(node.classList.contains('is-visible'), false,
    'offline-solo must NOT show the connectivity icon');
  ctl.dispose();
});

test('connectivityIndicator: shows green when game starts online and connection is good', async () => {
  const { bus, createConnectivityIndicator, NET_STATUS_CHANGED, EV } = await loadModules();
  bus._reset();
  const node = makeFakeNode();
  const doc = makeFakeDoc({ 'net-status': node });
  const ctl = createConnectivityIndicator({ bus, doc });

  bus.emit(EV.GAME_STARTED, { mode: 'random-live' });
  assert.equal(node.classList.contains('is-visible'), true, 'online game must show indicator');
  assert.equal(node.classList.contains('is-online'), true, 'starts in good state');
  assert.equal(node.classList.contains('is-offline'), false);
  ctl.dispose();
});

test('connectivityIndicator: flips to is-offline when NET_STATUS_CHANGED fires with connected:false', async () => {
  const { bus, createConnectivityIndicator, NET_STATUS_CHANGED, EV } = await loadModules();
  bus._reset();
  const node = makeFakeNode();
  const doc = makeFakeDoc({ 'net-status': node });
  const ctl = createConnectivityIndicator({ bus, doc });

  bus.emit(EV.GAME_STARTED, { mode: 'friend-live' });
  bus.emit(NET_STATUS_CHANGED, { connected: false, since: Date.now() });

  assert.equal(node.classList.contains('is-offline'), true, 'must show red when offline');
  assert.equal(node.classList.contains('is-online'), false);
  assert.match(node._attrs.title || '', /אין חיבור/, 'tooltip updated to offline state');

  // Recovery.
  bus.emit(NET_STATUS_CHANGED, { connected: true, since: Date.now() });
  assert.equal(node.classList.contains('is-online'), true, 'must return to green when reconnected');
  assert.equal(node.classList.contains('is-offline'), false);
  ctl.dispose();
});

test('connectivityIndicator: hides on GAME_COMPLETED', async () => {
  const { bus, createConnectivityIndicator, EV } = await loadModules();
  bus._reset();
  const node = makeFakeNode();
  const doc = makeFakeDoc({ 'net-status': node });
  const ctl = createConnectivityIndicator({ bus, doc });

  bus.emit(EV.GAME_STARTED, { mode: 'friend-live' });
  assert.equal(node.classList.contains('is-visible'), true);
  bus.emit(EV.GAME_COMPLETED, { status: 'completed', winnerSlot: 0, scores: {} });
  assert.equal(node.classList.contains('is-visible'), false, 'icon hides on game over');
  ctl.dispose();
});

test('connectivityIndicator: NET_STATUS_CHANGED received before any GAME_STARTED does not paint a hidden node', async () => {
  // Bus singleton means events can arrive at any time. Make sure the
  // indicator stays hidden if no online game has started yet (offline
  // session, app idle, etc.).
  const { bus, createConnectivityIndicator, NET_STATUS_CHANGED } = await loadModules();
  bus._reset();
  const node = makeFakeNode();
  const doc = makeFakeDoc({ 'net-status': node });
  const ctl = createConnectivityIndicator({ bus, doc });

  bus.emit(NET_STATUS_CHANGED, { connected: false, since: Date.now() });
  // We expect NEITHER is-visible NOR is-offline to be set without a prior
  // GAME_STARTED — there's nothing for the user to look at.
  assert.equal(node.classList.contains('is-visible'), false);
  assert.equal(node.classList.contains('is-offline'), false);
  ctl.dispose();
});
