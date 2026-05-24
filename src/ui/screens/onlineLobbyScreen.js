// onlineLobbyScreen — Phase 1 migration of #so (online lobby).
//
// Replaces inline onclicks with bus-driven listeners.
// Also drives the canvas globe animation in the title.

import { $, on } from '../domHelpers.js';

export const LOBBY_INTENT = Object.freeze({
  CREATE_ROOM:   'lobby/createRoom',
  JOIN_BY_CODE:  'lobby/joinByCode',
  MATCHMAKING:   'lobby/matchmaking',
  BACK:          'lobby/back',
});

const BUTTONS = [
  { sel: 'button[onclick="onlineCreateRoom()"]', intent: LOBBY_INTENT.CREATE_ROOM },
  { sel: 'button[onclick="onlineJoinByCode()"]', intent: LOBBY_INTENT.JOIN_BY_CODE },
  { sel: 'button[onclick="onlineMatchmaking()"]', intent: LOBBY_INTENT.MATCHMAKING },
  { sel: 'button[onclick="goHome()"]',            intent: LOBBY_INTENT.BACK },
];

// ---------------------------------------------------------------------------
// Simplified continent polygons  [longitude °, latitude °]
// ---------------------------------------------------------------------------
const LAND = [
  // North America
  [ [-168,62],[-155,58],[-132,54],[-125,48],[-124,40],[-118,32],[-112,28],
    [-106,22],[-90,14],[-83,10],[-78,8],[-80,10],[-83,30],[-80,34],
    [-76,40],[-70,44],[-66,45],[-55,48],[-55,52],[-60,58],[-68,64],
    [-78,72],[-100,76],[-124,72],[-148,68] ],
  // Greenland
  [ [-44,82],[-14,80],[0,76],[-18,70],[-34,64],[-52,66],[-58,74],[-50,80] ],
  // South America
  [ [-82,8],[-76,2],[-68,-2],[-52,-4],[-36,-10],[-35,-8],[-38,-6],
    [-44,0],[-55,-2],[-62,-14],[-68,-32],[-72,-52],[-68,-54],
    [-60,-52],[-50,-38],[-46,-22],[-50,-10],[-60,-6],[-70,-2],[-78,4] ],
  // Europe
  [ [-10,70],[10,72],[30,72],[40,68],[38,62],[28,58],[18,54],[6,52],
    [0,50],[-5,48],[-10,44],[0,38],[8,44],[14,46],[14,50],[20,50],
    [26,48],[30,44],[36,46],[40,42],[28,38],[16,40],[12,42],[4,48],
    [0,48],[-8,52],[-14,58],[-10,64] ],
  // Africa
  [ [-16,16],[-18,26],[-8,32],[10,38],[24,38],[34,28],[38,22],[42,12],
    [50,10],[44,2],[40,-4],[36,-18],[28,-34],[18,-34],[14,-28],[8,-8],
    [2,0],[-4,4],[-8,4],[-16,12] ],
  // Asia (Eurasia east of the Europe polygon)
  [ [28,42],[40,64],[60,72],[90,76],[120,74],[140,68],[168,66],[178,62],
    [178,48],[165,44],[144,44],[134,38],[128,32],[120,28],[114,22],[112,18],
    [120,12],[104,10],[96,8],[90,20],[80,26],[76,30],[70,36],[64,36],
    [55,26],[50,22],[44,36],[42,44],[38,46],[30,44],[26,42],[22,42],
    [20,48],[24,52],[30,56],[36,58],[40,62] ],
  // Australia
  [ [116,-20],[122,-24],[126,-32],[132,-36],[138,-36],[142,-38],
    [148,-38],[152,-28],[152,-22],[148,-18],[138,-14],[128,-14],[120,-16] ],
  // Antarctica (rough band around south pole)
  [ [-160,-68],[-90,-72],[-30,-68],[0,-76],[40,-68],[100,-72],[160,-68],
    [140,-62],[60,-60],[0,-64],[-60,-60],[-130,-62] ],
];

// ---------------------------------------------------------------------------
// Globe renderer
// ---------------------------------------------------------------------------
function startGlobe(root) {
  const canvas = root?.getElementById?.('ol-globe');
  if (!canvas?.getContext) return () => {};

  const DPR  = Math.min(globalThis.devicePixelRatio ?? 1, 2);
  const S    = 40;                   // logical size (matches old SVG viewBox)
  canvas.width  = S * DPR;
  canvas.height = S * DPR;
  const ctx  = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  const R    = S / 2;                // radius = 20 logical px
  const cx   = R, cy = R;

  let lonOff = -30;                  // start showing Atlantic / Americas
  let rafId;

  // Orthographic projection: returns [x, y] or null (back hemisphere)
  function proj(lonDeg, latDeg) {
    const phi = latDeg * (Math.PI / 180);
    const lam = (lonDeg + lonOff) * (Math.PI / 180);
    const x   =  Math.cos(phi) * Math.sin(lam);
    const y   = -Math.sin(phi);
    const z   =  Math.cos(phi) * Math.cos(lam);
    if (z < 0) return null;
    return [cx + x * (R - 1), cy + y * (R - 1)];
  }

  // Draw a series of lon/lat points as a connected path, lifting pen at the horizon
  function tracePath(pts) {
    let penDown = false;
    ctx.beginPath();
    for (const [lon, lat] of pts) {
      const p = proj(lon, lat);
      if (!p) { penDown = false; continue; }
      if (!penDown) { ctx.moveTo(p[0], p[1]); penDown = true; }
      else            ctx.lineTo(p[0], p[1]);
    }
  }

  function frame() {
    ctx.clearRect(0, 0, S, S);

    // ── Ocean sphere ──────────────────────────────────────────────────────
    const oceanGrad = ctx.createRadialGradient(cx + R * 0.2, cy - R * 0.25, 0, cx, cy, R);
    oceanGrad.addColorStop(0,   '#93c5fd');
    oceanGrad.addColorStop(0.4, '#2563eb');
    oceanGrad.addColorStop(1,   '#0c1f5c');
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    ctx.fillStyle = oceanGrad;
    ctx.fill();

    // Clip everything inside the sphere
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    ctx.clip();

    // ── Grid lines ────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = 0.5;
    // Latitude parallels
    for (const lat of [-60, -30, 0, 30, 60]) {
      const pts = [];
      for (let lon = -180; lon <= 180; lon += 4) pts.push([lon, lat]);
      tracePath(pts); ctx.stroke();
    }
    // Longitude meridians
    for (let lon = -180; lon < 180; lon += 30) {
      const pts = [];
      for (let lat = -90; lat <= 90; lat += 4) pts.push([lon, lat]);
      tracePath(pts); ctx.stroke();
    }

    // ── Land masses ───────────────────────────────────────────────────────
    for (let i = 0; i < LAND.length; i++) {
      const isAntarctica = i === LAND.length - 1;
      tracePath(LAND[i]);
      ctx.closePath();
      ctx.fillStyle   = isAntarctica ? 'rgba(220,235,255,0.85)' : 'rgba(68,176,80,0.92)';
      ctx.fill();
      ctx.strokeStyle = isAntarctica ? 'rgba(180,210,255,0.5)'  : 'rgba(36,120,48,0.7)';
      ctx.lineWidth   = 0.5;
      ctx.stroke();
    }

    ctx.restore(); // end sphere clip

    // ── Specular highlight ────────────────────────────────────────────────
    const shine = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.28, 0,
                                           cx - R * 0.1, cy - R * 0.1,  R * 0.9);
    shine.addColorStop(0,   'rgba(255,255,255,0.30)');
    shine.addColorStop(0.45,'rgba(255,255,255,0.06)');
    shine.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    ctx.fillStyle = shine;
    ctx.fill();

    // ── Rim ───────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,20,80,0.45)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    lonOff += 0.5;   // ~18° / s at 60 fps
    rafId = requestAnimationFrame(frame);
  }

  frame();
  return () => { if (rafId) cancelAnimationFrame(rafId); };
}

// ---------------------------------------------------------------------------
// Screen mount
// ---------------------------------------------------------------------------
export function mountOnlineLobbyScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountOnlineLobbyScreen: bus required');

  const lobby = $('#so', root);
  if (!lobby) {
    console.warn('[onlineLobbyScreen] #so not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];

  for (const def of BUTTONS) {
    const btn = $(def.sel, lobby);
    if (!btn) continue;
    btn.removeAttribute('onclick');
    cleanups.push(on(btn, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(def.intent, { source: 'onlineLobby' });
    }));
  }

  const stopGlobe = startGlobe(root);

  function unmount() {
    stopGlobe();
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
