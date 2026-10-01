// sfxEngine — plays catalog cues: decoded audio samples when available,
// WebAudio synth tones as fallback. Owns the AudioContext and the
// first-gesture unlock. Knows nothing about game events (feedbackService
// routes bus events to cue ids).
//
// Public surface:
//   init({ doc, isEnabled, baseUrl?, ctxFactory?, fetchImpl?, now?, onDuck? })
//   play(id, { vol?, rate? }) → 'sample' | 'synth' | null
//   setMasterVolume(0–1)  — user SFX volume, scales every cue
//   isUnlocked()
//   dispose()

import { SFX, TIERS, getCue, cueFiles } from './sfxCatalog.js';

const MAX_VOICES = 6;

const state = {
  doc: null,
  isEnabled: () => true,
  baseUrl: './assets/sfx/',
  ctxFactory: null,
  fetchImpl: null,
  now: () => Date.now(),
  onDuck: null,
  master: 1,
  ctx: null,
  // Flips true the first time we observe a real user gesture (pointer/key).
  // Until then, ensureCtx() returns null so play() is a no-op — creating
  // an AudioContext pre-gesture starts it suspended and any later resume()
  // call triggers Chrome's "AudioContext was not allowed to start" warning.
  unlocked: false,
  unlockHandler: null,
  ext: null,
  buffers: new Map(),   // file → AudioBuffer
  loading: new Map(),   // file → Promise
  failed: new Set(),    // files that failed to fetch/decode
  lastPlayed: new Map(),// cue id → timestamp
  voices: [],           // { tier, end } in ctx time
};

export function init({ doc, isEnabled, baseUrl, ctxFactory, fetchImpl, now, onDuck } = {}) {
  state.doc = doc ?? globalThis.document ?? null;
  if (typeof isEnabled === 'function') state.isEnabled = isEnabled;
  if (baseUrl) state.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  state.ctxFactory = typeof ctxFactory === 'function' ? ctxFactory : null;
  state.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl : null;
  if (typeof now === 'function') state.now = now;
  state.onDuck = typeof onDuck === 'function' ? onDuck : null;
  armUnlock();
}

export function isUnlocked() { return state.unlocked; }

export function setMasterVolume(v) {
  const n = Number(v);
  state.master = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

export function play(id, { vol = 1, rate = 1 } = {}) {
  if (!state.isEnabled() || state.master <= 0) return null;
  const entry = getCue(id);
  if (!entry) return null;

  const t = state.now();
  const last = state.lastPlayed.get(id);
  if (entry.throttleMs && last != null && t - last < entry.throttleMs) return null;

  const ctx = ensureCtx();
  if (!ctx) return null;
  // Resume here (not in the unlock handler) so the resume() call lives in
  // the same call stack as the user action that triggered this SFX.
  if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
    try { ctx.resume().catch(() => {}); } catch {}
  }

  if (!admitVoice(ctx, entry.tier)) return null;
  state.lastPlayed.set(id, t);
  if (entry.tier === 'reward' || entry.tier === 'stinger') {
    try { state.onDuck?.(entry); } catch {}
  }

  const files = cueFiles(entry);
  const file = files.length ? files[Math.floor(Math.random() * files.length)] : null;
  const buffer = file ? state.buffers.get(file) : null;
  if (buffer) {
    let r = rate * (Number(entry.rate) || 1);
    const jitter = Number(entry.pitchJitter) || 0;
    if (jitter) r *= 1 + (Math.random() * 2 - 1) * jitter;
    playBuffer(ctx, buffer, entry, (entry.vol ?? 0.5) * vol * state.master, r);
    return 'sample';
  }
  if (file) loadFile(file);
  playSynth(ctx, entry.synth, vol * state.master);
  return 'synth';
}

export function dispose() {
  if (state.unlockHandler && state.doc?.removeEventListener) {
    state.doc.removeEventListener('pointerdown', state.unlockHandler);
    state.doc.removeEventListener('keydown',     state.unlockHandler);
    state.doc.removeEventListener('touchstart',  state.unlockHandler);
  }
  state.unlockHandler = null;
  state.unlocked = false;
  if (state.ctx && typeof state.ctx.close === 'function') {
    try { state.ctx.close(); } catch {}
  }
  state.ctx = null;
  state.ext = null;
  state.buffers.clear();
  state.loading.clear();
  state.failed.clear();
  state.lastPlayed.clear();
  state.voices = [];
  state.isEnabled = () => true;
  state.ctxFactory = null;
  state.fetchImpl = null;
  state.now = () => Date.now();
  state.onDuck = null;
  state.master = 1;
}

// ─── Voice limiting ────────────────────────────────────────

function admitVoice(ctx, tier) {
  const now = ctx.currentTime ?? 0;
  state.voices = state.voices.filter(v => v.end > now);
  if (tier === 'micro') {
    if (state.voices.length >= MAX_VOICES) return false;
    if (state.voices.some(v => v.tier === 'stinger')) return false;
  }
  return true;
}

function trackVoice(tier, end) {
  state.voices.push({ tier, end });
}

// ─── Playback ──────────────────────────────────────────────

function playBuffer(ctx, buffer, entry, gainValue, rate) {
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = buffer;
  if (rate !== 1 && src.playbackRate) src.playbackRate.value = rate;
  g.gain.value = Math.max(0, Math.min(1, gainValue));
  src.connect(g).connect(ctx.destination);
  const t0 = ctx.currentTime;
  src.start(t0);
  trackVoice(entry.tier, t0 + (buffer.duration ?? 0.5) / (rate || 1));
}

function playSynth(ctx, synth, scale = 1) {
  if (!synth) return;
  const notes = Array.isArray(synth) ? synth : [synth];
  for (const n of notes) playTone(ctx, { ...n, gain: (n.gain ?? 0.15) * scale });
}

function playTone(ctx, { freq = 440, dur = 120, type = 'sine', gain = 0.15, slideTo = null, delay = 0 } = {}) {
  const t0 = ctx.currentTime + Math.max(0, delay) / 1000;
  const t1 = t0 + dur / 1000;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t1);
  }
  // Quick attack + exponential decay so tones don't click.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
  trackVoice('synth', t1);
}

// ─── Loading ───────────────────────────────────────────────

function pickExt() {
  if (state.ext) return state.ext;
  // iOS Safari can't decode Ogg Vorbis reliably; everyone else gets the
  // smaller .ogg. Without an Audio element (tests), default to .m4a.
  let ogg = false;
  try {
    const probe = state.doc?.createElement?.('audio');
    ogg = !!probe?.canPlayType?.('audio/ogg; codecs="vorbis"');
  } catch {}
  state.ext = ogg ? 'ogg' : 'm4a';
  return state.ext;
}

function loadFile(file) {
  if (state.buffers.has(file) || state.failed.has(file)) return null;
  if (state.loading.has(file)) return state.loading.get(file);
  const ctx = state.ctx;
  const doFetch = state.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!ctx || !doFetch || typeof ctx.decodeAudioData !== 'function') return null;
  const url = `${state.baseUrl}${file}.${pickExt()}`;
  const p = Promise.resolve()
    .then(() => doFetch(url))
    .then(res => {
      if (!res?.ok) throw new Error(`sfx ${url}: ${res?.status}`);
      return res.arrayBuffer();
    })
    .then(data => ctx.decodeAudioData(data))
    .then(buffer => { state.buffers.set(file, buffer); })
    .catch(() => { state.failed.add(file); })
    .finally(() => { state.loading.delete(file); });
  state.loading.set(file, p);
  return p;
}

// Everything is small (well under 1 MB in total), so load it all right after
// unlock — frequent tiers first — so even the first win/boost uses its sample.
function preload() {
  if (!state.isEnabled() || !state.ctx) return;
  for (const tier of TIERS) {
    for (const entry of Object.values(SFX)) {
      if (entry.tier !== tier) continue;
      for (const file of cueFiles(entry)) loadFile(file);
    }
  }
}

// Exposed for tests: resolves once every in-flight load has settled.
export function _whenIdle() {
  return Promise.all([...state.loading.values()]);
}

// ─── Context + unlock ──────────────────────────────────────

function ensureCtx() {
  if (!state.unlocked) return null;
  if (state.ctx) return state.ctx;
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  try {
    state.ctx = state.ctxFactory ? state.ctxFactory() : (Ctor ? new Ctor() : null);
  } catch {
    state.ctx = null;
  }
  if (state.ctx) preload();
  return state.ctx;
}

function armUnlock() {
  const doc = state.doc;
  if (!doc?.addEventListener || state.unlockHandler || state.unlocked) return;
  // The handler is intentionally INERT — it just flips a flag the first
  // time we observe a user gesture. We deliberately do NOT touch any audio
  // API here: those calls log Chrome's "AudioContext was not allowed to
  // start" warning if Chrome can't tie them to the activation. By the time
  // play() runs the user has clicked a button → game event → SFX, so
  // sticky activation is established and the context starts cleanly.
  const handler = () => {
    state.unlocked = true;
    if (state.doc?.removeEventListener) {
      state.doc.removeEventListener('pointerdown', handler);
      state.doc.removeEventListener('keydown',     handler);
      state.doc.removeEventListener('touchstart',  handler);
    }
    state.unlockHandler = null;
  };
  state.unlockHandler = handler;
  doc.addEventListener('pointerdown', handler, { once: true });
  doc.addEventListener('keydown',     handler, { once: true });
  doc.addEventListener('touchstart',  handler, { once: true });
}
