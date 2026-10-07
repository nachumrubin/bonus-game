// evolutionScene — the level-up transformation, full body, in its own renderer (Phase 4).
//
//   0 – 1.7 s   the old form plays `boost`: rim light and a white glow build up, light
//               particles gather at the chest core
//   1.7 – 1.95  both forms go white (silhouette flash); the models swap at the peak
//   1.95 – 2.6  the new form pops 0.9 → 1.0 as the flash fades, then plays
//               `signature` and `good` while the camera orbits about 30°
//
// Loaded with a dynamic import() from evolutionScreen.js; the card, the sounds and the
// stills fallback live there. Throws when WebGL 2 is missing or a model fails to load.

import * as THREE from '../../vendor/three/three.module.min.js';
import { loadModel } from './boostieLoader.js';
import { makeLights, setupLive, preLive, updateLive, setMood } from './boostieLive.js';
import { EVO_T, flashAt, smooth, easeOutBack } from './evolutionData.js';

const FOV = 30;
const FADE = 0.2;
const MAX_DPR = 2;
const YAW = 0.32;            // a light 3/4 view
const ORBIT = 0.52;          // ~30°
const PARTICLES = 70;

function find(root, name) {
  let hit = null;
  root.traverse((o) => { if (o.name === name && (!hit || (o.isBone && !hit.isBone))) hit = o; });
  return hit;
}

function dotTexture(doc) {
  const c = doc.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(190,240,255,0.6)'); grd.addColorStop(1, 'rgba(56,214,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}

// canvas: the stage <canvas>. Resolves once both models are loaded and compiled.
export async function createEvolutionScene({ canvas, fromSrc, toSrc }) {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  if (!renderer.capabilities.isWebGL2) { renderer.dispose(); throw new Error('WebGL 2 unavailable'); }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);

  let disposed = false;
  const scene = new THREE.Scene();
  scene.add(makeLights(false));
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);

  let gltfs;
  try {
    gltfs = await Promise.all([loadModel(fromSrc), loadModel(toSrc)]);
  } catch (e) {
    renderer.dispose();
    throw e;
  }
  if (disposed) return null;

  function makeAv(gltf) {
    // loadModel parses afresh each call, so the scoreboard's copy is never touched.
    const root = gltf.scene;
    const mixer = new THREE.AnimationMixer(root);
    const clips = gltf.animations;
    const byName = (n) => clips.find((c) => c.name === n) || null;
    const rest = mixer.clipAction(byName('idle') || clips[0]);
    rest.play();
    rest.paused = true;
    mixer.update(0);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    root.rotation.y = YAW;
    const av = { root, box, camera, mixer, rest, byName, clipNames: clips.map((c) => c.name), current: null, kind: null, endAt: 0, queue: [] };
    setupLive(av, performance.now() / 1000);
    av.live.sigAt = Infinity;   // the scene plays signature itself
    return av;
  }
  const from = makeAv(gltfs[0]);
  const to = makeAv(gltfs[1]);
  scene.add(from.root, to.root);
  to.root.visible = false;

  // Frame both forms full-body from the bigger one, so the new form visibly fills more.
  const big = new THREE.Box3().union(from.box).union(to.box);
  const size = big.getSize(new THREE.Vector3());
  const target = new THREE.Vector3(0, big.min.y + size.y * 0.5, (big.min.z + big.max.z) / 2);

  // Light gathering at the chest core.
  const coreNode = find(from.root, 'core_glow') || find(from.root, 'chest');
  const core = new THREE.Vector3();
  if (coreNode) coreNode.getWorldPosition(core); else core.set(0, from.box.min.y + from.box.getSize(new THREE.Vector3()).y * 0.5, from.box.max.z * 0.6);
  const starts = new Float32Array(PARTICLES * 3);
  const delays = new Float32Array(PARTICLES);
  const radius = size.y * 0.75;
  for (let i = 0; i < PARTICLES; i++) {
    const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1), r = radius * (0.7 + Math.random() * 0.5);
    starts.set([core.x + r * Math.sin(b) * Math.cos(a), core.y + r * Math.cos(b) * 0.8, core.z + r * Math.sin(b) * Math.sin(a) * 0.6], i * 3);
    delays[i] = Math.random() * 0.6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(starts), 3));
  const pmat = new THREE.PointsMaterial({ map: dotTexture(doc), size: size.y * 0.06, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, color: 0xbff4ff });
  const points = new THREE.Points(geo, pmat);
  points.renderOrder = 20;
  scene.add(points);

  function play(av, kind) {
    const clip = av.byName(kind);
    if (!clip) return false;
    const action = av.mixer.clipAction(clip);
    if (av.current && av.current !== action) av.current.fadeOut(FADE);
    if (av.rest !== action) av.rest.fadeOut(FADE);
    action.reset().setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveWeight(1).fadeIn(FADE).play();
    av.current = action;
    av.kind = kind;
    av.endAt = performance.now() / 1000 + Math.max(0.3, clip.duration - FADE);
    setMood(av, kind, av.endAt);
    return true;
  }
  function settle(av, now) {
    if (!av.current || now < av.endAt) return;
    const next = av.queue.shift();
    if (next && play(av, next)) return;
    av.current.fadeOut(FADE);
    av.rest.reset();
    av.rest.paused = true;
    av.rest.fadeIn(FADE).play();
    av.current = null;
    av.kind = null;
  }

  // ---------- frame ----------
  let t = 0, raf = 0, lastT = 0, swapped = false, startedFrom = false, startedTo = false;
  const listeners = { flash: [], swap: [], card: [] };

  function resize() {
    const dpr = Math.min(win.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Fit the tallest form with room for the pop and the orbit (and the width on wide screens).
    const frame = Math.max(size.y * 1.12, (Math.max(size.x, size.z) * 1.3) / camera.aspect);
    const dist = frame / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    camera.near = dist / 50; camera.far = dist * 20;
    camera.userData.dist = dist;
    camera.updateProjectionMatrix();
  }

  function placeCamera() {
    // A slow push-in while charging, then the orbit after the swap.
    const push = 1 - 0.08 * smooth(t / EVO_T.flashPeak);
    const orbit = ORBIT * (smooth((t - EVO_T.flashPeak) / (EVO_T.orbitEnd - EVO_T.flashPeak)) - 0.5);
    const dir = new THREE.Vector3(Math.sin(orbit), 0.16, Math.cos(orbit)).normalize();
    camera.position.copy(target).addScaledVector(dir, camera.userData.dist * push);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  function step(dt) {
    const now = performance.now() / 1000;
    const prevT = t;
    t += dt;
    if (!startedFrom) { startedFrom = true; play(from, 'boost'); }

    // charge + flash
    const f = flashAt(t);
    const charge = smooth(t / EVO_T.charge);
    from.rim.rimStrength.value = 0.4 + 2.6 * charge;
    from.rim.rimColor.value.setRGB(1 - 0.6 * charge, 0.86 + 0.1 * charge, 0.72 + 0.28 * charge);
    from.rim.flash.value = t < EVO_T.flashPeak ? f : 1;
    to.rim.flash.value = t >= EVO_T.flashPeak ? f : 1;
    to.rim.rimStrength.value = 0.4 + 2.0 * (1 - smooth((t - EVO_T.flashPeak) / 1.2));

    // particles: gather at the core, gone by the flash
    const pos = geo.attributes.position;
    for (let i = 0; i < PARTICLES; i++) {
      const k = smooth((t - delays[i]) / (EVO_T.flashPeak - 0.6));
      pos.setXYZ(i, starts[i * 3] + (core.x - starts[i * 3]) * k, starts[i * 3 + 1] + (core.y - starts[i * 3 + 1]) * k,
        starts[i * 3 + 2] + (core.z - starts[i * 3 + 2]) * k);
    }
    pos.needsUpdate = true;
    pmat.opacity = t < EVO_T.flashPeak ? 0.9 * smooth(t / 0.4) : 0.9 * (1 - smooth((t - EVO_T.flashPeak) / 0.25));

    // swap at the peak
    if (!swapped && t >= EVO_T.flashPeak) {
      swapped = true;
      from.root.visible = false;
      to.root.visible = true;
      listeners.swap.forEach((fn) => fn());
    }
    if (prevT < EVO_T.charge && t >= EVO_T.charge) listeners.flash.forEach((fn) => fn());
    if (prevT < EVO_T.card && t >= EVO_T.card) listeners.card.forEach((fn) => fn());
    if (swapped) {
      to.root.scale.setScalar(0.9 + 0.1 * easeOutBack((t - EVO_T.flashPeak) / (EVO_T.popEnd - EVO_T.flashPeak)));
      if (!startedTo && t >= EVO_T.flashPeak + 0.3) {
        startedTo = true;
        to.queue = ['good'];
        if (!play(to, 'signature')) play(to, to.queue.shift());
      }
    }

    for (const av of swapped ? [to] : [from]) {
      preLive(av);
      av.mixer.update(dt);
      settle(av, now);
      updateLive(av, Math.min(dt, 0.05), now, (kind) => play(av, kind));
    }
    placeCamera();
    renderer.render(scene, camera);
  }

  function tick(ms) {
    raf = 0;
    if (disposed) return;
    const dt = lastT ? Math.min((ms - lastT) / 1000, 0.1) : 0;
    lastT = ms;
    step(dt);
    raf = win.requestAnimationFrame(tick);
  }

  const ro = win.ResizeObserver ? new win.ResizeObserver(() => { resize(); if (!raf) step(0); }) : null;
  ro?.observe(canvas);
  resize();
  placeCamera();
  renderer.compile(scene, camera);
  // Compile the white-flash path for the new form too, so the swap doesn't stall.
  to.root.visible = true;
  renderer.compile(scene, camera);
  to.root.visible = false;
  step(0);

  return {
    start() { if (!raf && !disposed) { lastT = 0; raf = win.requestAnimationFrame(tick); } },
    // Jump to the end state (new form, no flash, orbit done).
    skip() {
      if (disposed || t >= EVO_T.orbitEnd) return;
      startedFrom = true;
      t = EVO_T.orbitEnd - 0.0001;
      if (!swapped) { swapped = true; from.root.visible = false; to.root.visible = true; listeners.swap.forEach((fn) => fn()); }
      startedTo = true;
      to.queue = [];
      to.root.scale.setScalar(1);
      step(0.0001);
    },
    onFlash(fn) { listeners.flash.push(fn); },
    onSwap(fn) { listeners.swap.push(fn); },
    // Scene time, not the clock: on a slow phone the card still lands after the reveal.
    onCard(fn) { listeners.card.push(fn); },
    get time() { return t; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) win.cancelAnimationFrame(raf);
      ro?.disconnect();
      for (const av of [from, to]) av.mixer.stopAllAction();
      disposeTree(scene);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

