// Game Debug Replay (admin) — renders the tri-panel synchronized board review
// (#ov-replay). Read-only: it only paints stored snapshots, never touches the
// engine or Firebase. Driven by REPLAY_OPEN with frames from replayPlayer.
//
// Each panel shows that source's latest snapshot at-or-before the scrubber
// position; a "diverged" badge marks a client whose hash differs from the
// server at the current frame (the P1-moved/P2-didn't-see-it bug, on screen).

import { $, on } from '../domHelpers.js';
import { snapshotOutcomeKey } from '../../game/debug/replayPlayer.js';
import { BDEFS, BONUS_TYPES } from '../../game/boosts/data.js';
import { describeBonus } from './bonusIntroScreen.js';

// Human-readable effect for each boost id (the resolved future effect / award).
const BOOST_EFFECT_HE = {
  auto_extra_score:           'נקודות בונוס',
  extra_turn:                 'תור נוסף',
  timer_bonus:                'תוספת זמן',
  skip_opponent_turn:         'דילוג על היריב',
  free_tile_swap:             'החלפת אותיות חינם',
  cancel_next_opponent_bonus: 'ביטול בונוס יריב',
  multiply_next_turns:        'מכפיל ניקוד',
};

export const REPLAY_OPEN = 'replay/open';
export const REPLAY_CLOSE = 'replay/close';

const AUTOPLAY_MS = 900;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Grid position "(gr,gc)" (1-based in a 12x12 grid) → BDEFS boost-square index,
// matching the live board's buildSpineUnifiedGrid layout (slot at br+2, bc+2).
const BOOST_SLOT_AT = new Map(BDEFS.map((b, idx) => [`${b.br + 2},${b.bc + 2}`, idx]));

function cellHTML(t) {
  const letter = t?.letter ?? '';
  return `<div class="replay-cell${letter ? ' filled' : ''}${t?.isJoker ? ' joker' : ''}">${esc(letter)}</div>`;
}

// Render the full 12x12 board: the inner 10x10 play area plus the 12 perimeter
// boost squares. Each boost square shows its assigned bonus (icon + points), or
// the tile a player dropped on it (from bonusBoard), and dims once consumed
// (bonusSqUsed) — so a word played onto a boost square is visible in the replay.
function boardHTML(snap) {
  const board = snap?.board;
  if (!board) return '<div class="replay-board-empty">—</div>';
  const is2d = Array.isArray(board) && Array.isArray(board[0]);
  const cellAt = (i) => (is2d ? board[Math.floor(i / 10)]?.[i % 10] : board[i]);
  const assignment = Array.isArray(snap.bonusAssignment) ? snap.bonusAssignment : [];
  const bonusBoard = snap.bonusBoard ?? {};
  const used = snap.bonusSqUsed ?? {};

  let html = '';
  for (let gr = 1; gr <= 12; gr++) {
    for (let gc = 1; gc <= 12; gc++) {
      const idx = BOOST_SLOT_AT.get(`${gr},${gc}`);
      if (idx != null) {
        const def = BDEFS[idx];
        const ba = assignment[idx] ?? BONUS_TYPES[idx % BONUS_TYPES.length] ?? {};
        const tile = bonusBoard[`${def.br},${def.bc}`];
        const isUsed = !!(used[idx] ?? used[String(idx)]);
        const inner = tile?.letter != null
          ? `<div class="replay-bsq-tile${tile.isJoker ? ' joker' : ''}">${esc(tile.letter)}</div>`
          : `<div class="replay-bsq-ic">${esc(ba.ic ?? '⚡')}</div>${ba.pts ? `<div class="replay-bsq-pts">${esc(ba.pts)}</div>` : ''}`;
        html += `<div class="replay-bsq${isUsed ? ' used' : ''}${tile ? ' has-tile' : ''}" title="${esc(ba.type ?? '')}">${inner}</div>`;
        continue;
      }
      if (gr >= 2 && gr <= 11 && gc >= 2 && gc <= 11) {
        html += cellHTML(cellAt((gr - 2) * 10 + (gc - 2)));
        continue;
      }
      html += '<div class="replay-perim"></div>';
    }
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
    bonus: $('#replay-bonus', root),
    boards: { p0: $('#replay-board-p0', root), p1: $('#replay-board-p1', root), srv: $('#replay-board-srv', root) },
    meta:   { p0: $('#replay-p0-meta', root), p1: $('#replay-p1-meta', root), srv: $('#replay-srv-meta', root) },
    title:  { p0: $('#replay-p0-title', root), p1: $('#replay-p1-title', root) },
    badge:  { p0: $('#replay-p0-badge', root), p1: $('#replay-p1-badge', root) },
    panel:  { p0: $('#replay-panel-p0', root), p1: $('#replay-panel-p1', root) },
    timeline: $('#replay-timeline', root),
  };

  // Time-aligned timeline rows, built once on open as [{ t, el }].
  let rowEls = [];

  function nameFor(snap, slot, fallback) {
    return snap?.players?.[slot]?.displayName ?? snap?.compact?.[slot === 0 ? 'hostName' : 'guestName'] ?? fallback;
  }

  // Render the "bonus this move" strip — the mini-game(s) that resolved on the
  // boost squares hit in this frame's window, plus the awarded effect/points.
  function renderBonuses(f) {
    const el = els.bonus;
    if (!el) return;
    const list = Array.isArray(f.bonuses) ? f.bonuses : [];
    if (!list.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = list.map((bz) => {
      const who = nameFor(f.server ?? f.p0 ?? f.p1, bz.slot, `שחקן ${(bz.slot ?? 0) + 1}`);
      const title = bz.bonusType ? esc(describeBonus(bz.bonusType).title) : '⚡ בוסט';
      const effect = esc(BOOST_EFFECT_HE[bz.boostId] ?? bz.boostId ?? '');
      const pts = bz.extra ? `<span class="replay-bonus-pts">+${esc(bz.extra)}</span>` : '';
      return `<span class="replay-bonus-item"><b>${esc(who)}</b> · ${title}${effect ? ` → ${effect}` : ''} ${pts}</span>`;
    }).join('');
  }

  const doc = () => (root.createElement ? root : (root.ownerDocument ?? globalThis.document));

  // Time label: the wall clock when t is a real epoch; for the demo's tiny
  // synthetic timestamps, a plain seconds value instead.
  function timeLabel(t) {
    return t > 1e11 ? new Date(t).toLocaleTimeString('he-IL') : `${(t / 1000).toFixed(t % 1000 ? 3 : 0)}s`;
  }

  // A data cell is an array of labels (one line each); empty → blank "----".
  function dataCell(labels) {
    const list = Array.isArray(labels) ? labels : (labels == null ? [] : [labels]);
    if (!list.length) return '<span class="replay-tl-cell"><span class="replay-tl-none">----</span></span>';
    const lines = list.map((l) => `<span class="replay-tl-line">${esc(l)}</span>`).join('');
    return `<span class="replay-tl-cell" title="${esc(list.join(' · '))}">${lines}</span>`;
  }
  function headRow(time, p0, p1, srv) {
    const h = (v) => `<span class="replay-tl-cell replay-tl-h">${esc(v)}</span>`;
    return `<span class="replay-tl-cell replay-tl-t replay-tl-h">${esc(time)}</span>${h(p0)}${h(p1)}${h(srv)}`;
  }
  // Column order matches the board panels (p0 host, p1 guest, srv server).
  function dataRow(time, p0, p1, srv) {
    return `<span class="replay-tl-cell replay-tl-t">${esc(time)}</span>${dataCell(p0)}${dataCell(p1)}${dataCell(srv)}`;
  }

  // Build the time-aligned grid once (on open): a sticky header naming each side
  // (matching the boards), then one row per moment.
  function buildTimelineRows(rows, names) {
    rowEls = [];
    const tl = els.timeline;
    if (!tl) return;
    tl.innerHTML = '';
    const header = doc().createElement('div');
    header.className = 'replay-tl-row replay-tl-head';
    header.innerHTML = headRow('זמן', names.p0, names.p1, 'שרת (אמת)');
    tl.appendChild(header);

    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) { tl.appendChild(Object.assign(doc().createElement('div'), { className: 'replay-tl-empty', textContent: '—' })); return; }
    for (const r of list) {
      const row = doc().createElement('div');
      row.className = 'replay-tl-row';
      row.innerHTML = dataRow(timeLabel(r.t), r.p0, r.p1, r.srv);
      row.addEventListener('click', () => jumpToTime(r.t));
      tl.appendChild(row);
      rowEls.push({ t: r.t, el: row });
    }
  }

  // Jump the scrubber to the frame at-or-before a clicked row's time.
  function jumpToTime(t) {
    let idx = 0;
    for (let k = 0; k < frames.length; k++) { if (frames[k].t <= t) idx = k; else break; }
    stopAutoplay();
    renderFrame(idx);
  }

  // Mark each row past/current/future relative to the frame time, and keep the
  // current row in view. "current" = the latest row at-or-before the frame.
  function highlightTimeline(t) {
    let cur = -1;
    for (let k = 0; k < rowEls.length; k++) { if (rowEls[k].t <= t) cur = k; else break; }
    rowEls.forEach(({ el }, k) => {
      el.classList.remove('past', 'current', 'future');
      el.classList.add(k < cur ? 'past' : k === cur ? 'current' : 'future');
    });
    if (cur >= 0) rowEls[cur].el.scrollIntoView?.({ block: 'nearest' });
  }

  function paintPanel(key, snap, slot, serverKey) {
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
      const clientKey = snapshotOutcomeKey(snap);
      const diverged = clientKey != null && serverKey != null && clientKey !== serverKey;
      if (badge) { badge.textContent = diverged ? '⚠ לא תואם' : ''; badge.style.display = diverged ? '' : 'none'; }
      els.panel[key]?.classList?.toggle('replay-panel--diverged', !!diverged);
    }
  }

  function renderFrame(idx) {
    if (!frames.length) return;
    i = Math.max(0, Math.min(frames.length - 1, idx));
    const f = frames[i];
    const serverKey = snapshotOutcomeKey(f.server);
    paintPanel('srv', f.server, null, null);
    paintPanel('p0', f.p0, 0, serverKey);
    paintPanel('p1', f.p1, 1, serverKey);
    renderBonuses(f);
    highlightTimeline(f.t);
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

  cleanups.push(on($('#replay-prev', root), 'click', () => { stopAutoplay(); renderFrame(i - 1); }));
  cleanups.push(on($('#replay-next', root), 'click', () => { stopAutoplay(); renderFrame(i + 1); }));
  cleanups.push(on(els.play, 'click', toggleAutoplay));
  cleanups.push(on(els.scrub, 'input', () => { stopAutoplay(); renderFrame(Number(els.scrub.value) || 0); }));
  cleanups.push(on($('#replay-close', root), 'click', close));

  cleanups.push(bus.on(REPLAY_OPEN, ({ frames: fr = [], rows = null, gameId = '' } = {}) => {
    frames = Array.isArray(fr) ? fr : [];
    stopAutoplay();
    if (els.gid) els.gid.textContent = gameId;
    const anySnap = frames.find((f) => f.server || f.p0 || f.p1) ?? {};
    const names = {
      p0: nameFor(anySnap.server ?? anySnap.p0, 0, 'שחקן 1'),
      p1: nameFor(anySnap.server ?? anySnap.p1, 1, 'שחקן 2'),
    };
    buildTimelineRows(rows ?? [], names);
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
