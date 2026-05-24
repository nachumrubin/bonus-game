// Browser Notification fallback parity vs. legacy _showBrowserOnlyNotification.
//
// Legacy authority (HEAD:index.html):
//   - _showBrowserOnlyNotification at line 9063 — checks permission, prefers
//     SW showNotification, falls back to `new Notification(title, options)`,
//     wires onclick to _handleBrowserNotificationClick(data).
//   - _handleBrowserNotificationClick at line 9052 — routes by data.type:
//     invite → openJoinWithCode, turn → rejoinOnlineGame, friend* → openFriends.
//
// Spine previously had NO fallback — OneSignal-only. This test pins the
// new browserNotificationFallback module's behavior.
//
// What we assert:
//   • shouldFire: supports + granted + (hidden OR force) gates correctly.
//   • routeFor: legacy data.type → spine target intent mapping.
//   • showBrowserNotification prefers SW.showNotification when registered.
//   • Falls back to `new Notification` when SW unavailable.
//   • onclick fires the router with the mapped route + focuses window.
//   • Silent no-op when unsupported / permission not granted / tab visible.

const test = require('node:test');
const assert = require('node:assert/strict');

let modPromise;
function loadModule() {
  modPromise ??= import('../../src/notifications/browserNotificationFallback.js');
  return modPromise;
}

// ── Test fixtures ───────────────────────────────────────────────────────

function makeNotificationCtor({ permission = 'granted' } = {}) {
  const constructed = [];
  function FakeNotification(title, options) {
    this.title = title;
    this.options = options;
    this.closed = false;
    this.onclick = null;
    this.close = () => { this.closed = true; };
    constructed.push(this);
  }
  FakeNotification.permission = permission;
  return { FakeNotification, constructed };
}

function makeWin({ Notification, hidden = false, focused = 0 } = {}) {
  return {
    Notification,
    focus: () => { focused++; },
    get _focusCount() { return focused; },
    _hidden: hidden,
  };
}

function makeDoc({ hidden = false } = {}) {
  return { visibilityState: hidden ? 'hidden' : 'visible' };
}

// ── shouldFire gating ───────────────────────────────────────────────────

test('parity: shouldFire = false when Notification API absent', async () => {
  const m = await loadModule();
  const win = { /* no Notification */ };
  const doc = makeDoc({ hidden: true });
  assert.equal(m.shouldFire({ win, doc }), false);
  assert.equal(m.isBrowserNotificationSupported(win), false);
  assert.equal(m.getPermission(win), 'unsupported');
});

test('parity: shouldFire = false when permission not granted', async () => {
  const m = await loadModule();
  const { FakeNotification } = makeNotificationCtor({ permission: 'default' });
  const win = makeWin({ Notification: FakeNotification });
  const doc = makeDoc({ hidden: true });
  assert.equal(m.shouldFire({ win, doc }), false);
});

test('parity: shouldFire = false when tab is visible and force not set', async () => {
  const m = await loadModule();
  const { FakeNotification } = makeNotificationCtor({ permission: 'granted' });
  const win = makeWin({ Notification: FakeNotification });
  const doc = makeDoc({ hidden: false });
  assert.equal(m.shouldFire({ win, doc }), false,
    'visible tab ⇒ in-app banner is enough; matches legacy hidden-only gate');
});

test('parity: shouldFire = true when granted + hidden', async () => {
  const m = await loadModule();
  const { FakeNotification } = makeNotificationCtor({ permission: 'granted' });
  const win = makeWin({ Notification: FakeNotification });
  const doc = makeDoc({ hidden: true });
  assert.equal(m.shouldFire({ win, doc }), true);
});

test('parity: shouldFire = true with force, regardless of visibility', async () => {
  const m = await loadModule();
  const { FakeNotification } = makeNotificationCtor({ permission: 'granted' });
  const win = makeWin({ Notification: FakeNotification });
  const doc = makeDoc({ hidden: false });
  assert.equal(m.shouldFire({ win, doc, force: true }), true);
});

// ── routeFor: legacy data.type → spine intent ──────────────────────────

test('parity: routeFor matches legacy _handleBrowserNotificationClick dispatch table', async () => {
  const m = await loadModule();
  assert.deepEqual(m.routeFor({ type: 'invite', roomCode: 'AB123' }), { target: 'OPEN_JOIN', roomCode: 'AB123' });
  assert.deepEqual(m.routeFor({ type: 'turn',   roomCode: 'r99' }),   { target: 'OPEN_TURN', roomCode: 'r99' });
  assert.deepEqual(m.routeFor({ type: 'friendRequest' }),             { target: 'OPEN_FRIENDS' });
  assert.deepEqual(m.routeFor({ type: 'friendAccepted' }),            { target: 'OPEN_FRIENDS' });
  assert.deepEqual(m.routeFor({ type: 'completed', roomCode: 'rZ' }), { target: 'OPEN_GAME_SUMMARY', roomCode: 'rZ' });
});

test('parity: routeFor returns null for invite/turn without roomCode (no destination)', async () => {
  const m = await loadModule();
  assert.equal(m.routeFor({ type: 'invite' }), null);
  assert.equal(m.routeFor({ type: 'turn' }), null);
  assert.equal(m.routeFor({}), null);
});

// ── showBrowserNotification: SW preferred, constructor fallback ─────────

test('parity: prefers SW.showNotification when a registration is provided', async () => {
  const m = await loadModule();
  const { FakeNotification, constructed } = makeNotificationCtor({ permission: 'granted' });
  const win = makeWin({ Notification: FakeNotification });
  const doc = makeDoc({ hidden: true });
  const swCalls = [];
  const swRegistration = {
    async showNotification(title, options) { swCalls.push({ title, options }); },
  };

  const result = await m.showBrowserNotification({
    title: 'הזמנה למשחק',
    body: 'דני מזמין אותך',
    data: { type: 'invite', roomCode: 'AB123' },
    win, doc, swRegistration,
  });
  assert.equal(result.shown, true);
  assert.equal(result.via, 'sw');
  assert.equal(swCalls.length, 1);
  assert.equal(swCalls[0].title, 'הזמנה למשחק');
  assert.equal(swCalls[0].options.body, 'דני מזמין אותך');
  assert.equal(swCalls[0].options.tag, 'bonus-invite-AB123');
  assert.equal(swCalls[0].options.renotify, true);
  // SW path does NOT also construct a window.Notification.
  assert.equal(constructed.length, 0);
});

test('parity: falls back to new Notification when no SW registration', async () => {
  const m = await loadModule();
  const { FakeNotification, constructed } = makeNotificationCtor({ permission: 'granted' });
  const win = makeWin({ Notification: FakeNotification });
  const doc = makeDoc({ hidden: true });

  const result = await m.showBrowserNotification({
    title: 'תורך!',
    data: { type: 'turn', roomCode: 'r99' },
    win, doc, /* no swRegistration */
  });
  assert.equal(result.shown, true);
  assert.equal(result.via, 'constructor');
  assert.equal(constructed.length, 1);
  assert.equal(constructed[0].title, 'תורך!');
  assert.equal(constructed[0].options.tag, 'bonus-turn-r99');
});

test('parity: SW failure transparently falls back to constructor', async () => {
  const m = await loadModule();
  const { FakeNotification, constructed } = makeNotificationCtor({ permission: 'granted' });
  const win = makeWin({ Notification: FakeNotification });
  const doc = makeDoc({ hidden: true });
  const swRegistration = {
    async showNotification() { throw new Error('SW push failed'); },
  };

  const result = await m.showBrowserNotification({
    title: 'תורך!',
    data: { type: 'turn', roomCode: 'r99' },
    win, doc, swRegistration,
  });
  assert.equal(result.shown, true);
  assert.equal(result.via, 'constructor',
    'a failing SW.showNotification must NOT bubble — fall back to constructor');
  assert.equal(constructed.length, 1);
});

// ── onclick routing ────────────────────────────────────────────────────

test('parity: constructor onclick invokes the router with the mapped route and focuses window', async () => {
  const m = await loadModule();
  const { FakeNotification, constructed } = makeNotificationCtor({ permission: 'granted' });
  const win = makeWin({ Notification: FakeNotification });
  const doc = makeDoc({ hidden: true });

  let focused = 0;
  win.focus = () => { focused++; };
  const routes = [];

  await m.showBrowserNotification({
    title: 'הזמנה',
    data: { type: 'invite', roomCode: 'AB123' },
    win, doc,
    onClick: (route) => routes.push(route),
  });

  const n = constructed[0];
  assert.equal(typeof n.onclick, 'function');
  n.onclick();
  assert.equal(focused, 1, 'window.focus() called');
  assert.deepEqual(routes, [{ target: 'OPEN_JOIN', roomCode: 'AB123' }]);
  assert.equal(n.closed, true, 'notification closed after click');
});

// ── No-op paths ────────────────────────────────────────────────────────

test('parity: silent no-op when Notification unsupported', async () => {
  const m = await loadModule();
  const result = await m.showBrowserNotification({
    title: 't', body: 'b', win: {}, doc: makeDoc({ hidden: true }),
  });
  assert.equal(result.shown, false);
  assert.equal(result.reason, 'precondition-failed');
});

test('parity: silent no-op when permission is "denied"', async () => {
  const m = await loadModule();
  const { FakeNotification } = makeNotificationCtor({ permission: 'denied' });
  const win = makeWin({ Notification: FakeNotification });
  const result = await m.showBrowserNotification({
    title: 't', win, doc: makeDoc({ hidden: true }),
  });
  assert.equal(result.shown, false);
  assert.equal(result.reason, 'precondition-failed');
});

test('parity: tag dedupes per-room: same roomCode produces same tag', async () => {
  const m = await loadModule();
  const { FakeNotification, constructed } = makeNotificationCtor({ permission: 'granted' });
  const win = makeWin({ Notification: FakeNotification });
  const doc = makeDoc({ hidden: true });
  await m.showBrowserNotification({ title: 't1', data: { type: 'turn', roomCode: 'X' }, win, doc });
  await m.showBrowserNotification({ title: 't2', data: { type: 'turn', roomCode: 'X' }, win, doc });
  await m.showBrowserNotification({ title: 't3', data: { type: 'turn', roomCode: 'Y' }, win, doc });
  assert.equal(constructed[0].options.tag, 'bonus-turn-X');
  assert.equal(constructed[1].options.tag, 'bonus-turn-X', 'identical tag ⇒ browser de-dupes/replaces');
  assert.equal(constructed[2].options.tag, 'bonus-turn-Y');
});
