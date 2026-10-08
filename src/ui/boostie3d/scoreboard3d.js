// scoreboard3d — the two live Boosties on the game scoreboard (Phase 3).
//
// One WebGL renderer on an off-screen canvas draws each avatar in turn and copies it into
// a small 2D canvas inside its slot (#is-av1 / #is-av2), over the still <img>, which stays
// underneath as the fallback. Frames are drawn only while something moves: a clip, a
// blink, a spring settling. Between moments the loop sleeps until the next blink or
// signature is due (the board has no looping motion).
//
// Loaded with a dynamic import() from scoreboardLive.js, only on the game screen.

import * as THREE from '../../vendor/three/three.module.min.js';
import { loadModel } from './boostieLoader.js';
import { makeLights, setupLive, preLive, updateLive, nextWake, setMood, glance } from './boostieLive.js';
import { isTooSlow, SLOW_FRAME_MS } from './boostieSources.js';

const FADE = 0.18;
const YAW = 0.6;          // 3/4 view; the avatars face each other (true mirror, not a CSS flip)
const FOV = 30;
const MAX_DPR = 2;
const ON = 'b3d-on';      // on the slot once its 3D is drawn: hides the still <img>

function finderBone(root, name) {
  let hit = null;
  root.traverse((o) => { if (o.name === name && (!hit || (o.isBone && !hit.isBone))) hit = o; });
  return hit;
}

// hosts: the slot elements (the scoreboard's two, or the store preview's one). onFallback(reason) when 3D gives up for this game.
// slowFrameMs: median frame time above which it gives up (Infinity turns the check off).
// lively: keep the eyes and head moving between clips (boostieLive LIVELY; the home top
// bar). yaw: how far the avatar turns from the viewer (radians). full: frame the whole
// body (the game screen) instead of the head-and-chest bust.
export function createScoreboard3d({ hosts, onFallback = () => {}, slowFrameMs = SLOW_FRAME_MS, lively = false, yaw = YAW, full = false }) {
  const doc = hosts[0].ownerDocument;
  const win = doc.defaultView;
  const glCanvas = doc.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  if (!renderer.capabilities.isWebGL2) { renderer.dispose(); throw new Error('WebGL 2 unavailable'); }
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(1);

  const slots = hosts.map((host, i) => ({ i, host, canvas: null, ctx: null, src: null, av: null, token: 0 }));
  let raf = 0, wakeTimer = 0, lastT = 0, skipDelta = true, disposed = false, lost = false, failed = false;
  const frameMs = [];

  // ---------- slot canvases ----------
  function attach(slot) {
    if (!slot.canvas) {
      slot.canvas = doc.createElement('canvas');
      slot.canvas.className = 'b3d-cv';
      slot.canvas.setAttribute('aria-hidden', 'true');
      slot.ctx = slot.canvas.getContext('2d');
    }
    if (!slot.host.contains(slot.canvas)) slot.host.append(slot.canvas);
  }
  function showLive(slot, on) { slot.host.classList.toggle(ON, on && !lost); }

  // The left-hand avatar turns right, the right-hand one left, so they face each other.
  function facesRight(slot) {
    const other = slots[1 - slot.i];
    const a = slot.host.getBoundingClientRect?.(), b = other?.host.getBoundingClientRect?.();
    if (a && b && a.width && b.width) return a.left < b.left;
    return slot.i === 1;   // RTL scoreboard: player 2 sits on the left
  }

  // ---------- avatars ----------
  // The bust the stills show (Blender designs/boosties/render_stills.py): what is above
  // the neck and near the head, so ears and tufts are in, and as much again below it for
  // the shoulders and chest core. Measured on the rest pose, facing forward. Same box as
  // the still underneath, so nothing jumps when the 3D takes over.
  function measureBust(root, box) {
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);
    const headBone = finderBone(root, 'head');
    let body = null;
    root.traverse((o) => { if (o.isMesh && /_body$/.test(o.name)) body = o; });
    if (!headBone || !body) return null;
    const neck = headBone.getWorldPosition(new THREE.Vector3());
    const v = new THREE.Vector3();
    const pos = body.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 6000));
    let top = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.count; i += step) {
      body.getVertexPosition(i, v);
      v.applyMatrix4(body.matrixWorld);
      if (v.y <= neck.y || Math.abs(v.x - neck.x) > span * 0.3 || Math.abs(v.z - neck.z) > span * 0.2) continue;   // not the tail
      top = Math.max(top, v.y); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
    }
    if (!Number.isFinite(top)) return null;
    const hh = top - neck.y;
    // visible height; a head wider than it is tall (Rocco's horns) sets it by its width in the 3/4 view
    const frame = Math.max(hh * 1.9, ((x1 - x0) * Math.cos(yaw) + (z1 - z0) * Math.sin(yaw)) * 1.1);
    return { target: new THREE.Vector3((x0 + x1) / 2, top + hh * 0.14 - frame / 2, (z0 + z1) / 2), frame };
  }

  function frameBust(av) {
    let { target, frame } = av.bust ?? {};
    if (full) {                           // the whole figure, legs and tail included
      const size = av.box.getSize(new THREE.Vector3());
      const across = size.x * Math.cos(yaw) + size.z * Math.sin(yaw);
      target = av.box.getCenter(new THREE.Vector3());
      frame = Math.max(size.y, across) * 1.1;
    } else if (!target) {                        // no head bone: a fixed share of the height
      const size = av.box.getSize(new THREE.Vector3());
      const biped = size.y > size.z;
      target = new THREE.Vector3(0, av.box.min.y + size.y * (biped ? 0.72 : 0.68), biped ? 0 : av.box.max.z * 0.5);
      frame = size.y * (biped ? 0.62 : 0.8);
    }
    const t = target.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), av.root.rotation.y);
    const dist = frame / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    av.camera.near = dist / 50; av.camera.far = dist * 20;
    av.camera.position.copy(t).addScaledVector(new THREE.Vector3(0, 0.18, 1).normalize(), dist);   // a little from above, as the stills
    av.camera.lookAt(t);
    av.camera.updateProjectionMatrix();
    av.camera.updateMatrixWorld();
  }

  function build(gltf, right) {
    const scene = new THREE.Scene();
    scene.add(makeLights(!right));
    const root = gltf.scene;
    scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const clips = gltf.animations;
    const byName = (n) => clips.find((c) => c.name === n) || null;
    const rest = mixer.clipAction(byName('idle') || clips[0]);
    rest.play();
    rest.paused = true;
    mixer.update(0);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);   // measured facing forward, before the 3/4 turn
    const bust = measureBust(root, box);
    root.rotation.y = right ? yaw : -yaw;
    const av = { scene, root, box, bust, mixer, rest, byName, right, clipNames: clips.map((c) => c.name),
      camera: new THREE.PerspectiveCamera(FOV, 1, 0.1, 1000), current: null, kind: null, endAt: 0, idleAt: 0 };
    frameBust(av);
    setupLive(av, performance.now() / 1000, { lively });
    return av;
  }

  function disposeAv(av) {
    if (!av) return;
    av.mixer.stopAllAction();
    av.scene.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) {
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose();   // a shared glow texture re-uploads on next use
        m.dispose();
      }
    });
  }

  async function setAvatar(i, src) {
    const slot = slots[i];
    if (!slot || disposed) return;
    attach(slot);
    if (src === slot.src) return;
    slot.src = src;
    const token = ++slot.token;
    disposeAv(slot.av);
    slot.av = null;
    showLive(slot, false);
    slot.ctx?.clearRect(0, 0, slot.canvas.width, slot.canvas.height);
    if (!src || failed) return;
    try {
      const gltf = await loadModel(src);
      if (disposed || token !== slot.token) return;
      const av = build(gltf, facesRight(slot));
      renderer.compile(av.scene, av.camera);
      slot.av = av;
      drawSlot(slot);
      showLive(slot, true);
      scheduleWake();
    } catch (e) {
      if (token === slot.token) console.warn('[boostie3d] model failed, showing the still', src, e?.message || e);
    }
  }

  // ---------- reactions ----------
  function play(i, kind) {
    const av = slots[i]?.av;
    if (!av || failed || lost) return false;
    const clip = av.byName(kind);
    if (!clip) return false;
    const action = av.mixer.clipAction(clip);
    if (av.current && av.current !== action) av.current.fadeOut(FADE);
    if (av.rest !== action) av.rest.fadeOut(FADE);
    action.reset().setEffectiveWeight(1).fadeIn(FADE).play();
    const now = performance.now() / 1000;
    av.current = action;
    av.kind = kind;
    av.endAt = now + Math.max(0.3, clip.duration - FADE);
    av.idleAt = av.endAt + FADE + 0.05;
    setMood(av, kind, av.endAt);
    if (kind !== 'boost' && kind !== 'signature') {   // the other avatar glances at the one reacting
      const other = slots[1 - i]?.av;
      if (other) glance(other, other.right ? 1 : -1, now + 0.9);
    }
    startLoop();
    return true;
  }

  function settle(av, now) {
    if (!av.current || now < av.endAt) return;
    av.current.fadeOut(FADE);
    av.rest.reset();
    av.rest.paused = true;
    av.rest.fadeIn(FADE).play();
    av.current = null;
    av.kind = null;
  }

  // ---------- drawing ----------
  function drawSlot(slot) {
    const av = slot.av;
    if (!av || lost) return;
    const dpr = Math.min(win.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(slot.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(slot.canvas.clientHeight * dpr));
    if (slot.canvas.width !== w || slot.canvas.height !== h) { slot.canvas.width = w; slot.canvas.height = h; }
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x < w || size.y < h) renderer.setSize(Math.max(size.x, w), Math.max(size.y, h), false);
    av.camera.aspect = w / h;
    av.camera.updateProjectionMatrix();
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(av.scene, av.camera);
    slot.ctx.clearRect(0, 0, w, h);
    slot.ctx.drawImage(glCanvas, 0, glCanvas.height - h, w, h, 0, 0, w, h);
  }
  function drawAll() { for (const s of slots) drawSlot(s); }

  // ---------- loop ----------
  function startLoop() {
    if (raf || disposed || lost || doc.hidden) return;
    win.clearTimeout(wakeTimer);
    lastT = performance.now();
    skipDelta = true;
    raf = win.requestAnimationFrame(tick);
  }

  function scheduleWake() {
    win.clearTimeout(wakeTimer);
    const live = slots.filter((s) => s.av);
    if (raf || disposed || lost || doc.hidden || !live.length) return;
    const at = Math.min(...live.map((s) => nextWake(s.av)));
    if (!Number.isFinite(at)) return;
    wakeTimer = win.setTimeout(startLoop, Math.max(0, at * 1000 - performance.now()));
  }

  function tick(t) {
    raf = 0;
    if (disposed) return;
    const dtMs = t - lastT;
    if (!skipDelta) frameMs.push(dtMs);
    skipDelta = false;
    lastT = t;
    const now = t / 1000;
    const dt = Math.min(dtMs / 1000, 0.05);
    let busy = false;
    for (const s of slots) {
      const av = s.av;
      if (!av) continue;
      preLive(av);
      av.mixer.update(Math.min(dtMs / 1000, 0.1));
      settle(av, now);
      if (updateLive(av, dt, now, (kind) => play(s.i, kind))) busy = true;
      if (now < av.idleAt) busy = true;
    }
    drawAll();
    if (isTooSlow(frameMs, slowFrameMs)) { fallback('slow'); return; }
    if (frameMs.length > 120) frameMs.splice(0, 60);
    if (busy) raf = win.requestAnimationFrame(tick);
    else scheduleWake();
  }

  // ---------- fallbacks ----------
  function fallback(reason) {
    if (failed) return;
    failed = true;
    console.warn('[boostie3d] back to stills:', reason);
    teardown();
    onFallback(reason);
  }

  const onLost = (e) => { e.preventDefault(); lost = true; if (raf) win.cancelAnimationFrame(raf); raf = 0; slots.forEach((s) => showLive(s, false)); };
  const onRestored = () => { lost = false; drawAll(); slots.forEach((s) => showLive(s, !!s.av)); scheduleWake(); };
  const onVisibility = () => {
    if (doc.hidden) { if (raf) win.cancelAnimationFrame(raf); raf = 0; win.clearTimeout(wakeTimer); return; }
    skipDelta = true;
    drawAll();
    scheduleWake();
  };
  glCanvas.addEventListener('webglcontextlost', onLost);
  glCanvas.addEventListener('webglcontextrestored', onRestored);
  doc.addEventListener('visibilitychange', onVisibility);
  let ro = null;
  if (win.ResizeObserver) {
    ro = new win.ResizeObserver(() => { if (!raf) drawAll(); });
    hosts.forEach((h) => ro.observe(h));
  }

  function teardown() {
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
    win.clearTimeout(wakeTimer);
    ro?.disconnect();
    doc.removeEventListener('visibilitychange', onVisibility);
    glCanvas.removeEventListener('webglcontextlost', onLost);
    glCanvas.removeEventListener('webglcontextrestored', onRestored);
    for (const s of slots) {
      s.token++;
      disposeAv(s.av);
      s.av = null;
      showLive(s, false);
      s.canvas?.remove();
    }
    renderer.dispose();
    renderer.forceContextLoss();
  }

  return {
    setAvatar,
    play,
    canPlay: (i) => !!slots[i]?.av && !failed && !lost,
    dispose() { if (disposed) return; disposed = true; if (!failed) teardown(); },
    _slots: slots,   // test hook
  };
}
