// boostieLive — what makes a Boostie feel alive between the baked clips (ported from
// tools/3d-spike): eyes that look at the player, blinks and glances, mood lids, a quiet
// "heh" of the jaw, springy ears and tails, glow sprites on the core and tail, a warm rim
// light. Bots have a screen face instead of eyes: they blink by showing the blink face.
//
// The build (Blender designs/boosties/build_boostie.py) gives every model the bones used
// here: eye.L/R, lid.L/R, lidlow.L/R, jaw, ear.L/R, tail.N / tailb.N, face.<expr>, and the
// core_glow / tail_glow anchors. three.js strips the dots: 'eye.L' loads as 'eyeL'.

import * as THREE from '../../vendor/three/three.module.min.js';
import { SCREEN_FACES, FACE_HIDE, CLIPS_WITH_LIDS } from './boostieSources.js';

// lid angle in degrees from the build's rest lid, per mood
const LID = { smug: 0, turn: 14, boost: 26, good: -24, laugh: -26, wow: 30, stare: 36, yawn: -58, closed: -82 };
const LIDLOW = { good: 5, laugh: 9 };   // lower lid (almond eyes only); positive raises it: a smiling squint
const SPRING = { ear: { k: 170, c: 13, couple: 26 }, tail: { k: 80, c: 8, couple: 12 } };
const SPRING_BONES = [['earL', 'ear'], ['earR', 'ear'], ['tail1', 'tail'], ['tail2', 'tail'], ['tail3', 'tail'], ['tail4', 'tail'],
  ['tailb1', 'tail'], ['tailb2', 'tail'], ['tailb3', 'tail'], ['tailb4', 'tail']];
const GLOWS = [['core_glow', 0.15, 0.4], ['tail_glow', 0.45, 0.2], ['tail_glow_b', 0.45, 0.2]];

const rnd = (a, b) => a + Math.random() * (b - a);
const V = () => new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0);
const _v = V(), _v2 = V(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const deg = THREE.MathUtils.degToRad;

function quatToVec(q, out) {          // rotation as axis * angle
  const qq = q.w < 0 ? _q2.set(-q.x, -q.y, -q.z, -q.w) : q;
  const s = Math.sqrt(Math.max(0, 1 - qq.w * qq.w));
  if (s < 1e-6) return out.set(0, 0, 0);
  return out.set(qq.x / s, qq.y / s, qq.z / s).multiplyScalar(2 * Math.acos(Math.min(1, qq.w)));
}
function vecToQuat(v, out) {
  const a = v.length();
  return a < 1e-9 ? out.identity() : out.setFromAxisAngle(_v2.copy(v).divideScalar(a), a);
}

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// Key, rim and fill lights; `mirror` for the avatar facing the other way.
export function makeLights(mirror) {
  const s = mirror ? -1 : 1;
  const g = new THREE.Group();
  g.add(new THREE.HemisphereLight(0xd6ecff, 0x3a2418, 0.7));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.6); key.position.set(1.6 * s, 2.6, 3); g.add(key);
  const rim = new THREE.DirectionalLight(0xcfeaff, 1.8); rim.position.set(-2.2 * s, 2.2, -3); g.add(rim);
  const fill = new THREE.DirectionalLight(0xffcfa8, 0.6); fill.position.set(-2 * s, 0.4, 2); g.add(fill);
  return g;
}

// Bones share names with their meshes ('lid.L' is both); prefer the bone.
function finder(root) {
  return (name) => {
    let hit = null;
    root.traverse((o) => { if (o.name === name && (!hit || (o.isBone && !hit.isBone))) hit = o; });
    return hit;
  };
}

// Lively mode (the home top bar, where the avatar is tiny and has nothing else to do):
// the eyes keep looking around and the head follows them, with a slow sway.
const LIVELY = { lookEvery: [0.8, 2.4], gazeX: 1.8, gazeY: [-0.6, 0.9], center: 0.3, headYaw: 18, headPitch: 10, swayRoll: 4, follow: 3 };

// Eyes. The build aims each eyeball along its own face normal, so the two rest directions
// splay 15-47 degrees apart and not symmetrically. Aimed at the viewer, one eye then hit
// its turning limit before the other and the eyes looked different ways. So at load both
// rests are re-aimed to one shared forward, splayed EYE_SPLAY outward and mirrored, and
// both eyes then turn by the same share of the way to the target.
const EYE_SPLAY = 0.08, GAZE_MAX = 0.45;   // radians
function alignEyes(eyes, root) {
  if (eyes.length !== 2) return;
  root.updateMatrixWorld(true);
  const parts = eyes.map((e) => {
    const wq = e.bone.getWorldQuaternion(new THREE.Quaternion());
    return { e, wq, fwd: Y_AXIS.clone().applyQuaternion(wq), pos: e.bone.getWorldPosition(new THREE.Vector3()) };
  });
  const mean = parts[0].fwd.clone().add(parts[1].fwd).normalize();
  const side = parts[0].pos.clone().sub(parts[1].pos);
  side.addScaledVector(mean, -side.dot(mean)).normalize();     // eye 1 -> eye 0, across the face
  parts.forEach((p, i) => {
    const want = mean.clone().addScaledVector(side, (i ? -1 : 1) * Math.tan(EYE_SPLAY)).normalize();
    const pq = p.e.bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const turn = new THREE.Quaternion().setFromUnitVectors(p.fwd, want);
    p.e.rest = pq.clone().invert().multiply(turn).multiply(pq).multiply(p.e.rest);
  });
}
// Both eyes look along the SAME direction (from the middle between them to the target), not
// each at the target: with eyes set wide apart on the sides of the head (the ram, the
// axolotl) and the camera close, aiming each eye at the camera made them converge hard and
// look cross-eyed.
function aimEyes(eyes, tgt) {
  const mid = new THREE.Vector3();
  eyes.forEach((eye) => mid.add(eye.bone.getWorldPosition(new THREE.Vector3())));
  mid.multiplyScalar(1 / eyes.length);
  const gaze = tgt.clone().sub(mid).normalize();
  const qs = eyes.map((eye) => {
    const inv = eye.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const dir = gaze.clone().applyQuaternion(inv);
    return new THREE.Quaternion().setFromUnitVectors(Y_AXIS.clone().applyQuaternion(eye.rest), dir);
  });
  const most = Math.max(...qs.map((q) => 2 * Math.acos(Math.min(1, Math.abs(q.w)))));
  const t = most > GAZE_MAX ? GAZE_MAX / most : 1;           // the same share for both eyes
  eyes.forEach((eye, i) => eye.bone.quaternion.copy(qs[i].slerp(new THREE.Quaternion(), 1 - t)).multiply(eye.rest));
}

// av: { root, box, clipNames }. Adds av.live and av.rim.
// lively: keep moving between clips (see LIVELY); the scoreboard leaves it off.
export function setupLive(av, now, { lively = false } = {}) {
  const get = finder(av.root);
  const L = { eyes: [], lids: [], lows: [], low: 0, springs: [], sprites: [], faces: null, head: get('head'), mood: 'smug', moodUntil: 0, lid: 0,
    blinkAt: now + rnd(1.2, 3.5), blinkT: -1, double: false, flickAt: now + rnd(5, 10),
    sigAt: now + rnd(6, 12), hasSig: av.clipNames.includes('signature'),
    jaw: null, hehAt: now + rnd(8, 15), hehT: -1,
    gaze: V(), gazeTarget: V(), glanceUntil: 0, headPrev: new THREE.Quaternion(), headInit: false,
    lively, lookAt: now + 0.6, headLook: V(), headW: 1, headAnim: null };
  if (lively && L.head) L.headAnim = L.head.quaternion.clone();
  for (const s of ['L', 'R']) {
    const eye = get('eye' + s), lid = get('lid' + s), low = get('lidlow' + s);
    if (eye) L.eyes.push({ bone: eye, rest: eye.quaternion.clone() });
    if (lid) L.lids.push({ bone: lid, rest: lid.quaternion.clone(), side: s });
    if (low) L.lows.push({ bone: low, rest: low.quaternion.clone() });
  }
  alignEyes(L.eyes, av.root);
  const faces = SCREEN_FACES.map((f) => [f, get('face' + f)]).filter(([, b]) => b);
  if (faces.length) L.faces = Object.fromEntries(faces);
  if (!L.lids.length && !L.faces?.blink) L.blinkAt = Infinity;   // nothing to blink with
  const jaw = get('jaw');
  if (jaw) L.jaw = { bone: jaw, anim: jaw.quaternion.clone() };
  for (const [n, kind] of SPRING_BONES) {
    const b = get(n);
    if (b) L.springs.push({ bone: b, kind, anim: b.quaternion.clone(), sim: b.quaternion.clone(), w: V() });
  }
  if (!L.springs.length) L.flickAt = Infinity;
  const h = av.box.getSize(V()).y;
  // Bots light their chest in their own colour; the cyan core glow is a Boostie thing.
  for (const [n, size, opacity] of L.faces ? [] : GLOWS) {
    const node = get(n);
    if (!node) continue;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x38d6ff, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    sp.scale.setScalar(h * size);
    sp.renderOrder = 10;
    node.add(sp);
    L.sprites.push(sp);
  }
  // flash: 0..1 fades the whole body to flashColor (the evolution scene's silhouette flash).
  av.rim = { rimStrength: { value: 0.4 }, rimColor: { value: new THREE.Color(1.0, 0.86, 0.72) },
    flash: { value: 0 }, flashColor: { value: new THREE.Color(0.86, 0.97, 1.0) } };
  av.root.traverse((o) => {
    if (!o.isMesh || /eye/i.test(o.name)) return;
    for (const m of [].concat(o.material)) {
      if (m.transparent && L.faces) {   // screen faces: the bot's exact colour, not tone-mapped to white
        m.toneMapped = false;
        m.emissiveIntensity = 1;
        continue;
      }
      if (!m.isMeshStandardMaterial) continue;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.rimStrength = av.rim.rimStrength;
        sh.uniforms.rimColor = av.rim.rimColor;
        sh.uniforms.flash = av.rim.flash;
        sh.uniforms.flashColor = av.rim.flashColor;
        sh.fragmentShader = 'uniform float rimStrength;\nuniform vec3 rimColor;\nuniform float flash;\nuniform vec3 flashColor;\n' + sh.fragmentShader
          .replace('#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\n{ float rimF = 1.0 - saturate(dot(normalize(normal), normalize(vViewPosition)));\n' +
            '  totalEmissiveRadiance += rimColor * diffuseColor.rgb * pow(rimF, 3.0) * rimStrength; }')
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, flashColor, flash);');
      };
      m.customProgramCacheKey = () => 'boostie-rim';
      m.needsUpdate = true;
    }
  });
  av.live = L;
}

// Before the mixer runs: give spring bones back their animated pose, so bones the clip
// doesn't touch keep a stable target instead of the spring's own output.
export function preLive(av) {
  av.live.springs.forEach((sp) => sp.bone.quaternion.copy(sp.anim));
  if (av.live.jaw) av.live.jaw.bone.quaternion.copy(av.live.jaw.anim);
  if (av.live.headAnim) av.live.head.quaternion.copy(av.live.headAnim);
}

// Lively mode: pick a new place to look now and then, and turn the head after the eyes
// (slower than the eyes, so it reads as looking around). Fades out while a clip plays,
// so the clip's own head motion stays clean.
function livelyHead(av, dt, now) {
  const L = av.live;
  if (!av.current && now >= L.lookAt && now > L.glanceUntil) {
    if (Math.random() < LIVELY.center) L.gazeTarget.set(0, 0, 0);
    else L.gazeTarget.set(rnd(-LIVELY.gazeX, LIVELY.gazeX), rnd(...LIVELY.gazeY), 0);
    L.lookAt = now + rnd(...LIVELY.lookEvery);
  }
  if (!L.headAnim) return;
  L.headAnim.copy(L.head.quaternion);
  L.headW += ((av.current ? 0 : 1) - L.headW) * Math.min(1, dt * 4);
  L.headLook.lerp(L.gazeTarget, Math.min(1, dt * LIVELY.follow));
  const yaw = deg(L.headLook.x * LIVELY.headYaw) * L.headW;
  const pitch = deg(L.headLook.y * LIVELY.headPitch) * L.headW;
  const roll = deg(Math.sin(now * 0.7) * LIVELY.swayRoll) * L.headW;
  av.root.updateMatrixWorld(true);
  const right = V().setFromMatrixColumn(av.camera.matrixWorld, 0);
  const fwd = V().setFromMatrixColumn(av.camera.matrixWorld, 2);
  const turn = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw)
    .multiply(_q.setFromAxisAngle(right, -pitch))
    .multiply(_q2.setFromAxisAngle(fwd, roll));
  const world = L.head.getWorldQuaternion(new THREE.Quaternion()).premultiply(turn);
  L.head.quaternion.copy(L.head.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
}

// A reaction starts: the face takes the mood, the eyes come back to the viewer.
export function setMood(av, kind, until) {
  const L = av.live;
  if (!(kind in LID)) return;
  L.mood = kind;
  L.moodUntil = until;
  L.gazeTarget.set(0, 0, 0);
  L.glanceUntil = 0;
}

// Look sideways for a moment (dir +1 = to the camera's right).
export function glance(av, dir, until) {
  av.live.gazeTarget.set(2.4 * dir, 0.1, 0);
  av.live.glanceUntil = until;
}

// After the mixer: signature, springs, jaw, lids, gaze. `play(kind)` starts a clip.
// Returns true while something is still moving.
export function updateLive(av, dt, now, play) {
  const L = av.live;
  let busy = L.lively;                  // lively: always something moving
  if (L.lively) livelyHead(av, dt, now);
  const hv = V();                       // head motion this frame kicks the ears and tail
  if (L.head) {
    L.head.getWorldQuaternion(_q);
    if (L.headInit) quatToVec(_q2.copy(L.headPrev).invert().premultiply(_q), hv);
    L.headPrev.copy(_q);
    L.headInit = true;
  }
  if (L.hasSig && now >= L.sigAt) {     // the character's own movement, now and then
    if (!av.current) play('signature');
    L.sigAt = now + rnd(10, 20);
  }
  if (!L.hasSig && now >= L.flickAt) {  // generic ear flick for models without a signature
    const ears = L.springs.filter((s) => s.kind === 'ear');
    const ear = ears[Math.floor(Math.random() * ears.length)] || L.springs[0];
    ear.w.add(V().set(rnd(-1, 1), rnd(-0.3, 0.3), rnd(-1, 1)).normalize().multiplyScalar(rnd(5, 8)));
    L.flickAt = now + rnd(7, 14);
  }
  if (L.jaw) {                          // the clip's jaw, plus a quiet two-beat "heh" (negative X opens)
    L.jaw.anim.copy(L.jaw.bone.quaternion);
    if (L.hehT < 0 && now >= L.hehAt) {
      if (!av.current) L.hehT = 0;
      L.hehAt = now + rnd(12, 24);
    }
    let open = 0;
    if (L.hehT >= 0) {
      const t = (L.hehT += dt) / 0.55;
      open = 9 * Math.pow(Math.sin(Math.PI * 2 * Math.min(1, t)), 2) * (t < 0.5 ? 1 : 0.6);
      busy = true;
      if (t >= 1) L.hehT = -1;
    }
    L.jaw.bone.quaternion.copy(L.jaw.anim).multiply(_q.setFromAxisAngle(X_AXIS, -deg(open)));
  }
  const e = V();
  for (const sp of L.springs) {
    const c = SPRING[sp.kind];
    sp.anim.copy(sp.bone.quaternion);
    quatToVec(_q.copy(sp.anim).multiply(_q2.copy(sp.sim).invert()), e);
    sp.w.addScaledVector(e, c.k * dt).addScaledVector(sp.w, -c.c * dt).addScaledVector(hv, -c.couple);
    sp.sim.premultiply(vecToQuat(_v.copy(sp.w).multiplyScalar(dt), _q)).normalize();
    sp.bone.quaternion.copy(sp.sim);
    if (sp.w.length() > 0.03 || e.length() > 0.004) busy = true;
  }
  // blink timing (lids, or the bot's blink face)
  if (L.blinkT < 0 && now >= L.blinkAt) L.blinkT = 0;
  let blink = 0;
  if (L.blinkT >= 0) {
    const d = 0.17;
    L.blinkT += dt;
    blink = Math.sin(Math.PI * Math.min(1, L.blinkT / d));
    busy = true;
    if (L.blinkT >= d) {
      L.blinkT = -1;
      if (L.double) { L.double = false; L.blinkAt = now + 0.1; }
      else {
        L.blinkAt = now + rnd(2.2, 5.5);
        L.double = Math.random() < 0.2;
        if (now > L.glanceUntil) L.gazeTarget.set(rnd(-0.8, 0.8), rnd(-0.4, 0.5), 0);   // eyes shift with a blink
      }
    }
  }
  // Screen face: the clips switch faces by scale (1 shown, FACE_HIDE hidden). Snap each
  // face to one or the other: the exported keys are linear and crossfades blend them, and
  // a part-scaled face shrinks toward its bone behind the curved glass and vanishes.
  // Between clips a blink shows the blink face.
  if (L.faces) {
    const blinking = !av.current && blink > 0.5 && L.faces.blink;
    let shown = null, best = 0;
    for (const [f, b] of Object.entries(L.faces)) if (b.scale.x > best) { best = b.scale.x; shown = f; }
    if (blinking) shown = 'blink';
    for (const [f, b] of Object.entries(L.faces)) b.scale.setScalar(f === shown ? 1 : FACE_HIDE);
  }
  // Lids: mood + blink. A clip that keys the lids itself (wink) keeps them.
  const lidClip = av.current && CLIPS_WITH_LIDS.includes(av.kind);
  const mood = now < L.moodUntil ? L.mood : 'smug';
  const target = LID[mood], lowTarget = LIDLOW[mood] || 0;
  L.lid += (target - L.lid) * Math.min(1, dt * 10);
  L.low += (lowTarget - L.low) * Math.min(1, dt * 10);
  if (L.lids.length && (Math.abs(target - L.lid) > 0.3 || Math.abs(lowTarget - L.low) > 0.1)) busy = true;
  if (!lidClip) {
    const lidDeg = L.lid + (LID.closed - L.lid) * blink;
    for (const l of L.lids) l.bone.quaternion.copy(l.rest).multiply(_q.setFromAxisAngle(X_AXIS, deg(lidDeg)));
    for (const l of L.lows) l.bone.quaternion.copy(l.rest).multiply(_q.setFromAxisAngle(X_AXIS, deg(L.low * (1 - blink))));
  }
  // gaze: look at the viewer (the camera), offset by the current glance
  if (L.glanceUntil && now > L.glanceUntil) { L.glanceUntil = 0; L.gazeTarget.set(0, 0, 0); }
  L.gaze.lerp(L.gazeTarget, Math.min(1, dt * 22));
  if (L.eyes.length) {
    if (L.gaze.distanceTo(L.gazeTarget) > 0.01) busy = true;
    av.root.updateMatrixWorld(true);
    const cam = av.camera, S = av.box.getSize(_v).y * 0.35;
    const tgt = V().copy(cam.position)
      .addScaledVector(V().setFromMatrixColumn(cam.matrixWorld, 0), L.gaze.x * S)
      .addScaledVector(V().setFromMatrixColumn(cam.matrixWorld, 1), L.gaze.y * S);
    aimEyes(L.eyes, tgt);
  }
  return busy;
}

// Seconds (performance clock) when this avatar next needs a frame; 0 = now.
export function nextWake(av) {
  const L = av.live;
  if (L.blinkT >= 0 || L.hehT >= 0) return 0;
  return Math.min(L.blinkAt, L.hasSig ? L.sigAt : L.flickAt, L.jaw ? L.hehAt : Infinity);
}
