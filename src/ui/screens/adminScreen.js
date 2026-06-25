// Admin monitoring screen — visible only to admins.
// Emits ADMIN_INTENT.* for all actions; main.js handles Firebase reads/writes
// and emits ADMIN_RENDER.DATA with results.
import { $, on, setText } from '../domHelpers.js';
import { parseSuggestedWords } from '../../game/account/dictionaryService.js';
import { DICT_INTENT, DICT_RENDER } from './dictionaryScreen.js';

export const ADMIN_INTENT = Object.freeze({
  LOAD:               'admin/load',
  APPROVE_SUGGESTION: 'admin/approveSuggestion',
  REJECT_SUGGESTION:  'admin/rejectSuggestion',
  BACK:               'admin/back',
});

export const ADMIN_RENDER = Object.freeze({
  DATA:               'admin/render/data',
  SUGGESTION_DONE:    'admin/render/suggestionDone',
});

export function mountAdminScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountAdminScreen: bus required');

  const screenEl = $('#sadmin', root);
  if (!screenEl) return { unmount() {} };

  const cleanups = [];
  // Cache the last-loaded suggestions so approve/reject buttons can look up word+type by key.
  let lastSuggestions = [];

  // ── Tab switching ──────────────────────────────────────────────────────────
  const tabBtns = Array.from(screenEl.querySelectorAll('.adm-tab'));
  tabBtns.forEach((btn) => {
    cleanups.push(on(btn, 'click', () => switchTab(btn.dataset.admTab)));
  });

  function switchTab(tab) {
    if (!tab) return;
    tabBtns.forEach((b) => {
      const active = b.dataset.admTab === tab;
      b.classList.toggle('adm-tab--active', active);
      b.setAttribute('aria-selected', String(active));
    });
    ['stats', 'players', 'words'].forEach((t) => {
      const panel = $(`#adm-panel-${t}`, screenEl);
      if (panel) panel.style.display = t === tab ? '' : 'none';
    });
  }

  // ── Refresh button ─────────────────────────────────────────────────────────
  const refreshBtn = $('#adm-refresh-btn', screenEl);
  if (refreshBtn) cleanups.push(on(refreshBtn, 'click', () => bus.emit(ADMIN_INTENT.LOAD, {})));

  // ── Back button ────────────────────────────────────────────────────────────
  const backBtn = $('#adm-back-btn', screenEl);
  if (backBtn) cleanups.push(on(backBtn, 'click', () => bus.emit(ADMIN_INTENT.BACK, {})));

  // ── Direct add/remove (moved from settings dict-mgmt-panel) ───────────────
  const addBtn = $('#adm-dict-add-btn', screenEl);
  if (addBtn) {
    cleanups.push(on(addBtn, 'click', () => {
      const input = $('#adm-dict-word-input', screenEl);
      bus.emit(DICT_INTENT.SUBMIT_SUGGEST, { words: parseSuggestedWords(input?.value ?? '') });
    }));
  }
  const removeBtn = $('#adm-dict-remove-btn', screenEl);
  if (removeBtn) {
    cleanups.push(on(removeBtn, 'click', () => {
      const input = $('#adm-dict-remove-input', screenEl);
      bus.emit(DICT_INTENT.SUBMIT_REMOVAL, { words: parseSuggestedWords(input?.value ?? '') });
    }));
  }

  // Reflect DICT_RENDER status onto the admin screen's own status elements.
  cleanups.push(bus.on(DICT_RENDER.SUGGESTION_STATUS, ({ message = '', isError = false } = {}) => {
    const el = $('#adm-dict-word-status', screenEl);
    setText(el, message);
    if (el?.style) el.style.color = isError ? '#ff9c9c' : '#9fd4f5';
    if (!isError) {
      const input = $('#adm-dict-word-input', screenEl);
      if (input) input.value = '';
    }
  }));
  cleanups.push(bus.on(DICT_RENDER.REMOVAL_STATUS, ({ message = '', isError = false } = {}) => {
    const el = $('#adm-dict-remove-status', screenEl);
    setText(el, message);
    if (el?.style) el.style.color = isError ? '#ff9c9c' : '#9fd4f5';
    if (!isError) {
      const input = $('#adm-dict-remove-input', screenEl);
      if (input) input.value = '';
    }
  }));

  // ── Data render ────────────────────────────────────────────────────────────
  cleanups.push(bus.on(ADMIN_RENDER.DATA, (data = {}) => paint(data)));

  // After approve/reject, reload data to refresh counts + list.
  cleanups.push(bus.on(ADMIN_RENDER.SUGGESTION_DONE, () => bus.emit(ADMIN_INTENT.LOAD, {})));

  // ── Paint ──────────────────────────────────────────────────────────────────
  function paint({
    totalPlayers = null,
    activeThisWeek = null,
    activeThisMonth = null,
    pendingCount = null,
    approvedCount = null,
    blockedCount = null,
    tierCounts = null,
    players = [],
    suggestions = [],
    loadedAt = null,
  } = {}) {
    // Stats cards
    setVal('#adm-stat-total',   totalPlayers);
    setVal('#adm-stat-week',    activeThisWeek);
    setVal('#adm-stat-month',   activeThisMonth);
    setVal('#adm-stat-pending', pendingCount);

    // Dictionary health
    setVal('#adm-health-approved', approvedCount);
    setVal('#adm-health-blocked',  blockedCount);

    // Tier distribution
    if (tierCounts) {
      setVal('#adm-tier-bronze',  tierCounts.bronze);
      setVal('#adm-tier-silver',  tierCounts.silver);
      setVal('#adm-tier-gold',    tierCounts.gold);
      setVal('#adm-tier-diamond', tierCounts.diamond);
    }

    // Last-refresh time
    if (loadedAt) {
      const lastRefreshEl = $('#adm-last-refresh', screenEl);
      if (lastRefreshEl) {
        lastRefreshEl.textContent = `עודכן: ${new Date(loadedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
      }
    }

    paintPlayers(players);
    lastSuggestions = suggestions;
    paintSuggestions(suggestions);
  }

  function setVal(id, val) {
    const el = $(id, screenEl);
    if (el && val != null) el.textContent = Number(val).toLocaleString('he');
  }

  function paintPlayers(players) {
    const loadingEl = $('#adm-players-loading', screenEl);
    const tableEl   = $('#adm-players-table',   screenEl);
    const tbody     = $('#adm-players-body',     screenEl);
    if (!tbody) return;

    if (loadingEl) loadingEl.style.display = 'none';
    if (tableEl)   tableEl.style.display   = '';

    const weekAgo  = Date.now() - 7  * 24 * 3600_000;
    tbody.innerHTML = players.map((p, i) => {
      const ms  = typeof p.updatedAt === 'number' ? p.updatedAt : 0;
      const dateStr = ms ? new Date(ms).toLocaleDateString('he-IL') : '—';
      const recentCls = ms > weekAgo ? ' adm-date--recent' : '';
      return `<tr>
        <td class="adm-rank">${i + 1}</td>
        <td class="adm-player-name">${esc(p.name ?? '—')}</td>
        <td class="adm-rating">${p.rating != null ? Number(p.rating).toLocaleString('he') : '—'}</td>
        <td class="adm-date${recentCls}">${dateStr}</td>
      </tr>`;
    }).join('');
  }

  function paintSuggestions(suggestions) {
    const loadingEl = $('#adm-sugg-loading', screenEl);
    const emptyEl   = $('#adm-sugg-empty',   screenEl);
    const listEl    = $('#adm-sugg-list',     screenEl);
    if (!listEl) return;

    if (loadingEl) loadingEl.style.display = 'none';

    const pending = suggestions.filter((s) => s.status === 'pending');
    if (pending.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      listEl.innerHTML = '';
      listEl.onclick = null;
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    listEl.innerHTML = pending.map((s) => {
      const isRemove   = s.type === 'remove';
      const typeLabel  = isRemove ? '🗑 הסרה' : '➕ הוספה';
      const typeCls    = isRemove ? 'adm-sugg--remove' : 'adm-sugg--add';
      const voterCount = Array.isArray(s.suggestedBy) ? s.suggestedBy.length : 1;
      const dateStr    = s.createdAt ? new Date(s.createdAt).toLocaleDateString('he-IL') : '';
      return `<div class="adm-sugg-row ${typeCls}" data-adm-key="${esc(s.key)}">
        <div class="adm-sugg-word">${esc(s.word)}</div>
        <div class="adm-sugg-meta">
          <span class="adm-sugg-type">${typeLabel}</span>
          <span class="adm-sugg-voters">${voterCount} הצע${voterCount === 1 ? 'ה' : 'ות'}</span>
          ${dateStr ? `<span class="adm-sugg-date">${dateStr}</span>` : ''}
        </div>
        <div class="adm-sugg-actions">
          <button class="adm-sugg-approve" data-adm-approve="${esc(s.key)}">✓ אשר</button>
          <button class="adm-sugg-reject"  data-adm-reject="${esc(s.key)}">✕ דחה</button>
        </div>
      </div>`;
    }).join('');

    listEl.onclick = (e) => {
      const approveKey = e.target.closest?.('[data-adm-approve]')?.dataset?.admApprove;
      const rejectKey  = e.target.closest?.('[data-adm-reject]')?.dataset?.admReject;
      if (approveKey) {
        const sugg = lastSuggestions.find((s) => s.key === approveKey);
        if (sugg) bus.emit(ADMIN_INTENT.APPROVE_SUGGESTION, { key: sugg.key, word: sugg.word, type: sugg.type });
      } else if (rejectKey) {
        bus.emit(ADMIN_INTENT.REJECT_SUGGESTION, { key: rejectKey });
      }
    };
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}
