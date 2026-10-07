import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLIPS, samplePose, sampleClip, resolveFrames, clipTime, isClipDone, clipSuitsAtlas,
} from './poseClips.js';
import { normalizeAssetPath, createAtlasManifest } from './atlasManifest.js';
import { fitRect, cssFilter, cssTransform, playOnImg } from './spritePlayer.js';

const BUST = {
  atlas: 'assets/anim/avatars_v2/common/doctor.webp', cell: [291, 320], cols: 4, count: 16, kind: 'bust',
  frames: { rest: 0, 'yaw-12': 1, 'yaw+12': 6, 'lean+10': 9 },
  axes: {
    yaw: [[-12, 1], [-8, 2], [-4, 3], [0, 0], [4, 4], [8, 5], [12, 6]],
    lean: [[-5, 7], [0, 0], [5, 8], [10, 9]],
    nod: [[0, 0], [6, 10], [12, 11]],
    tilt: [[-7, 12], [0, 0], [7, 13]],
    breath: [[0, 0], [1, 14], [2, 15]],
  },
};
const OBJECT = { ...BUST, kind: 'object', axes: { yaw: [[-30, 1], [0, 0], [30, 12]], sweep: [[0, 0], [1, 13], [8, 20]] } };

test('samplePose interpolates along one axis with easing, clamped at the ends', () => {
  const keys = [[0, 'yaw', 0], [100, 'yaw', 10]];
  assert.deepEqual(samplePose(keys, -5), { axis: null, value: 0 });
  assert.deepEqual(samplePose(keys, 50), { axis: 'yaw', value: 5 });   // smoothstep(0.5) = 0.5
  assert.ok(samplePose(keys, 25).value < 2.5);                         // eased in
  assert.deepEqual(samplePose(keys, 500), { axis: 'yaw', value: 10 });
});

test('samplePose passes through rest when switching axes', () => {
  const keys = [[0, 'yaw', 10], [100, 'sweep', 8]];
  const mid = samplePose(keys, 50);
  assert.equal(Math.abs(mid.value) < 1e-9, true);
  assert.equal(samplePose(keys, 20).axis, 'yaw');
  assert.equal(samplePose(keys, 80).axis, 'sweep');
});

test('resolveFrames brackets values and blends neighbours', () => {
  assert.deepEqual(resolveFrames(BUST, { axis: null, value: 0 }), { a: 0, b: 0, mix: 0 });
  assert.deepEqual(resolveFrames(BUST, { axis: 'yaw', value: -10 }), { a: 1, b: 2, mix: 0.5 });
  assert.deepEqual(resolveFrames(BUST, { axis: 'yaw', value: 2 }), { a: 0, b: 4, mix: 0.5 });
  assert.deepEqual(resolveFrames(BUST, { axis: 'yaw', value: 40 }), { a: 6, b: 6, mix: 0 });
  assert.deepEqual(resolveFrames(BUST, { axis: 'sweep', value: 3 }), { a: 0, b: 0, mix: 0 }); // unknown axis → rest
});

test('clip timing: loops wrap, one-shots clamp and finish', () => {
  assert.equal(clipTime(CLIPS.idle, CLIPS.idle.duration + 100), 100);
  assert.equal(isClipDone(CLIPS.idle, 1e9), false);
  assert.equal(clipTime(CLIPS.yourTurn, 5000), CLIPS.yourTurn.duration);
  assert.equal(isClipDone(CLIPS.yourTurn, CLIPS.yourTurn.duration), true);
});

test('non-hold clips end at rest so the static PNG can take over seamlessly', () => {
  for (const [name, clip] of Object.entries(CLIPS)) {
    if (clip.hold || clip.loop) continue;
    const end = sampleClip(clip, clip.duration);
    assert.equal(end.pose.value, 0, `${name} pose`);
    assert.equal(end.css.scale, 1, `${name} scale`);
    assert.equal(end.css.tx, 0, `${name} tx`);
    assert.equal(end.css.ty, 0, `${name} ty`);
    assert.equal(end.css.glow, 0, `${name} glow`);
  }
});

test('every clip key is sorted in time and within its duration', () => {
  for (const [name, clip] of Object.entries(CLIPS)) {
    for (const track of ['pose', 'tx', 'ty', 'scale', 'rot', 'bright', 'glow']) {
      const keys = clip[track];
      if (!keys) continue;
      keys.forEach((k, i) => {
        assert.ok(k[0] >= 0 && k[0] <= clip.duration, `${name}.${track} key in range`);
        if (i) assert.ok(k[0] >= keys[i - 1][0], `${name}.${track} sorted`);
      });
    }
  }
});

test('clipSuitsAtlas keeps bust clips off achievements and vice versa', () => {
  assert.equal(clipSuitsAtlas(CLIPS.yourTurn, BUST), true);
  assert.equal(clipSuitsAtlas(CLIPS.yourTurn, OBJECT), false);
  assert.equal(clipSuitsAtlas(CLIPS.unlockReveal, OBJECT), true);
  assert.equal(clipSuitsAtlas(CLIPS.unlockReveal, BUST), false);
  assert.equal(clipSuitsAtlas(CLIPS.bump, BUST), true); // yaw-only clips fit both
});

test('normalizeAssetPath handles encoded Hebrew, absolute URLs and ./ prefixes', () => {
  assert.equal(normalizeAssetPath('assets/achievements/%D7%90%D7%9C%D7%95%D7%A3.png'), 'assets/achievements/אלוף.png');
  assert.equal(normalizeAssetPath('https://x.web.app/assets/avatars/anonymous%20player.png?v=2'), 'assets/avatars/anonymous player.png');
  assert.equal(normalizeAssetPath('./assets/avatars_v2/common/doctor.png'), 'assets/avatars_v2/common/doctor.png');
  assert.equal(normalizeAssetPath('data:image/png;base64,xx'), null);
  assert.equal(normalizeAssetPath(null), null);
});

test('manifest loads once and looks atlases up by any src shape', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return { ok: true, json: async () => ({ atlases: { 'assets/avatars_v2/common/doctor.png': BUST } }) }; };
  const m = createAtlasManifest({ fetchFn });
  assert.equal(m.lookup('assets/avatars_v2/common/doctor.png'), null); // not loaded yet
  assert.equal(await m.atlasFor('./assets/avatars_v2/common/doctor.png'), BUST);
  assert.equal(await m.atlasFor('assets/avatars/bot.png'), null);
  assert.equal(calls, 1);
});

test('manifest failures degrade to "no atlas"', async () => {
  const m = createAtlasManifest({ fetchFn: async () => { throw new Error('offline'); } });
  assert.equal(await m.atlasFor('assets/avatars/bot.png'), null);
});

test('fitRect mirrors object-fit contain / cover / fill', () => {
  assert.deepEqual(fitRect('contain', 100, 100, 200, 100), { x: 0, y: 25, w: 100, h: 50 });
  assert.deepEqual(fitRect('cover', 100, 100, 200, 100), { x: -50, y: 0, w: 200, h: 100 });
  assert.deepEqual(fitRect('fill', 100, 80, 200, 100), { x: 0, y: 0, w: 100, h: 80 });
});

test('css helpers produce neutral output at rest', () => {
  const rest = { tx: 0, ty: 0, scale: 1, rot: 0, bright: 1, glow: 0 };
  assert.equal(cssFilter(rest), 'none');
  assert.match(cssFilter({ ...rest, glow: 1 }), /drop-shadow/);
  assert.equal(cssTransform(rest), 'translate(0.00%, 0.00%) scale(1.0000) rotate(0.00deg)');
});

test('playOnImg is a no-op without a DOM / clip', async () => {
  assert.equal(await playOnImg(null, 'idle'), false);
  assert.equal(await playOnImg({}, 'nope'), false);
});

test('rarity: tier comes from the asset path and legendary swaps in richer clips', async () => {
  const { tierFromPath, clipNameForTier, TIER_STYLE, CLIPS: C } = await import('./poseClips.js');
  assert.equal(tierFromPath('assets/avatars_v2/legendary/moses.png'), 'legendary');
  assert.equal(tierFromPath('assets/avatars_v2/common/doctor.png'), 'common');
  assert.equal(tierFromPath('assets/avatars/bot.png'), 'default');
  assert.equal(clipNameForTier('idle', 'legendary'), 'idleLegendary');
  assert.equal(clipNameForTier('select', 'legendary'), 'legendEntrance');
  assert.equal(clipNameForTier('idle', 'epic'), 'idle');
  assert.ok(C.idleLegendary.loop && C.legendEntrance.hold);
  assert.ok(TIER_STYLE.legendary.glowScale > TIER_STYLE.rare.glowScale && TIER_STYLE.rare.glowScale > TIER_STYLE.common.glowScale);
  assert.match(cssFilter({ tx: 0, ty: 0, scale: 1, rot: 0, bright: 1, glow: 1 }, TIER_STYLE.legendary), /255,204,84/);
});

test('unlock specials: named achievements get their flourish, other Legend tier gets rays', async () => {
  const { specialFor } = await import('./unlockFx.js');
  assert.equal(specialFor({ id: 'dictionary', tier: 'legend' }), 'letters');
  assert.equal(specialFor({ id: 'streaker', tier: 'silver' }), 'streaks');
  assert.equal(specialFor({ id: 'undefeated', tier: 'gold' }), 'shield');
  assert.equal(specialFor({ id: 'word_genius', tier: 'silver' }), 'halo');
  assert.equal(specialFor({ id: 'boostie_grown', tier: 'silver' }), 'cards');
  assert.equal(specialFor({ id: 'new_boostie', tier: 'gold' }), 'grand');
  assert.equal(specialFor({ id: 'champion', tier: 'legend' }), 'rays');
  assert.equal(specialFor({ id: 'winner', tier: 'bronze' }), null);
  assert.equal(specialFor(null), null);
});

test('progressBumps lists moved, unfinished achievements closest-to-done first', async () => {
  const { progressBumps } = await import('../screens/avatarScreens.js');
  const prev = { stats: { gamesPlayed: 3, longestStreak: 3, gamesWon: 2 } };
  const next = { stats: { gamesPlayed: 4, longestStreak: 4, gamesWon: 5 } };
  const bumps = progressBumps(prev, next);
  assert.equal(bumps.length, 2);
  // winner (5 wins) completed -> excluded; streaker 4/5 (80%) beats first_steps 4/5? tie -> both 80%
  assert.ok(bumps.every(b => b.to > b.from && b.to < b.target));
  assert.ok(!bumps.some(b => b.achievement.id === 'winner'), 'completed achievements go to the unlock overlay');
  assert.deepEqual(progressBumps(next, next), []);
});
