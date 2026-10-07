import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelSrcForAvatar, isTooSlow, median, SLOW_SAMPLE, SLOW_FRAME_MS } from './boostieSources.js';
import { createScoreboardLive, canUseLive3d } from './scoreboardLive.js';

test('modelSrcForAvatar: Boostie values map to their level model', () => {
  assert.equal(modelSrcForAvatar('zapi:4'), 'assets/boosties/zapi_l4.glb');
  assert.equal(modelSrcForAvatar('bubo'), 'assets/boosties/bubo_l1.glb');
  assert.equal(modelSrcForAvatar({ id: 'bubo', level: 7 }), 'assets/boosties/bubo_l7.glb');
});

test('modelSrcForAvatar: bots have their own models, the generic bot has none', () => {
  assert.equal(modelSrcForAvatar('bot_hard'), 'assets/boosties/bot_hard.glb');
  assert.equal(modelSrcForAvatar('bot'), null);
});

test('modelSrcForAvatar: emoji, old ids and empty values stay stills', () => {
  for (const v of ['👑', 'lion', '', null, undefined, 42]) assert.equal(modelSrcForAvatar(v), null, String(v));
});

test('isTooSlow: needs a full sample, then compares the median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(isTooSlow(Array(SLOW_SAMPLE - 1).fill(200)), false, 'too few frames to judge');
  assert.equal(isTooSlow(Array(SLOW_SAMPLE).fill(16)), false);
  assert.equal(isTooSlow(Array(SLOW_SAMPLE).fill(SLOW_FRAME_MS + 20)), true);
  // a few long frames (a GC pause, a score animation) don't count
  assert.equal(isTooSlow([...Array(SLOW_SAMPLE - 5).fill(16), ...Array(5).fill(300)]), false);
  assert.equal(isTooSlow(Array(SLOW_SAMPLE).fill(500), Infinity), false, 'Infinity turns the check off');
});

test('canUseLive3d: false without WebGL 2 (node, old browsers)', () => {
  assert.equal(canUseLive3d({}), false);
  assert.equal(canUseLive3d({ WebGL2RenderingContext: function () {}, document: { createElement() {} }, requestAnimationFrame() {} }), true);
});

function fakeBoard() {
  const calls = [];
  return {
    calls,
    createScoreboard3d: ({ hosts, onFallback }) => {
      calls.push(['create', hosts.length]);
      return {
        setAvatar: (i, src) => calls.push(['set', i, src]),
        play: (i, kind) => { calls.push(['play', i, kind]); return i === 0; },
        canPlay: (i) => i === 0,
        dispose: () => calls.push(['dispose']),
        fallback: onFallback,
      };
    },
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const HOSTS = () => [{}, {}];

test('scoreboardLive: loads the 3D only once a slot has a model', async () => {
  const fake = fakeBoard();
  let imports = 0;
  const live = createScoreboardLive({ hosts: HOSTS, enabled: true, importer: async () => { imports++; return fake; } });
  live.sync(['👑', 'bot']);
  await flush();
  assert.equal(imports, 0, 'no model, no three.js');
  live.sync(['zapi:3', 'bot_easy']);
  await flush();
  assert.equal(imports, 1);
  assert.deepEqual(fake.calls.filter((c) => c[0] === 'set'), [['set', 0, 'assets/boosties/zapi_l3.glb'], ['set', 1, 'assets/boosties/bot_easy.glb']]);
  live.sync(['zapi:4', 'bot_easy']);
  assert.deepEqual(fake.calls.at(-2), ['set', 0, 'assets/boosties/zapi_l4.glb']);
});

test('scoreboardLive: play reports whether the 3D carried the moment', async () => {
  const fake = fakeBoard();
  const live = createScoreboardLive({ hosts: HOSTS, enabled: true, importer: async () => fake });
  assert.equal(live.play(0, 'turn'), false, 'nothing loaded yet');
  live.sync(['zapi:1', 'bubo:1']);
  await flush();
  assert.equal(live.play(0, 'turn'), true);
  assert.equal(live.play(1, 'good'), false);
  assert.equal(live.canPlay(0), true);
});

test('scoreboardLive: reduced motion and disabled environments keep the stills', async () => {
  let imports = 0;
  const importer = async () => { imports++; return fakeBoard(); };
  const reduced = createScoreboardLive({ hosts: HOSTS, enabled: true, prefersReducedMotion: () => true, importer });
  reduced.sync(['zapi:1', 'bubo:1']);
  const off = createScoreboardLive({ hosts: HOSTS, enabled: false, importer });
  off.sync(['zapi:1', 'bubo:1']);
  await flush();
  assert.equal(imports, 0);
  assert.equal(reduced.play(0, 'turn'), false);
  assert.equal(off.play(0, 'turn'), false);
});

test('scoreboardLive: a failed import or a slow-phone fallback switches to stills for good', async () => {
  const failing = createScoreboardLive({ hosts: HOSTS, enabled: true, importer: async () => { throw new Error('no webgl'); } });
  const warn = console.warn; console.warn = () => {};
  try {
    failing.sync(['zapi:1', 'bubo:1']);
    await flush(); await flush();
  } finally { console.warn = warn; }
  assert.equal(failing._state().off, true);
  assert.equal(failing.play(0, 'turn'), false);

  const fake = fakeBoard();
  let board = null;
  const live = createScoreboardLive({ hosts: HOSTS, enabled: true, importer: async () => ({
    createScoreboard3d: (o) => (board = fake.createScoreboard3d(o)),
  }) });
  live.sync(['zapi:1', 'bubo:1']);
  await flush();
  board.fallback('slow');
  assert.equal(live.play(0, 'turn'), false);
});

test('scoreboardLive: dispose tears the board down and ignores a late import', async () => {
  const fake = fakeBoard();
  let resolve;
  const live = createScoreboardLive({ hosts: HOSTS, enabled: true, importer: () => new Promise((r) => { resolve = r; }) });
  live.sync(['zapi:1', 'bubo:1']);
  live.dispose();
  resolve(fake);
  await flush();
  assert.equal(fake.calls.length, 0, 'never created after dispose');

  const fake2 = fakeBoard();
  const live2 = createScoreboardLive({ hosts: HOSTS, enabled: true, importer: async () => fake2 });
  live2.sync(['zapi:1', 'bubo:1']);
  await flush();
  live2.dispose();
  assert.deepEqual(fake2.calls.at(-1), ['dispose']);
});

test('scoreboardLive: one host (the store preview) and ready() once the model is in', async () => {
  const fake = fakeBoard();
  const live = createScoreboardLive({ hosts: () => [{}], enabled: true, importer: async () => fake });
  live.sync([{ id: 'zapi', level: 2 }]);
  assert.equal(await live.ready(0), true);
  assert.deepEqual(fake.calls.slice(0, 2), [['create', 1], ['set', 0, 'assets/boosties/zapi_l2.glb']]);
  assert.equal(live.play(0, 'wink'), true);
  const off = createScoreboardLive({ hosts: () => [{}], enabled: false });
  off.sync(['zapi:2']);
  assert.equal(await off.ready(0), false);
});
