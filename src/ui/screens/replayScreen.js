// Game Debug Replay (admin) — renders the tri-panel synchronized board review
// (#ov-replay). Read-only: it only paints stored snapshots, never touches the
// engine or Firebase. Driven by REPLAY_OPEN with frames from replayPlayer.
//
// Each panel shows that source's latest snapshot at-or-before the scrubber
// position; a "diverged" badge marks a client whose hash differs from the
// server at the current frame (the P1-moved/P2-didn't-see-it bug, on screen).

import { $, on } from '../domHelpers.js';

export const REPLAY_OPEN = 'replay/open';
export const REPLAY_CLOSE = 'replay/close';

const AUTOPLAY_MS = 900;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function boardHTML(snap) {
  const board = snap?.board;
  if (!board) return '<div class="replay-board-empty">—</div>';
  const is2d = Array.isArray(board) && Array.isArray(board[0]);
  let html = '';
  for (let i = 0; i < 100; i++) {
    const t = is2d ? board[Math.floor(i / 10)]?.[i % 10] : board[i];
    const letter = t?.letter ?? '';
    html += `<div class="replay-cell${letter ? ' filled' : ''}${t?.isJoker ? ' joker' : ''}">${esc(letter)}</div>`;
  }
  return html;
}

export function mountReplayScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountReplayScreen: bus required');
  const overlay = $('#ov-replay', root);
  if (!overlay) { console.warn('[replayScreen] #ov-replay not found — not mounted'); return { unmount() {} }; }

  const cleanups = [];
  let frames = [];
  let i = 0;
  let timer = null;

  const els = {
    gid:   $('#replay-gid', root),
    scrub: $('#replay-scrub', root),
    label: $('#replay-frame-label', root),
    play:  $('#replay-play', root),
    boards: { p0: $('#replay-board-p0', root), p1: $('#replay-board-p1', root), srv: $('#replay-board-srv', root) },
    meta:   { p0: $('#replay-p0-meta', root), p1: $('#replay-p1-meta', root), srv: $('#replay-srv-meta', root) },
    title:  { p0: $('#replay-p0-title', root), p1: $('#replay-p1-title', root) },
    badge:  { p0: $('#replay-p0-badge', root), p1: $('#replay-p1-badge', root) },
    panel:  { p0: $('#replay-panel-p0', root), p1: $('#replay-panel-p1', root) },
  };

  function nameFor(snap, slot, fallback) {
    return snap?.players?.[slot]?.displayName ?? snap?.compact?.[slot === 0 ? 'hostName' : 'guestName'] ?? fallback;
  }

  function paintPanel(key, snap, slot, serverHash) {
    const board = els.boards[key];
    if (board) board.innerHTML = boardHTML(snap);
    const meta = els.meta[key];
    const c = snap?.compact ?? {};
    if (meta) {
      const ver = snap?.version ?? snap?.believedVersion ?? '—';
      meta.innerHTML = snap
        ? `v:${esc(ver)} · ${esc(c.hostScore ?? '?')}–${esc(c.guestScore ?? '?')} · תור ${esc(c.turnNumber ?? '?')}${snap.appVersion ? ` · <span class="replay-appver">app:${esc(snap.appVersion)}</span>` : ''}`
        : '<span class="replay-none">אין צילום</span>';
    }
    if (key !== 'srv') {
      const title = els.title[key];
      if (title) title.textContent = nameFor(snap, slot, slot === 0 ? 'שחקן 1' : 'שחקן 2');
      const badge = els.badge[key];
      const diverged = snap?.hash != null && serverHash != null && snap.hash !== serverHash;
      if (badge) { badge.textContent = diverged ? '⚠ לא תואם' : ''; badge.style.display = diverged ? '' : 'none'; }
      els.panel[key]?.classList?.toggle('replay-panel--diverged', !!diverged);
    }
  }

  function renderFrame(idx) {
    if (!frames.length) return;
    i = Math.max(0, Math.min(frames.length - 1, idx));
    const f = frames[i];
    const serverHash = f.server?.hash ?? null;
    paintPanel('srv', f.server, null, null);
    paintPanel('p0', f.p0, 0, serverHash);
    paintPanel('p1', f.p1, 1, serverHash);
    if (els.scrub) els.scrub.value = String(i);
    if (els.label) {
      const t = f.t ? new Date(f.t).toLocaleTimeString('he-IL') : '';
      els.label.textContent = `${i + 1}/${frames.length} · ${t}${f.diverged ? ' · ⚠ פער' : ''}`;
      els.label.classList.toggle('replay-diverged', !!f.diverged);
    }
  }

  function stopAutoplay() {
    if (timer) { clearInterval(timer); timer = null; }
    if (els.play) els.play.textContent = '▶';
  }
  function toggleAutoplay() {
    if (timer) { stopAutoplay(); return; }
    if (els.play) els.play.textContent = '⏸';
    timer = setInterval(() => {
      if (i >= frames.length - 1) { stopAutoplay(); return; }
      renderFrame(i + 1);
    }, AUTOPLAY_MS);
  }
  function close() {
    stopAutoplay();
    overlay.classList?.add('hidden');
  }

  cleanups.push(on($('#replay-first', root), 'click', () => { stopAutoplay(); renderFrame(0); }));
  cleanups.push(on($('#replay-prev', root), 'click', () => { stopAutoplay(); renderFrame(i - 1); }));
  cleanups.push(on($('#replay-next', root), 'click', () => { stopAutoplay(); renderFrame(i + 1); }));
  cleanups.push(on(els.play, 'click', toggleAutoplay));
  cleanups.push(on(els.scrub, 'input', () => { stopAutoplay(); renderFrame(Number(els.scrub.value) || 0); }));
  cleanups.push(on($('#replay-close', root), 'click', close));

  cleanups.push(bus.on(REPLAY_OPEN, ({ frames: fr = [], gameId = '' } = {}) => {
    frames = Array.isArray(fr) ? fr : [];
    stopAutoplay();
    if (els.gid) els.gid.textContent = gameId;
    if (els.scrub) { els.scrub.min = '0'; els.scrub.max = String(Math.max(0, frames.length - 1)); els.scrub.value = '0'; }
    renderFrame(0);
    overlay.classList?.remove('hidden');
  }));
  cleanups.push(bus.on(REPLAY_CLOSE, close));

  function unmount() {
    stopAutoplay();
    for (const off of cleanups) { try { off?.(); } catch { /* swallow */ } }
    cleanups.length = 0;
  }
  return { unmount };
}
