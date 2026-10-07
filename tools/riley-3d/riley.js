// Riley the dog: a hand-built three.js model made from Riley's photos.
//
// buildRiley(THREE, mergeVertices) returns { root, clips }.
//   root  - a Group, dog facing +z, feet on y = 0, about 1 unit long.
//   clips - AnimationClips "idle", "wag" and "tilt" that drive the named parts
//           (head, ear_L/R, eye_L/R, tail, torso).
// Markings come from the photos: white coat, brown saddle over the left hip,
// brown patches on the right shoulder and the rump, brown head sides with a white
// blaze, dark "mascara" round big dark eyes, feathered brown ears with black tips,
// a white plumed tail curled over the back, and a pink harness with a bone tag.
// The dog's left is +x.

export function buildRiley(THREE, mergeVertices) {
  const col = (h) => new THREE.Color(h);
  const C = {
    white: col('#f6f1e9'), cream: col('#ecdcc4'), brown: col('#a8581d'), auburn: col('#c27a3c'),
    brownDark: col('#5a2a10'), black: col('#1a1210'), rim: col('#6e3326'), pink: col('#e66f9b'),
    pinkDeep: col('#c94f7d'), grey: col('#a3a8ad'), tongue: col('#e07a86'),
  };

  // ---- small noise helpers (fur grain and ragged patch edges) ----
  const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
  const sm = (t) => t * t * (3 - 2 * t);
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    const h = (i, j, k) => hash(xi + i, yi + j, zi + k);
    return l(l(l(h(0, 0, 0), h(1, 0, 0), xf), l(h(0, 1, 0), h(1, 1, 0), xf), yf),
             l(l(h(0, 0, 1), h(1, 0, 1), xf), l(h(0, 1, 1), h(1, 1, 1), xf), yf), zf);
  }
  const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return sm(t); };
  // 0..1 weight of a soft, ragged-edged patch around c
  function patch(P, c, r, scale = [1, 1, 1]) {
    const dx = (P.x - c[0]) / scale[0], dy = (P.y - c[1]) / scale[1], dz = (P.z - c[2]) / scale[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + (vnoise(P.x * 9, P.y * 9, P.z * 9) - 0.5) * 0.09;
    return 1 - smoothstep(r - 0.025, r + 0.025, d);
  }
  const mix = (a, b, t) => a.clone().lerp(b, Math.min(1, Math.max(0, t)));

  const furMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const glossMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0 });
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x120c0a, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 });
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const tagMat = new THREE.MeshStandardMaterial({ color: C.pinkDeep, roughness: 0.25, metalness: 0.75 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.2, metalness: 0.9 });

  // Write positions (minus pivot) and vertex colours, then weld seams for smooth normals.
  function finish(g, colours, pivot) {
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    if (pivot) g.translate(-pivot[0], -pivot[1], -pivot[2]);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const m = mergeVertices(g, 1e-5);
    m.computeVertexNormals();
    return m;
  }
  const grain = (c, P, amt = 0.07) => c.multiplyScalar(1 + amt * (vnoise(P.x * 38, P.y * 38, P.z * 38) - 0.5) * 2);

  // Ellipsoid baked into dog space. o: {c, r, rot?, deform?(unit v), color(P) -> Color, seg?, pivot?}
  function blob(o) {
    const [ws, hs] = o.seg || [48, 32];
    const g = new THREE.SphereGeometry(1, ws, hs);
    const pos = g.attributes.position, cs = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3(), e = o.rot ? new THREE.Euler(...o.rot) : null;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (o.deform) o.deform(v);
      v.set(v.x * o.r[0], v.y * o.r[1], v.z * o.r[2]);
      if (e) v.applyEuler(e);
      v.add(new THREE.Vector3(...o.c));
      const c = grain(o.color(v).clone(), v, o.grain ?? 0.07);
      cs.set([c.r, c.g, c.b], i * 3);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    return finish(g, cs, o.pivot);
  }

  // Tube along a curve with a per-ring radius profile; fluffy = radius noise.
  function tube(curve, segs, radial, radius, color, pivot, fluffy = 0) {
    const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
    const pos = g.attributes.position, cs = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / (radial + 1)), t = ring / segs;
      const p = curve.getPointAt(t);
      v.fromBufferAttribute(pos, i).sub(p);
      const n = 1 + fluffy * (vnoise(v.x * 30 + t * 7, v.y * 30, v.z * 30 + t * 11) - 0.5) * 2;
      v.multiplyScalar(radius(t) * n).add(p);
      const c = grain(color(v, t).clone(), v);
      cs.set([c.r, c.g, c.b], i * 3);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    return finish(g, cs, pivot);
  }

  const root = new THREE.Group(); root.name = 'riley';
  const add = (parent, geo, mat, name) => { const m = new THREE.Mesh(geo, mat); if (name) m.name = name; m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const pivotGroup = (parent, name, p) => { const g = new THREE.Group(); g.name = name; g.position.set(...p); parent.add(g); return g; };

  // ---- coat colour on the body: white with brown patches ----
  function bodyColour(P) {
    let w = 0;
    w = Math.max(w, patch(P, [0.20, 0.52, -0.16], 0.21, [0.8, 1, 1.15]));   // big saddle over the left flank and hip
    w = Math.max(w, patch(P, [-0.16, 0.66, 0.06], 0.12));                    // right shoulder
    w = Math.max(w, patch(P, [0.13, 0.69, 0.13], 0.07));                     // small left-shoulder spot
    w = Math.max(w, patch(P, [0.0, 0.66, -0.38], 0.10, [1.3, 1, 1]));         // rump, at the tail base
    w = Math.max(w, patch(P, [-0.12, 0.69, -0.20], 0.045));                  // freckle
    const base = mix(C.white, C.cream, smoothstep(0.42, 0.3, P.y) * 0.35);   // belly a touch creamier
    return mix(base, mix(C.brown, C.auburn, vnoise(P.x * 6, P.y * 6, P.z * 6) * 0.6), w);
  }

  // ---- harness: a pink vest painted onto the coat, with a thin raised shell and grey trim ----
  // vestMask(P) > 0.5 is covered; the 0.5..0.6 rim gets the grey reflective trim.
  const band = (x, w) => 1 - smoothstep(w - 0.012, w + 0.012, Math.abs(x));
  const chestN = new THREE.Vector3(0, 0.5, 1).normalize();
  function vestMask(P) {
    const girth = band(P.z - 0.07, 0.065);                                            // strap round the ribs
    const saddle = smoothstep(0.55, 0.59, P.y) * band(P.z - 0.12, 0.13);              // panel over the shoulders
    const chest = band(P.clone().sub(new THREE.Vector3(0, 0.6, 0.27)).dot(chestN), 0.032) * smoothstep(0.47, 0.5, P.y); // strap across the chest
    return Math.max(girth, saddle, chest);
  }
  function vestColour(P) {
    const m = vestMask(P);
    const plaid = 0.92 + 0.08 * (Math.sin(P.x * 90) * Math.sin(P.z * 90 + P.y * 60) > 0.2 ? 1 : 0);
    const pink = mix(C.pink, C.white, 0.2 * vnoise(P.x * 14, P.y * 14, P.z * 14)).multiplyScalar(plaid);
    return mix(C.grey, pink, smoothstep(0.62, 0.7, m));
  }
  const coatAndVest = (P) => mix(bodyColour(P), vestColour(P), smoothstep(0.46, 0.54, vestMask(P)));

  // ---- torso ----
  const torsoGeo = blob({
    c: [0, 0.47, -0.03], r: [0.2, 0.19, 0.36], seg: [128, 96], color: coatAndVest, grain: 0.03,
    deform: (v) => {
      if (v.y > 0) v.y *= 0.9;                                    // flatter back
      if (v.y < 0 && v.z > -0.2) v.y *= 1 + 0.25 * Math.max(0, v.z); // deeper chest
      if (v.z < -0.6) v.x *= 1.06;                                // rounder rump
    },
  });
  add(root, torsoGeo, furMat, 'torso');

  // chest ruff and neck
  add(root, blob({ c: [0, 0.61, 0.23], r: [0.165, 0.21, 0.165], rot: [-0.55, 0, 0], seg: [96, 72], color: coatAndVest, grain: 0.03,
    deform: (v) => { v.multiplyScalar(1 + 0.05 * (vnoise(v.x * 5, v.y * 5, v.z * 5) - 0.5)); } }), furMat, 'chest');

  // ---- legs ----
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R';
    const fx = 0.105 * s;
    const fl = pivotGroup(root, `leg_front_${side}`, [fx, 0.4, 0.22]);
    add(fl, blob({ c: [fx, 0.22, 0.23], r: [0.062, 0.2, 0.066], color: () => C.white, pivot: [fx, 0.4, 0.22] }), furMat);
    add(fl, blob({ c: [fx, 0.035, 0.265], r: [0.07, 0.045, 0.085], color: () => C.white, pivot: [fx, 0.4, 0.22] }), furMat);
    const bx = 0.12 * s;
    const bl = pivotGroup(root, `leg_back_${side}`, [bx, 0.42, -0.26]);
    add(bl, blob({ c: [bx * 1.05, 0.35, -0.25], r: [0.1, 0.15, 0.13], color: bodyColour, pivot: [bx, 0.42, -0.26] }), furMat);
    add(bl, blob({ c: [bx, 0.17, -0.28], r: [0.06, 0.16, 0.066], rot: [0.18, 0, 0], color: () => C.white, pivot: [bx, 0.42, -0.26] }), furMat);
    add(bl, blob({ c: [bx, 0.035, -0.255], r: [0.07, 0.045, 0.085], color: () => C.white, pivot: [bx, 0.42, -0.26] }), furMat);
  }

  // ---- head ----
  const HP = [0, 0.78, 0.3];                       // neck pivot
  const H = new THREE.Vector3(0, 0.93, 0.37);      // skull centre
  const EYE = [[0.088, 0.925, 0.505], [-0.088, 0.925, 0.505]];
  const head = pivotGroup(root, 'head', [HP[0], HP[1] - 0.05, HP[2] - 0.02]);   // geometry is built at HP, then the head sits a little lower
  add(root, blob({ c: [0, 0.71, 0.27], r: [0.14, 0.13, 0.13], color: bodyColour }), furMat, 'neck');

  function headColour(P) {
    const d = P.clone().sub(H);
    const ax = Math.abs(d.x);
    const blaze = 0.045 + Math.max(0, d.y) * 0.25 + Math.max(0, -d.z) * 0.12;    // white blaze widens over the crown
    const lowEdge = d.x > 0 ? -0.06 : -0.025;                                     // brown reaches lower on the left cheek
    let w = smoothstep(blaze - 0.015, blaze + 0.02, ax) * smoothstep(lowEdge - 0.02, lowEdge + 0.02, d.y);
    w *= 1 - smoothstep(0.06, 0.12, d.z) * smoothstep(0.02, -0.04, d.y);         // muzzle stays white
    let c = mix(C.white, mix(C.brown, C.auburn, vnoise(P.x * 7, P.y * 7, P.z * 7) * 0.7), w);
    // the dark rims round the eyes
    for (const e of EYE) {
      const de = Math.hypot(P.x - e[0], (P.y - e[1]) * 1.1, (P.z - e[2]) * 0.8);
      c = mix(c, C.rim, (1 - smoothstep(0.052, 0.078, de)) * 0.9);
    }
    return c;
  }
  add(head, blob({ c: H.toArray(), r: [0.2, 0.175, 0.175], seg: [64, 48], color: headColour, pivot: HP,
    deform: (v) => {
      if (v.y < 0) v.x *= 1 + 0.08 * -v.y;          // full cheeks
      if (v.z > 0.5 && Math.abs(v.y) < 0.4) v.z *= 0.93; // flat face
    } }), furMat, 'skull');

  // short flat muzzle, black lips, nose
  add(head, blob({ c: [0, 0.855, 0.508], r: [0.085, 0.062, 0.052], color: (P) => {
    const lip = smoothstep(0.818, 0.805, P.y);       // dark lower lip line
    const flews = 1 - smoothstep(0.03, 0.05, Math.abs(P.x)) * smoothstep(0.86, 0.84, P.y);
    return mix(C.white, C.black, Math.max(lip, (1 - flews) * 0.0) + smoothstep(0.88, 0.86, P.y) * smoothstep(0.035, 0.0, Math.abs(P.x)) * 0.85);
  }, pivot: HP }), furMat, 'muzzle');
  add(head, blob({ c: [0, 0.822, 0.512], r: [0.04, 0.014, 0.03], color: () => C.black, pivot: HP }), glossMat, 'lip');
  add(head, blob({ c: [0, 0.885, 0.556], r: [0.034, 0.026, 0.024], color: () => C.black, grain: 0.02, pivot: HP,
    deform: (v) => { if (v.y > 0) v.y *= 0.8; } }), glossMat, 'nose');
  // two little underbite teeth, as in the photos
  for (const s of [1, -1]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.013, 0.008), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.4 }));
    t.position.set(0.012 * s - HP[0], 0.83 - HP[1], 0.542 - HP[2]); head.add(t);
  }

  // big dark eyes with catch-lights
  EYE.forEach((e, i) => {
    const eye = pivotGroup(head, i === 0 ? 'eye_L' : 'eye_R', [e[0] - HP[0], e[1] - HP[1], e[2] - HP[2]]);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.043, 32, 24), eyeMat); ball.scale.set(1, 0.95, 0.8); eye.add(ball);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), sparkMat);
    spark.position.set(0.012 * (i === 0 ? 1 : -1) + 0.008, 0.018, 0.033); eye.add(spark);
    eye.rotation.y = 0.2 * (i === 0 ? 1 : -1);
  });

  // feathered ears: brown at the base, black at the fringes
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R';
    const EP = [0.13 * s, 1.03, 0.31];
    const ear = pivotGroup(head, `ear_${side}`, [EP[0] - HP[0], EP[1] - HP[1], EP[2] - HP[2]]);
    const pivotAbs = EP;
    const earColour = (P) => {
      const t = Math.hypot(P.x - EP[0], P.y - EP[1], P.z - EP[2]) / 0.24;
      return mix(mix(C.brown, C.auburn, 0.4), C.black, smoothstep(0.45, 0.95, t));
    };
    const local = (geo) => { geo.translate(HP[0] - EP[0], HP[1] - EP[1], HP[2] - EP[2]); return geo; };
    add(ear, local(blob({ c: [0.235 * s, 0.94, 0.3], r: [0.13, 0.12, 0.035], rot: [0, 0.25 * s, -0.55 * s], color: earColour, pivot: HP,
      deform: (v) => { v.z += 0.35 * (v.x * v.x); } })), furMat);
    // fringe tufts along the outer edge
    for (let k = 0; k < 6; k++) {
      const a = -1.6 + k * 0.42;
      const cx = 0.235 * s + Math.cos(a) * 0.11 * s, cy = 0.94 + Math.sin(a) * 0.1 - 0.02;
      add(ear, local(blob({ c: [cx, cy, 0.3 - 0.01 * k], r: [0.06, 0.022, 0.02], seg: [16, 10],
        rot: [0, 0, a * s * 0.8 - 0.5 * s], color: earColour, pivot: HP })), furMat);
    }
    void pivotAbs;
  }

  // ---- tail: a white plume curled up over the back ----
  const TP = [0, 0.63, -0.37];
  const tail = pivotGroup(root, 'tail', TP);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.56, -0.3), new THREE.Vector3(0, 0.72, -0.43), new THREE.Vector3(0.01, 0.93, -0.42),
    new THREE.Vector3(0.05, 1.0, -0.29), new THREE.Vector3(0.09, 0.95, -0.17), new THREE.Vector3(0.11, 0.86, -0.12),
  ]);
  add(tail, tube(tailCurve, 60, 24, (t) => 0.04 + 0.085 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7) * (1 - 0.6 * t),
    (P, t) => mix(C.white, C.cream, t * 0.3), TP, 0.35), furMat);

  function shell(src, lift) {
    const pos = src.attributes.position, nor = src.attributes.normal, idx = src.index.array;
    const P = new THREE.Vector3(), m = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) m[i] = vestMask(P.fromBufferAttribute(pos, i));
    const out = new THREE.BufferGeometry(), np = new Float32Array(pos.count * 3), nc = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      P.fromBufferAttribute(pos, i);
      const n = new THREE.Vector3().fromBufferAttribute(nor, i);
      np.set([P.x + n.x * lift, P.y + n.y * lift, P.z + n.z * lift], i * 3);
      const c = vestColour(P);
      nc.set([c.r, c.g, c.b], i * 3);
    }
    const keep = [];
    for (let t = 0; t < idx.length; t += 3) if (m[idx[t]] > 0.8 && m[idx[t + 1]] > 0.8 && m[idx[t + 2]] > 0.8) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    out.setAttribute('position', new THREE.BufferAttribute(np, 3));
    out.setAttribute('color', new THREE.BufferAttribute(nc, 3));
    out.setIndex(keep); out.computeVertexNormals();
    return out;
  }
  const vestMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  const harness = new THREE.Group(); harness.name = 'harness'; root.add(harness);
  add(harness, shell(torsoGeo, 0.006), vestMat, 'vest');
  add(harness, shell(root.getObjectByName('chest').geometry, 0.006), vestMat, 'vest_chest');
  // D-ring on the back where the leash clips on
  const dring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0055, 10, 24), ringMat);
  dring.position.set(0, 0.665, 0.08); dring.rotation.y = Math.PI / 2; harness.add(dring);
  // bone-shaped name tag hanging under the chest
  const bone = new THREE.Shape();
  bone.moveTo(-0.022, -0.01); bone.lineTo(0.022, -0.01); bone.absarc(0.026, -0.01, 0.011, Math.PI, Math.PI * 2.5, false);
  bone.absarc(0.026, 0.01, 0.011, -Math.PI / 2, Math.PI, false); bone.lineTo(-0.022, 0.01);
  bone.absarc(-0.026, 0.01, 0.011, 0, Math.PI * 1.5, false); bone.absarc(-0.026, -0.01, 0.011, Math.PI / 2, Math.PI * 2, false);
  const tag = new THREE.Mesh(new THREE.ExtrudeGeometry(bone, { depth: 0.006, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2 }), tagMat);
  tag.name = 'tag';
  const tagPivot = pivotGroup(root, 'tag_pivot', [0, 0.53, 0.385]);
  tag.position.set(0, -0.06, 0); tag.rotation.z = 0.35; tagPivot.add(tag);
  const tagRing = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 8, 20), ringMat);
  tagRing.position.set(0, -0.025, 0.003); tagPivot.add(tagRing);

  // ---- animation clips ----
  const Q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray();
  const qTrack = (name, times, eulers) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, eulers.flatMap((e) => Q(...e)));
  const sTrack = (name, times, scales) => new THREE.VectorKeyframeTrack(`${name}.scale`, times, scales.flat());
  const blink = (t0, len = 4) => {
    const times = [0, t0, t0 + 0.06, t0 + 0.14, len], s = [[1, 1, 1], [1, 1, 1], [1, 0.08, 1], [1, 1, 1], [1, 1, 1]];
    return [sTrack('eye_L', times, s), sTrack('eye_R', times, s)];
  };
  const idle = new THREE.AnimationClip('idle', 4, [
    sTrack('torso', [0, 1, 2, 3, 4], [[1, 1, 1], [1.02, 1.03, 1], [1, 1, 1], [1.02, 1.03, 1], [1, 1, 1]]),
    qTrack('head', [0, 1.4, 2.6, 4], [[0, 0, 0], [0.04, 0.12, 0.06], [-0.02, -0.08, -0.04], [0, 0, 0]]),
    qTrack('ear_L', [0, 2.2, 2.35, 2.5, 4], [[0, 0, 0], [0, 0, 0], [0, 0, 0.3], [0, 0, 0], [0, 0, 0]]),
    qTrack('ear_R', [0, 0.6, 3.2, 4], [[0, 0, 0], [0, 0, -0.06], [0, 0, 0.04], [0, 0, 0]]),
    qTrack('tail', [0, 1, 2, 3, 4], [[0, 0, 0], [0, 0, 0.12], [0, 0, 0], [0, 0, -0.12], [0, 0, 0]]),
    qTrack('tag_pivot', [0, 1, 2, 3, 4], [[0, 0, 0], [0.08, 0, 0.05], [0, 0, 0], [0.08, 0, -0.05], [0, 0, 0]]),
    ...blink(1.8),
  ]);
  const wt = [], wq = [];
  for (let i = 0; i <= 8; i++) { wt.push(i * 0.125); wq.push([0, 0.15 * (i % 2 ? 1 : -1) * (i % 8 ? 1 : 0), 0.45 * (i % 2 ? 1 : -1) * (i % 8 ? 1 : 0)]); }
  const wag = new THREE.AnimationClip('wag', 1, [
    qTrack('tail', wt, wq),
    qTrack('head', [0, 0.25, 0.5, 0.75, 1], [[0, 0, 0], [-0.08, 0, 0], [0, 0, 0], [-0.08, 0, 0], [0, 0, 0]]),
    qTrack('ear_L', [0, 0.25, 0.5, 0.75, 1], [[0, 0, 0], [0, 0, 0.22], [0, 0, 0], [0, 0, 0.22], [0, 0, 0]]),
    qTrack('ear_R', [0, 0.25, 0.5, 0.75, 1], [[0, 0, 0], [0, 0, -0.22], [0, 0, 0], [0, 0, -0.22], [0, 0, 0]]),
    qTrack('torso', [0, 0.25, 0.5, 0.75, 1], [[0, 0, 0], [0, 0, 0.03], [0, 0, 0], [0, 0, -0.03], [0, 0, 0]]),
  ]);
  const tilt = new THREE.AnimationClip('tilt', 2.4, [
    qTrack('head', [0, 0.35, 1.5, 1.9, 2.4], [[0, 0, 0], [-0.06, 0.1, 0.42], [-0.06, 0.1, 0.42], [0, 0, -0.05], [0, 0, 0]]),
    qTrack('ear_L', [0, 0.35, 0.5, 2.4], [[0, 0, 0], [0, 0, 0.25], [0, 0, 0.1], [0, 0, 0]]),
    qTrack('ear_R', [0, 0.35, 0.5, 2.4], [[0, 0, 0], [0, 0, -0.3], [0, 0, -0.12], [0, 0, 0]]),
    ...blink(1.1, 2.4),
  ]);
  return { root, clips: [idle, wag, tilt] };
}
