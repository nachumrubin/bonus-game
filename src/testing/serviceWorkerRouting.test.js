import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadMapKindToRoute() {
  const code = fs.readFileSync('sw.js', 'utf8');
  const sandbox = {
    importScripts() {},
    self: { addEventListener() {}, skipWaiting() {}, clients: { claim() {} } },
    caches: { open() {}, keys() {} },
  };
  vm.runInNewContext(code, sandbox);
  return sandbox.mapKindToRoute;
}

test('service worker routes invite notifications to join flow', () => {
  const mapKindToRoute = loadMapKindToRoute();
  const route = mapKindToRoute('invite', '123456');
  assert.equal(route.url, '/?join=123456');
  assert.deepEqual(plain(route.message), { type: 'OPEN_JOIN', roomCode: '123456', roomId: '123456' });
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

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}
