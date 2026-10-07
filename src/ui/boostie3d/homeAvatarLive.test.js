import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountHomeAvatarLive } from './homeAvatarLive.js';

function fakeDoc() {
  const cls = new Set();
  const wrap = { id: 'wrap' };
  const screen = { classList: { contains: (c) => cls.has(c) } };
  const icon = { closest: (sel) => (sel === '.em-avatar-wrap' ? wrap : null) };
  const timers = [];
  const doc = {
    hidden: false, wrap, cls,
    getElementById: (id) => ({ sh: screen, 'home-avatar-ic': icon }[id] ?? null),
    addEventListener() {}, removeEventListener() {},
    defaultView: { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {} },
    timers,
  };
  return doc;
}

test('home avatar: live 3D while home shows, gone when it hides; no avatar → still', () => {
  const doc = fakeDoc();
  const calls = [];
  let avatar = 'zapi:3';
  const fake = () => ({
    sync: (v) => calls.push(['sync', v]),
    play: (i, k) => { calls.push(['play', i, k]); return true; },
    dispose: () => calls.push(['dispose']),
  });
  const home = mountHomeAvatarLive({ doc, enabled: true, getAvatar: () => avatar,
    random: () => 0,
    createLive: ({ hosts, look }) => { calls.push(['create', hosts()[0] === doc.wrap, look.lively]); return fake(); } });
  assert.deepEqual(calls, [['create', true, true], ['sync', ['zapi:3']]]);
  doc.timers.at(-1).fn();                                   // the hello
  assert.deepEqual(calls.at(-1), ['play', 0, 'yawn']);
  doc.timers.at(-1).fn();                                   // never the same gesture twice in a row
  assert.deepEqual(calls.at(-1), ['play', 0, 'signature']);
  assert.ok(doc.timers.at(-1).ms <= 9000, 'gestures come every few seconds');
  doc.cls.add('hidden');                                    // left the home screen
  home.refresh();
  assert.deepEqual(calls.at(-1), ['dispose']);
  doc.cls.delete('hidden');
  avatar = null;                                            // signed out
  home.refresh();
  assert.equal(calls.filter((c) => c[0] === 'create').length, 1);
  home.unmount();
});

test('home avatar: does nothing without WebGL 2 or under reduced motion', () => {
  let created = 0;
  const createLive = () => { created++; return { sync() {}, dispose() {} }; };
  mountHomeAvatarLive({ doc: fakeDoc(), enabled: false, getAvatar: () => 'zapi:1', createLive }).unmount();
  mountHomeAvatarLive({ doc: fakeDoc(), enabled: true, prefersReducedMotion: () => true, getAvatar: () => 'zapi:1', createLive }).unmount();
  assert.equal(created, 0);
});

test('home avatar: a gesture the model lacks is skipped for the next one', () => {
  const doc = fakeDoc();
  const played = [];
  mountHomeAvatarLive({ doc, enabled: true, getAvatar: () => 'bubo:2', random: () => 0,
    createLive: () => ({ sync() {}, dispose() {}, play: (i, k) => { if (k === 'yawn') return false; played.push(k); return true; } }) });
  doc.timers.at(-1).fn();
  assert.deepEqual(played, ['signature']);
});

test('profile avatar: the same live 3D on #sprofile, in the ring around #profile-avatar-display', async () => {
  const { mountProfileAvatarLive } = await import('./homeAvatarLive.js');
  const ring = { id: 'ring' };
  const asked = [];
  const doc = {
    hidden: false,
    getElementById: (id) => { asked.push(id); return { sprofile: { classList: { contains: () => false } },
      'profile-avatar-display': { closest: (sel) => (sel === '.g-avr' ? ring : null) } }[id] ?? null; },
    addEventListener() {}, removeEventListener() {},
    defaultView: { setTimeout: () => 1, clearTimeout() {} },
  };
  let host = null;
  mountProfileAvatarLive({ doc, enabled: true, getAvatar: () => 'bubo:5',
    createLive: ({ hosts }) => { host = hosts()[0]; return { sync() {}, dispose() {}, play: () => true }; } }).unmount();
  assert.deepEqual(asked, ['sprofile', 'profile-avatar-display']);
  assert.equal(host, ring);
});
