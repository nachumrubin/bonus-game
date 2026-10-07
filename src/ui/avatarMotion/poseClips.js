// poseClips — pure data + math for the 2.5D avatar / achievement animations.
//
// Every avatar and achievement has a pose atlas (assets/anim/…, built by
// "Blender designs/icons3d"): a handful of rendered poses along a few axes
//   bust  (avatars):      yaw ±12°, lean −5…10°, nod 6/12°, tilt ±7°, breath 1/2
//   object (achievements): yaw ±30°, sweep 1…8 (metallic light sweep)
// Frame 'rest' is value 0 on every axis and matches the source PNG exactly.
//
// A clip is choreography over that atlas: one `pose` track (axis + value keys)
// plus CSS tracks (tx/ty in % of the element, scale, rot in deg, bright, glow
// 0…1). Keys are [timeMs, value]; pose keys are [timeMs, axis, value]. Between
// two pose keys on different axes the pose passes through 'rest', since the
// atlas has no combined poses.
//
// No DOM here — spritePlayer.js renders what sampleClip() returns.

export const CSS_DEFAULTS = Object.freeze({ tx: 0, ty: 0, scale: 1, rot: 0, bright: 1, glow: 0 });

const ease = (t) => t * t * (3 - 2 * t); // smoothstep: ease-in-out between keys

function sampleKeys(keys, t, fallback) {
  if (!keys?.length) return fallback;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const u = t1 === t0 ? 1 : ease((t - t0) / (t1 - t0));
      return v0 + (v1 - v0) * u;
    }
  }
  return keys[keys.length - 1][1];
}

// → { axis, value } — axis null means 'rest'.
export function samplePose(keys, t) {
  if (!keys?.length) return { axis: null, value: 0 };
  const at = (k) => ({ axis: k[2] === 0 ? null : k[1], value: k[2] });
  if (t <= keys[0][0]) return at(keys[0]);
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i];
    if (t > k1[0]) continue;
    const k0 = keys[i - 1];
    const u = k1[0] === k0[0] ? 1 : ease((t - k0[0]) / (k1[0] - k0[0]));
    if (k0[1] === k1[1] || k0[2] === 0 || k1[2] === 0) {
      const axis = k0[2] !== 0 ? k0[1] : k1[1];
      const value = k0[2] + (k1[2] - k0[2]) * u;
      return { axis: value === 0 ? null : axis, value };
    }
    // different axes: first half back to rest, second half out along the new axis
    return u < 0.5
      ? { axis: k0[1], value: k0[2] * (1 - u * 2) }
      : { axis: k1[1], value: k1[2] * (u * 2 - 1) };
  }
  return at(keys[keys.length - 1]);
}

// Local time inside a clip, honoring loop.
export function clipTime(clip, elapsedMs) {
  if (clip.loop) return ((elapsedMs % clip.duration) + clip.duration) % clip.duration;
  return Math.min(Math.max(elapsedMs, 0), clip.duration);
}

export function isClipDone(clip, elapsedMs) {
  return !clip.loop && elapsedMs >= clip.duration;
}

export function sampleClip(clip, elapsedMs) {
  const t = clipTime(clip, elapsedMs);
  const css = {};
  for (const k of Object.keys(CSS_DEFAULTS)) css[k] = sampleKeys(clip[k], t, CSS_DEFAULTS[k]);
  return { pose: samplePose(clip.pose, t), css };
}

// Which atlas frames to draw for a pose: frame `a` at full opacity, then `b`
// on top at opacity `mix`. `axes` is manifest.axes: { yaw: [[value, index], …] }.
export function resolveFrames(atlas, pose) {
  const rest = atlas?.frames?.rest ?? 0;
  const list = pose?.axis ? atlas?.axes?.[pose.axis] : null;
  if (!list?.length) return { a: rest, b: rest, mix: 0 };
  const v = pose.value;
  if (v <= list[0][0]) return { a: list[0][1], b: list[0][1], mix: 0 };
  const last = list[list.length - 1];
  if (v >= last[0]) return { a: last[1], b: last[1], mix: 0 };
  for (let i = 1; i < list.length; i++) {
    if (v <= list[i][0]) {
      const [v0, i0] = list[i - 1];
      const [v1, i1] = list[i];
      return { a: i0, b: i1, mix: (v - v0) / (v1 - v0) };
    }
  }
  return { a: rest, b: rest, mix: 0 };
}

// ── Clip library ───────────────────────────────────────────────────────────
// Durations follow the proposal and BOOST_MOTION_SPEC (celebration is rare,
// one dominant moment). `hold: true` keeps the final pose until stopped.
export const CLIPS = Object.freeze({
  // Avatars (bust atlas)
  idle: {
    duration: 4200, loop: true,
    pose: [[0, 'breath', 0], [2100, 'breath', 2], [4200, 'breath', 0]],
  },
  glance: { // occasional secondary motion while waiting
    duration: 2000,
    pose: [[0, 'yaw', 0], [450, 'yaw', -10], [1200, 'yaw', -10], [1400, 'yaw', 6], [2000, 'yaw', 0]],
  },
  headTilt: {
    duration: 1600,
    pose: [[0, 'tilt', 0], [400, 'tilt', 7], [1100, 'tilt', 7], [1600, 'tilt', 0]],
  },
  yourTurn: {
    duration: 1100,
    pose: [[0, 'lean', 0], [300, 'lean', 10], [800, 'lean', 8], [1100, 'lean', 0]],
    scale: [[0, 1], [300, 1.06], [1100, 1]],
    glow: [[0, 0], [250, 1], [800, 0.8], [1100, 0]],
  },
  goodMove: {
    duration: 1000,
    pose: [[0, 'nod', 0], [220, 'nod', 12], [480, 'nod', 0], [680, 'nod', 6], [900, 'nod', 0]],
    ty: [[0, 0], [220, -5], [480, 0], [680, -2], [900, 0]],
  },
  boostReact: { // secondary: the board effect stays dominant
    duration: 600,
    pose: [[0, 'lean', 0], [180, 'lean', 5], [600, 'lean', 0]],
    scale: [[0, 1], [180, 1.05], [600, 1]],
    glow: [[0, 0], [150, 0.9], [600, 0]],
  },
  win: {
    duration: 1700, hold: true, burstAt: 500,
    pose: [[0, 'yaw', 0], [400, 'yaw', -12], [1000, 'yaw', 12], [1400, 'yaw', 0]],
    scale: [[0, 1], [500, 1.18], [1700, 1.1]],
    ty: [[0, 0], [500, -4], [1700, -2]],
    glow: [[0, 0], [500, 1], [1700, 0.6]],
  },
  loss: {
    duration: 1000, hold: true,
    pose: [[0, 'lean', 0], [600, 'lean', -5]],
    ty: [[0, 0], [600, 3]],
    scale: [[0, 1], [600, 0.96]],
    bright: [[0, 1], [700, 0.72]],
  },
  select: {
    duration: 450, hold: true, burstAt: 380,
    pose: [[0, 'yaw', 0], [450, 'yaw', 8]],
    ty: [[0, 0], [450, -7]],
    rot: [[0, 0], [450, -3]],
    scale: [[0, 1], [450, 1.04]],
    glow: [[0, 0], [450, 0.8]],
  },
  vsEnterStart: { // slides in from the start side (right in RTL) towards the centre
    duration: 650, hold: true,
    pose: [[0, 'yaw', -12], [650, 'yaw', 0]],
    tx: [[0, 120], [520, -6], [650, 0]],
  },
  vsEnterEnd: {
    duration: 650, hold: true,
    pose: [[0, 'yaw', 12], [650, 'yaw', 0]],
    tx: [[0, -120], [520, 6], [650, 0]],
  },

  idleLegendary: { // legendary avatars: breathing plus a slow sway, bathed in gold light
    duration: 6000, loop: true,
    pose: [[0, 'breath', 0], [1500, 'breath', 2], [3000, 'yaw', 6], [4500, 'breath', 2], [6000, 'breath', 0]],
    glow: [[0, 0.3], [3000, 0.55], [6000, 0.3]],
  },
  legendEntrance: { // legendary custom entrance (store equip / purchase)
    duration: 1300, hold: true, burstAt: 520,
    pose: [[0, 'yaw', -12], [700, 'yaw', 12], [1300, 'yaw', 8]],
    scale: [[0, 0.8], [520, 1.14], [1300, 1.04]],
    ty: [[0, 4], [520, -9], [1300, -7]],
    rot: [[0, 0], [1300, -3]],
    glow: [[0, 0], [520, 1], [1300, 0.8]],
  },

  // Achievements (object atlas)
  unlockReveal: {
    duration: 1500,
    pose: [[0, 'yaw', -30], [700, 'yaw', 10], [950, 'yaw', 0], [1050, 'sweep', 1], [1450, 'sweep', 8], [1500, 'sweep', 0]],
    scale: [[0, 0.35], [700, 1.12], [1000, 1]],
  },
  unlockRevealGrand: { // new_boostie: slower, bigger, a full turn, a longer sweep
    duration: 2100,
    pose: [[0, 'yaw', -30], [650, 'yaw', 30], [1150, 'yaw', 0], [1300, 'sweep', 1], [1950, 'sweep', 8], [2100, 'sweep', 0]],
    scale: [[0, 0.25], [900, 1.18], [1300, 1]],
  },
  glint: {
    duration: 500,
    pose: [[0, 'sweep', 1], [450, 'sweep', 8], [500, 'sweep', 0]],
  },
  bump: {
    duration: 550,
    pose: [[0, 'yaw', 0], [200, 'yaw', 10], [550, 'yaw', 0]],
    scale: [[0, 1], [200, 1.12], [550, 1]],
  },
});

export function getClip(name) {
  return CLIPS[name] ?? null;
}

// Which clips an atlas kind can play (avatars can't sweep, achievements can't nod).
export function clipSuitsAtlas(clip, atlas) {
  const axes = new Set((clip?.pose ?? []).map(k => k[1]).filter(a => a && a !== 0));
  return [...axes].every(a => atlas?.axes?.[a]);
}

// ── Rarity language ─────────────────────────────────────────────────────────
// Common → subtle, Rare → cyan glow, Epic → violet energy + sparkles,
// Legendary → gold light + sparkles + its own idle/entrance. Derived from the
// asset path (assets/avatars_v2/<tier>/…), so callers never pass it.
export const TIER_STYLE = Object.freeze({
  common:    { glowScale: 0.6,  rgb: '0,220,255',   sparkles: false },
  rare:      { glowScale: 1.0,  rgb: '0,220,255',   sparkles: false },
  epic:      { glowScale: 1.15, rgb: '176,120,255', sparkles: true },
  legendary: { glowScale: 1.35, rgb: '255,204,84',  sparkles: true },
  default:   { glowScale: 1.0,  rgb: '0,220,255',   sparkles: false },
});

export function tierFromPath(path) {
  const m = /avatars_v2\/(common|rare|epic|legendary)\//.exec(String(path ?? ''));
  return m ? m[1] : 'default';
}

// Legendary avatars swap in their richer variants of shared clips.
const TIER_CLIP_SWAPS = Object.freeze({ legendary: { idle: 'idleLegendary', select: 'legendEntrance' } });
export function clipNameForTier(name, tier) {
  return TIER_CLIP_SWAPS[tier]?.[name] ?? name;
}
