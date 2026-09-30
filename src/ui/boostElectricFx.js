// boostElectricFx — real electricity on a Boost square when a word through it is
// accepted (renderer directive `bonusActivate`, gameScreen.flashBonusSquare).
//
// A canvas slightly larger than the tile is laid over it for the ignition
// window (BOOST_IGNITION_DURATION_MS). Every ~45 ms the bolts are regenerated
// so they crackle: jagged currents crawl around the tile's edge, arcs jump
// outward with forks, and a power surge flashes through the tile at the start.
// White-hot cores with cyan glow, some gold arcs (Boost colours).
//
// Presentation only: the `.bonus-activate` class, its timing and the result
// reveal contract (boostPresentation.js) are unchanged. Reduced motion → the
// caller skips this and the static CSS rim remains.

const REGEN_MS = 45;
const CYAN = '0,210,255';
const GOLD = '255,206,84';

// Point on the tile outline for u ∈ [0,1) (clockwise from the top-left), with
// the outward normal. Rect is { x, y, w, h } in canvas px.
export function perimeterPoint(u, r) {
  const per = 2 * (r.w + r.h);
  let d = (((u % 1) + 1) % 1) * per;
  if (d < r.w) return { x: r.x + d, y: r.y, nx: 0, ny: -1 };
  d -= r.w;
  if (d < r.h) return { x: r.x + r.w, y: r.y + d, nx: 1, ny: 0 };
  d -= r.h;
  if (d < r.w) return { x: r.x + r.w - d, y: r.y + r.h, nx: 0, ny: 1 };
  d -= r.w;
  return { x: r.x, y: r.y + r.h - d, nx: -1, ny: 0 };
}

// 0..1 intensity over the ignition: fast strike, sustained crackle, decay.
export function envelope(p) {
  if (p <= 0) return 0;
  if (p < 0.08) return p / 0.08;
  if (p < 0.68) return 1;
  if (p < 1) return (1 - p) / 0.32;
  return 0;
}

// Jagged current crawling along the outline from u0 over `span` of the perimeter.
export function crawlBolt(r, u0, span, rand) {
  const per = 2 * (r.w + r.h);
  const steps = Math.max(4, Math.round((span * per) / 5));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const p = perimeterPoint(u0 + (span * i) / steps, r);
    const j = (rand() - 0.35) * 5; // mostly outward, sometimes over the tile edge
    pts.push({ x: p.x + p.nx * j, y: p.y + p.ny * j });
  }
  return pts;
}

// Midpoint-displacement lightning between two points.
export function arcBolt(x1, y1, x2, y2, rand, depth = 4, disp = null) {
  let pts = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  let d = disp ?? Math.hypot(x2 - x1, y2 - y1) * 0.35;
  for (let k = 0; k < depth; k++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const off = (rand() - 0.5) * d;
      next.push({ x: (a.x + b.x) / 2 + (-(b.y - a.y) / len) * off, y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * off }, b);
    }
    pts = next;
    d /= 2;
  }
  return pts;
}

function generate(r, pad, rand) {
  const bolts = [];
  const crawls = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < crawls; i++) {
    bolts.push({ pts: crawlBolt(r, rand(), 0.18 + rand() * 0.3, rand), rgb: CYAN, w: 1 });
  }
  const arcs = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < arcs; i++) {
    const p = perimeterPoint(rand(), r);
    const reach = pad * (0.45 + rand() * 0.5);
    const side = (rand() - 0.5) * pad * 0.8;
    const ex = p.x + p.nx * reach + p.ny * side;
    const ey = p.y + p.ny * reach - p.nx * side;
    const main = arcBolt(p.x, p.y, ex, ey, rand);
    const rgb = rand() < 0.35 ? GOLD : CYAN;
    bolts.push({ pts: main, rgb, w: 1.1 });
    if (main.length > 4 && rand() < 0.7) { // a fork off the arc
      const f = main[Math.floor(main.length / 2)];
      bolts.push({ pts: arcBolt(f.x, f.y, f.x + (ex - p.x) * 0.5 + (rand() - 0.5) * 12, f.y + (ey - p.y) * 0.5 + (rand() - 0.5) * 12, rand, 3), rgb, w: 0.7 });
    }
  }
  return bolts;
}

function stroke(ctx, pts, rgb, w, a) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = `rgba(${rgb},${(0.2 * a).toFixed(3)})`; ctx.lineWidth = 7 * w; ctx.stroke();
  ctx.strokeStyle = `rgba(${rgb},${(0.65 * a).toFixed(3)})`; ctx.lineWidth = 2.8 * w; ctx.stroke();
  ctx.strokeStyle = `rgba(255,255,255,${(0.95 * a).toFixed(3)})`; ctx.lineWidth = 1.1 * w; ctx.stroke();
}

export function playBoostElectric(tileEl, { durationMs = 600, rand = Math.random } = {}) {
  const doc = tileEl?.ownerDocument;
  const raf = globalThis.requestAnimationFrame;
  if (!doc?.createElement || !tileEl.appendChild || typeof raf !== 'function') return () => {};
  const W = tileEl.offsetWidth || 40, H = tileEl.offsetHeight || 40;
  const pad = Math.round(Math.max(W, H) * 0.85);
  const cw = W + pad * 2, ch = H + pad * 2;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const canvas = doc.createElement('canvas');
  canvas.className = 'bsq-electric';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  canvas.style.cssText = `position:absolute;left:${-pad}px;top:${-pad}px;width:${cw}px;height:${ch}px;pointer-events:none;z-index:6;`;
  tileEl.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return () => {}; }
  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const r = { x: pad, y: pad, w: W, h: H };
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const t0 = now();
  let lastGen = -Infinity, bolts = [], flicker = 1, handle = 0, done = false;

  const stop = () => {
    if (done) return;
    done = true;
    globalThis.cancelAnimationFrame?.(handle);
    try { canvas.remove(); } catch { /* swallow */ }
  };

  const frame = () => {
    if (done) return;
    const t = now() - t0;
    const p = t / durationMs;
    if (p >= 1 || !tileEl.isConnected) { stop(); return; }
    // Lightning flickers at ~22 fps: regenerate + redraw only on those ticks,
    // which also keeps main-thread cost low during the ignition window.
    if (t - lastGen < REGEN_MS) { handle = raf(frame); return; }
    lastGen = t;
    bolts = generate(r, pad, rand);
    flicker = 0.7 + rand() * 0.3;
    const a = envelope(p) * flicker;
    ctx.clearRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = 'lighter';
    // Power surge through the tile at the strike.
    if (p < 0.3) {
      const s = (1 - p / 0.3) * 0.55;
      const g = ctx.createRadialGradient(r.x + W / 2, r.y + H / 2, 0, r.x + W / 2, r.y + H / 2, Math.max(W, H) * 0.9);
      g.addColorStop(0, `rgba(255,255,255,${s.toFixed(3)})`);
      g.addColorStop(0.45, `rgba(${CYAN},${(s * 0.55).toFixed(3)})`);
      g.addColorStop(1, `rgba(${CYAN},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
    }
    for (const b of bolts) stroke(ctx, b.pts, b.rgb, b.w, a);
    handle = raf(frame);
  };
  handle = raf(frame);
  return stop;
}
