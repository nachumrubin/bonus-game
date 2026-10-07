// scoreboardLive — the game screen's handle on the live 3D scoreboard. No three.js here:
// the 3D code (scoreboard3d.js, ~700 KB of three.js) is imported only once a slot has a
// model to show, and only where live 3D can run. Everywhere else the slots keep their
// still images, and play() returns false so the caller falls back to its other cues.
//
// Stills, not 3D: reduced motion, no WebGL 2, a model that fails to load, or a phone too
// slow for it (scoreboard3d measures the first frames and gives up).

import { modelSrcForAvatar } from './boostieSources.js';

export function canUseLive3d(win = globalThis) {
  return !!(win?.WebGL2RenderingContext && win.document?.createElement && win.requestAnimationFrame);
}

// hosts(): the slot elements, looked up each time (the screen may re-render them). The
// scoreboard has two; the store's reaction preview has one.
// importer: () => import('./scoreboard3d.js') (injectable for tests).
export function createScoreboardLive({
  hosts,
  prefersReducedMotion = () => false,
  enabled = canUseLive3d(),
  importer = () => import('./scoreboard3d.js'),
  look = {},                 // passed to createScoreboard3d: { lively, yaw } (the home top bar)
} = {}) {
  let board = null, loading = null, off = !enabled, disposed = false;
  let wanted = [];
  let pending = [];          // per slot: the setAvatar promise (ready())

  function ensure() {
    if (board || loading || off || disposed) return loading;
    const els = hosts();
    if (!els.length || els.some((el) => !el)) return null;
    loading = importer()
      .then(({ createScoreboard3d }) => {
        if (disposed) return;
        board = createScoreboard3d({ ...look, hosts: els, onFallback: () => { off = true; board = null; } });
        pending = wanted.map((src, i) => board.setAvatar(i, src));
      })
      .catch((e) => {
        off = true;
        console.warn('[boostie3d] live 3D unavailable, showing stills:', e?.message || e);
      });
    return loading;
  }

  const api = {
    // Avatar values, one per slot; call after every identity render (it also puts the
    // 3D canvas back if the slot was rewritten).
    sync(values) {
      if (off || disposed) return;
      if (prefersReducedMotion()) return;
      wanted = (values ?? []).map((v) => modelSrcForAvatar(v));
      if (board) pending = wanted.map((src, i) => board.setAvatar(i, src));
      else if (wanted.some(Boolean)) ensure();
    },
    // Resolves once the slot's model has loaded (or failed): true when play() can run.
    async ready(slot) {
      try { await loading; await pending[slot]; } catch {}
      return api.canPlay(slot);
    },
    // Plays a clip on a slot's live avatar; false when that slot isn't live 3D.
    play(slot, kind) {
      if (off || disposed || !board || prefersReducedMotion()) return false;
      return board.play(slot, kind);
    },
    canPlay(slot) { return !off && !disposed && !!board?.canPlay(slot) && !prefersReducedMotion(); },
    dispose() {
      disposed = true;
      board?.dispose();
      board = null;
    },
    _state: () => ({ off, board, wanted }),   // test hook
  };
  return api;
}
