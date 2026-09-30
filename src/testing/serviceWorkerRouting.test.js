import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadSw() {
  const code = fs.readFileSync('sw.js', 'utf8');
  const sandbox = {
    importScripts() {},
    self: { addEventListener() {}, skipWaiting() {}, clients: { claim() {} } },
    caches: { open() {}, keys() {} },
  };
  vm.runInNewContext(code, sandbox);
  return sandbox;
}

function loadMapKindToRoute() {
  return loadSw().mapKindToRoute;
}

test('service worker routes invite notifications to notifications screen', () => {
  const mapKindToRoute = loadMapKindToRoute();
  const route = mapKindToRoute('invite', '123456');
  assert.equal(route.url, '/?open=notifications');
  assert.deepEqual(plain(route.message), { type: 'OPEN_NOTIFICATIONS' });
});

test('service worker routes turn and reminder notifications to resume flow', () => {
  const mapKindToRoute = loadMapKindToRoute();
  for (const kind of ['turn', 'reminder', 'invite_accepted']) {
    const route = mapKindToRoute(kind, 'room-1');
    assert.equal(route.url, '/?resume=room-1');
    assert.equal(route.message.type, 'OPEN_TURN');
    assert.equal(route.message.roomId, 'room-1');
  }
});

test('service worker routes invite rejection notifications home', () => {
  const mapKindToRoute = loadMapKindToRoute();
  const route = mapKindToRoute('invite_rejected', null);
  assert.equal(route.url, '/');
  assert.equal(route.message, null);
});

test('service worker routes terminal game notifications to summary flow', () => {
  const mapKindToRoute = loadMapKindToRoute();
  for (const kind of ['completed', 'expired']) {
    const route = mapKindToRoute(kind, 'room-2');
    assert.equal(route.url, '/?summary=room-2');
    assert.equal(route.message.type, 'OPEN_GAME_SUMMARY');
  }
});

test('service worker routes social notifications to profile flow', () => {
  const mapKindToRoute = loadMapKindToRoute();
  for (const kind of ['friendRequest', 'friendAccepted']) {
    const route = mapKindToRoute(kind, null);
    assert.equal(route.url, '/?profile=friends');
    assert.deepEqual(plain(route.message), { type: 'OPEN_PROFILE' });
  }
});

test('service worker serves the web-sized WebP for asset PNGs', () => {
  const { webImageUrl } = loadSw();
  const base = 'https://boost-8ef11.web.app/';
  assert.equal(webImageUrl(base + 'assets/icons/globe.png'), base + 'assets/icons/globe.webp');
  assert.equal(webImageUrl(base + 'assets/avatars/bot.PNG?x=1'), base + 'assets/avatars/bot.webp');
  assert.equal(
    webImageUrl(base + 'assets/achievements/%D7%90%D7%92%D7%93%D7%94.png'),
    base + 'assets/achievements/%D7%90%D7%92%D7%93%D7%94.webp',
  );
  // Generated atlases, non-PNGs and images outside assets/ are served as-is.
  assert.equal(webImageUrl(base + 'assets/anim/avatars/bot.webp'), null);
  assert.equal(webImageUrl(base + 'assets/music/inspire-action.mp3'), null);
  assert.equal(webImageUrl(base + 'images/guide/game-screen.png'), null);
  assert.equal(webImageUrl(base + 'icon-512.png'), null);
});

test('service worker routes only images under assets/ and images/ to the image cache', () => {
  const { isImageAsset } = loadSw();
  const base = 'https://boost-8ef11.web.app/';
  assert.equal(isImageAsset(base + 'assets/icons/globe.png'), true);
  assert.equal(isImageAsset(base + 'assets/anim/avatars/bot.webp'), true);
  assert.equal(isImageAsset(base + 'images/guide/game-screen.png'), true);
  assert.equal(isImageAsset(base + 'assets/anim/manifest.json'), false);
  assert.equal(isImageAsset(base + 'assets/music/inspire-action.mp3'), false);
  assert.equal(isImageAsset(base + 'icon-512.png'), false);
  assert.equal(isImageAsset(base + 'src/main.js'), false);
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}
