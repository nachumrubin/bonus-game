// Admin monitoring screen — visible only to admins.
// Emits ADMIN_INTENT.* for all actions; main.js handles Firebase reads/writes
// and emits ADMIN_RENDER.DATA with results.
import { $, on, setText } from '../domHelpers.js';
import { parseSuggestedWords } from '../../game/account/dictionaryService.js';
import { DICT_INTENT, DICT_RENDER } from './dictionaryScreen.js';

export const ADMIN_INTENT = Object.freeze({
  LOAD:               'admin/load',
  LOAD_GAME:          'admin/loadGame',
  APPROVE_SUGGESTION: 'admin/approveSuggestion',
  REJECT_SUGGESTION:  'admin/rejectSuggestion',
  BACK:               'admin/back',
});

export const ADMIN_RENDER = Object.freeze({
  DATA:               'admin/render/data',
  GAME:               'admin/render/game',
  SUGGESTION_DONE:    'admin/render/suggestionDone',
});

export function mountAdminScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountAdminScreen: bus required');

  const screenEl = $('#sadmin', root);
  if (!screenEl) return { unmount() {} };

  const cleanups = [];
  // Cache the last-loaded suggestions so approve/reject/bulk buttons can look up by key.
  let lastSuggestions = [];
  // Current filter: 'all' | 'add' | 'remove'
  let activeFilter = 'all';
  // All players (for search re-rendering)
  let allPlayers = [];
  // All games (for debug search re-rendering)
  let allGames = [];
  // Approved/blocked word arrays for the health modal
  let approvedWordsCache = [];
  let blockedWordsCache  = [];

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
    ['stats', 'players', 'words', 'debug'].forEach((t) => {
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

  // ── Suggestion type filter ─────────────────────────────────────────────────
  const filtersEl = $('#adm-sugg-filters', screenEl);
  if (filtersEl) {
    filtersEl.onclick = (e) => {
      const btn = e.target.closest('[data-adm-filter]');
      if (!btn) return;
      activeFilter = btn.dataset.admFilter;
      filtersEl.querySelectorAll('.adm-filter-btn').forEach((b) =>
        b.classList.toggle('adm-filter-btn--active', b === btn)
      );
      renderFilteredSuggestions();
    };
  }

  // ── Select-all checkbox ────────────────────────────────────────────────────
  const selectAllCb = $('#adm-select-all', screenEl);
  if (selectAllCb) {
    cleanups.push(on(selectAllCb, 'change', () => {
      const checked = selectAllCb.checked;
      screenEl.querySelectorAll('.adm-sugg-cb').forEach((cb) => { cb.checked = checked; });
      updateBulkBtn();
    }));
  }

  // ── Bulk approve ───────────────────────────────────────────────────────────
  const bulkApproveBtn = $('#adm-bulk-approve-btn', screenEl);
  if (bulkApproveBtn) {
    cleanups.push(on(bulkApproveBtn, 'click', () => {
      const keys = Array.from(screenEl.querySelectorAll('.adm-sugg-cb:checked'))
        .map((cb) => cb.dataset.admKey);
      if (!keys.length) return;
      keys.forEach((key) => {
        const sugg = lastSuggestions.find((s) => s.key === key);
        if (sugg) bus.emit(ADMIN_INTENT.APPROVE_SUGGESTION, { key: sugg.key, word: sugg.word, type: sugg.type });
      });
    }));
  }

  function updateBulkBtn() {
    if (!bulkApproveBtn) return;
    const n = screenEl.querySelectorAll('.adm-sugg-cb:checked').length;
    bulkApproveBtn.disabled = n === 0;
    bulkApproveBtn.textContent = n > 0 ? `✓ אשר ${n} נבחרים` : '✓ אשר נבחרים';
  }

  // ── Player search ──────────────────────────────────────────────────────────
  const playerSearch = $('#adm-player-search', screenEl);
  if (playerSearch) {
    cleanups.push(on(playerSearch, 'input', () => renderFilteredPlayers()));
  }

  // ── Debug panel controls ───────────────────────────────────────────────────
  const debugRefreshBtn = $('#adm-debug-refresh-btn', screenEl);
  if (debugRefreshBtn) cleanups.push(on(debugRefreshBtn, 'click', () => bus.emit(ADMIN_INTENT.LOAD, {})));
  const debugSearch = $('#adm-debug-search', screenEl);
  if (debugSearch) cleanups.push(on(debugSearch, 'input', () => renderFilteredGames()));

  // Click delegation on game rows → open detail modal
  const debugList = $('#adm-debug-list', screenEl);
  if (debugList) {
    cleanups.push(on(debugList, 'click', (e) => {
      const row = e.target.closest('.adm-game-row');
      if (!row) return;
      const roomId = row.dataset.roomId;
      if (!roomId) return;
      openGameModal(row);
      bus.emit(ADMIN_INTENT.LOAD_GAME, { roomId });
    }));
  }

  // ── Game detail modal ──────────────────────────────────────────────────────
  const gameModal     = $('#adm-game-modal',       screenEl);
  const gameModalClose = $('#adm-game-modal-close', screenEl);
  const gameTabBtns   = gameModal ? Array.from(gameModal.querySelectorAll('.adm-game-tab')) : [];

  gameTabBtns.forEach((btn) => {
    cleanups.push(on(btn, 'click', () => switchGameTab(btn.dataset.gameTab)));
  });
  if (gameModalClose) cleanups.push(on(gameModalClose, 'click', closeGameModal));
  if (gameModal) cleanups.push(on(gameModal, 'click', (e) => { if (e.target === gameModal) closeGameModal(); }));

  cleanups.push(bus.on(ADMIN_RENDER.GAME, (room = {}) => paintGameDetail(room)));

  // ── Word list modal ────────────────────────────────────────────────────────
  const wordModal    = $('#adm-word-modal', screenEl);
  const wordModalList  = $('#adm-word-modal-list', screenEl);
  const wordModalTitle = $('#adm-word-modal-title', screenEl);
  const wordModalClose = $('#adm-word-modal-close', screenEl);

  function openWordModal(words, title) {
    if (!wordModal || !wordModalList || !wordModalTitle) return;
    wordModalTitle.textContent = title;
    if (words.length === 0) {
      wordModalList.innerHTML = '<div class="adm-word-modal-empty">אין מילים</div>';
    } else {
      wordModalList.innerHTML = words
        .map((w) => `<span class="adm-word-pill">${esc(w)}</span>`)
        .join('');
    }
    wordModal.style.display = '';
  }

  function closeWordModal() {
    if (wordModal) wordModal.style.display = 'none';
  }

  if (wordModalClose) cleanups.push(on(wordModalClose, 'click', closeWordModal));
  if (wordModal) {
    cleanups.push(on(wordModal, 'click', (e) => {
      if (e.target === wordModal) closeWordModal();
    }));
  }

  const healthApproveBtn = $('#adm-health-btn-approved', screenEl);
  const healthBlockedBtn = $('#adm-health-btn-blocked',  screenEl);
  if (healthApproveBtn) {
    cleanups.push(on(healthApproveBtn, 'click', () =>
      openWordModal(approvedWordsCache, `✅ מילים שאושרו (${approvedWordsCache.length})`)));
  }
  if (healthBlockedBtn) {
    cleanups.push(on(healthBlockedBtn, 'click', () =>
      openWordModal(blockedWordsCache, `🚫 מילים חסומות (${blockedWordsCache.length})`)));
  }

  // ── Data render ────────────────────────────────────────────────────────────
  cleanups.push(bus.on(ADMIN_RENDER.DATA, (data = {}) => paint(data)));

  // After approve/reject, reload data to refresh counts + list.
  // Debounced so that bulk approvals (N events fired rapidly) only trigger
  // one LOAD after all parallel Firebase writes have landed, preventing a
  // stale early-LOAD result from overwriting the correct final count.
  let _loadDebounce = null;
  cleanups.push(bus.on(ADMIN_RENDER.SUGGESTION_DONE, () => {
    clearTimeout(_loadDebounce);
    _loadDebounce = setTimeout(() => bus.emit(ADMIN_INTENT.LOAD, {}), 400);
  }));

  // ── Paint ──────────────────────────────────────────────────────────────────
  function paint({
    totalPlayers = null,
    activeThisWeek = null,
    activeThisMonth = null,
    pendingCount = null,
    approvedCount = null,
    blockedCount = null,
    approvedWords = [],
    blockedWords = [],
    tierCounts = null,
    onlineNow = null,
    queueDepth = null,
    players = [],
    suggestions = [],
    rooms = [],
    loadedAt = null,
  } = {}) {
    approvedWordsCache = approvedWords;
    blockedWordsCache  = blockedWords;
    // Stats cards
    setVal('#adm-stat-total',   totalPlayers);
    setVal('#adm-stat-week',    activeThisWeek);
    setVal('#adm-stat-month',   activeThisMonth);
    setVal('#adm-stat-pending', pendingCount);
    setVal('#adm-stat-online',  onlineNow);
    setVal('#adm-stat-queue',   queueDepth);

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

    allPlayers = players;
    paintTop10(players);
    renderFilteredPlayers();

    lastSuggestions = suggestions;
    renderFilteredSuggestions();

    allGames = rooms;
    renderFilteredGames();
  }

  function setVal(id, val) {
    const el = $(id, screenEl);
    if (el && val != null) el.textContent = Number(val).toLocaleString('he');
  }

  // ── Top 10 section ─────────────────────────────────────────────────────────
  function paintTop10(players) {
    const top10El = $('#adm-top10-list', screenEl);
    if (!top10El) return;
    const top = players.slice(0, 10);
    const medals = ['🥇', '🥈', '🥉'];
    top10El.innerHTML = top.map((p, i) => {
      const medal = medals[i] ?? `${i + 1}.`;
      return `<div class="adm-top10-row">
        <span class="adm-top10-medal">${medal}</span>
        <span class="adm-top10-name">${esc(p.name ?? '—')}</span>
        <span class="adm-top10-rating">${p.rating != null ? Number(p.rating).toLocaleString('he') : '—'}</span>
      </div>`;
    }).join('');
  }

  // ── Player table with search ───────────────────────────────────────────────
  function renderFilteredPlayers() {
    const query = (playerSearch?.value ?? '').trim().toLowerCase();
    const filtered = query
      ? allPlayers.filter((p) => (p.name ?? '').toLowerCase().includes(query))
      : allPlayers;
    paintPlayers(filtered);
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

  // ── Suggestions with filter + checkboxes ──────────────────────────────────
  function renderFilteredSuggestions() {
    const pending = lastSuggestions.filter((s) => s.status === 'pending');
    const filtered = activeFilter === 'all'
      ? pending
      : pending.filter((s) => s.type === activeFilter);
    paintSuggestions(filtered);
  }

  function paintSuggestions(suggestions) {
    const loadingEl = $('#adm-sugg-loading', screenEl);
    const emptyEl   = $('#adm-sugg-empty',   screenEl);
    const listEl    = $('#adm-sugg-list',     screenEl);
    const bulkBar   = $('#adm-bulk-bar',      screenEl);
    if (!listEl) return;

    if (loadingEl) loadingEl.style.display = 'none';

    if (suggestions.length === 0) {
      if (emptyEl)  emptyEl.style.display  = '';
      if (bulkBar)  bulkBar.style.display  = 'none';
      listEl.innerHTML = '';
      listEl.onclick = null;
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (bulkBar) bulkBar.style.display = '';

    // Reset select-all
    if (selectAllCb) selectAllCb.checked = false;

    listEl.innerHTML = suggestions.map((s) => {
      const isRemove  = s.type === 'remove';
      const typeLabel = isRemove ? '🗑 הסרה' : '➕ הוספה';
      const typeCls   = isRemove ? 'adm-sugg--remove' : 'adm-sugg--add';
      const voterCount = Array.isArray(s.suggestedBy) ? s.suggestedBy.length : 1;
      const dateStr   = s.createdAt ? new Date(s.createdAt).toLocaleDateString('he-IL') : '';
      return `<div class="adm-sugg-row ${typeCls}" data-adm-key="${esc(s.key)}">
        <div class="adm-sugg-top">
          <label class="adm-sugg-cb-wrap">
            <input type="checkbox" class="adm-sugg-cb" data-adm-key="${esc(s.key)}">
          </label>
          <div class="adm-sugg-word">${esc(s.word)}</div>
        </div>
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

    // Delegate clicks for approve/reject and checkbox changes for bulk
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
    listEl.addEventListener('change', (e) => {
      if (e.target.classList.contains('adm-sugg-cb')) updateBulkBtn();
    });
  }

  // ── Debug game list ────────────────────────────────────────────────────────
  function renderFilteredGames() {
    const query = (debugSearch?.value ?? '').trim().toLowerCase();
    if (!query) { paintGames(allGames); return; }
    const filtered = allGames.filter((g) => {
      const p0 = (g.players?.['0']?.displayName ?? '').toLowerCase();
      const p1 = (g.players?.['1']?.displayName ?? '').toLowerCase();
      const uid0 = (g.players?.['0']?.uid ?? '').toLowerCase();
      const uid1 = (g.players?.['1']?.uid ?? '').toLowerCase();
      return (
        (g.roomId ?? '').toLowerCase().includes(query) ||
        p0.includes(query) || p1.includes(query) ||
        uid0.includes(query) || uid1.includes(query) ||
        (g.status ?? '').toLowerCase().includes(query) ||
        (g.mode ?? '').toLowerCase().includes(query) ||
        String(g.schemaVersion ?? '').includes(query)
      );
    });
    paintGames(filtered);
  }

  function paintGames(games) {
    const emptyEl = $('#adm-debug-empty', screenEl);
    const listEl  = $('#adm-debug-list',  screenEl);
    if (!listEl) return;

    if (games.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      listEl.innerHTML = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    listEl.innerHTML = games.map((g) => {
      const p0 = esc(g.players?.['0']?.displayName ?? '—');
      const p1 = esc(g.players?.['1']?.displayName ?? '—');
      const s0 = g.scores?.['0'] ?? 0;
      const s1 = g.scores?.['1'] ?? 0;
      const status = g.status ?? '?';
      const statusCls = `adm-game-status--${status}`;
      const dateStr = g.createdAt ? new Date(g.createdAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
      return `<div class="adm-game-row" data-room-id="${esc(g.roomId ?? '')}">
        <div class="adm-game-top">
          <span class="adm-game-status ${statusCls}">${esc(status)}</span>
          <span class="adm-game-meta">${esc(g.mode ?? '?')} · v${esc(String(g.schemaVersion ?? '?'))} · ${dateStr}</span>
          <span class="adm-game-arrow">›</span>
        </div>
        <div class="adm-game-players">
          <span>${p0}</span>
          <span class="adm-game-score">${s0} – ${s1}</span>
          <span>${p1}</span>
        </div>
        <div class="adm-game-rid">${esc(g.roomId ?? '')}</div>
      </div>`;
    }).join('');
  }

  // ── Game detail modal ──────────────────────────────────────────────────────
  function openGameModal(row) {
    if (!gameModal) return;
    // Reset to server tab + loading state
    switchGameTab('server');
    const loadingEl = $('#adm-game-loading', gameModal);
    const serverContent = $('#adm-game-server-content', gameModal);
    const p0Content = $('#adm-game-p0-content', gameModal);
    const p1Content = $('#adm-game-p1-content', gameModal);
    if (loadingEl)    loadingEl.style.display = '';
    if (serverContent) serverContent.innerHTML = '';
    if (p0Content)    p0Content.innerHTML = '';
    if (p1Content)    p1Content.innerHTML = '';
    // Show player names in title while loading
    const titleEl = $('#adm-game-modal-title', gameModal);
    if (titleEl) titleEl.textContent = row.querySelector('.adm-game-players')?.textContent?.trim() ?? '';
    gameModal.style.display = '';
  }

  function closeGameModal() {
    if (gameModal) gameModal.style.display = 'none';
  }

  function switchGameTab(tab) {
    gameTabBtns.forEach((b) => {
      b.classList.toggle('adm-game-tab--active', b.dataset.gameTab === tab);
    });
    ['server', 'p0', 'p1'].forEach((t) => {
      const panel = $(`#adm-game-panel-${t}`, gameModal);
      if (panel) panel.style.display = t === tab ? '' : 'none';
    });
  }

  function paintGameDetail(room) {
    const loadingEl = $('#adm-game-loading', gameModal);
    if (loadingEl) loadingEl.style.display = 'none';

    const p0 = room.players?.['0'] ?? {};
    const p1 = room.players?.['1'] ?? {};
    const s0 = room.scores?.['0'] ?? 0;
    const s1 = room.scores?.['1'] ?? 0;
    const titleEl = $('#adm-game-modal-title', gameModal);
    if (titleEl) titleEl.textContent = `${p0.displayName ?? '—'} vs ${p1.displayName ?? '—'}`;

    const dateStr = room.createdAt ? new Date(room.createdAt).toLocaleString('he-IL') : '—';
    const turnName = room.currentTurnSlot === 0 ? (p0.displayName ?? 'שחקן 1') : (p1.displayName ?? 'שחקן 2');
    const boardHtml = renderBoardGrid(room.board);
    const fullHistory = renderMoveHistory(room.moveHistory, room.players, null);

    const serverContent = $('#adm-game-server-content', gameModal);
    if (serverContent) {
      serverContent.innerHTML = `
        <div class="adm-detail-section">
          <div class="adm-detail-hdr">מטא-דאטה</div>
          <div class="adm-game-rid">${esc(room.roomId ?? '')}</div>
          <div class="adm-detail-meta">${esc(room.status ?? '?')} · ${esc(room.mode ?? '?')} · v${esc(String(room.schemaVersion ?? '?'))} · עדכון ${room.version ?? 0}</div>
          <div class="adm-detail-meta">${esc(dateStr)}</div>
          <div class="adm-detail-meta">תור: <strong>${esc(turnName)}</strong></div>
        </div>
        <div class="adm-detail-section">
          <div class="adm-detail-hdr">ניקוד</div>
          <div class="adm-detail-scores">
            <span>${esc(p0.displayName ?? '—')}: <strong>${s0}</strong></span>
            <span>${esc(p1.displayName ?? '—')}: <strong>${s1}</strong></span>
          </div>
        </div>
        <div class="adm-detail-section">
          <div class="adm-detail-hdr">לוח</div>
          ${boardHtml}
        </div>
        <div class="adm-detail-section">
          <div class="adm-detail-hdr">מדף ${esc(p0.displayName ?? 'שחקן 1')}</div>
          <div class="adm-rack">${renderRack(room.racks?.['0'])}</div>
        </div>
        <div class="adm-detail-section">
          <div class="adm-detail-hdr">מדף ${esc(p1.displayName ?? 'שחקן 2')}</div>
          <div class="adm-rack">${renderRack(room.racks?.['1'])}</div>
        </div>
        <div class="adm-detail-section">
          <div class="adm-detail-hdr">היסטוריית מהלכים (${(room.moveHistory ?? []).length})</div>
          ${fullHistory}
        </div>`;
    }

    const p0Content = $('#adm-game-p0-content', gameModal);
    if (p0Content) {
      p0Content.innerHTML = `
        <div class="adm-detail-player-card">
          <div class="adm-detail-player-name">${esc(p0.displayName ?? '—')}</div>
          <div class="adm-detail-player-score">${s0}</div>
          ${p0.rating != null ? `<div class="adm-detail-meta">דירוג: ${p0.rating}</div>` : ''}
        </div>
        <div class="adm-detail-section">
          <div class="adm-detail-hdr">מדף</div>
          <div class="adm-rack">${renderRack(room.racks?.['0'])}</div>
        </div>
        <div class="adm-detail-section">
          <div class="adm-detail-hdr">לוח</div>
          ${boardHtml}
        </div>
        <div class="adm-detail-section">
          <div class="adm-detail-hdr">מהלכים</div>
          ${renderMoveHistory(room.moveHistory, room.players, 0)}
        </div>`;
    }

    const p1Content = $('#adm-game-p1-content', gameModal);
    if (p1Content) {
      p1Content.innerHTML = `
        <div class="adm-detail-player-card">
          <div class="adm-detail-player-name">${esc(p1.displayName ?? '—')}</div>
          <div class="adm-detail-player-score">${s1}</div>
          ${p1.rating != null ? `<div class="adm-detail-meta">דירוג: ${p1.rating}</div>` : ''}
        </div>
        <div class="adm-detail-section">
          <div class="adm-detail-hdr">מדף</div>
          <div class="adm-rack">${renderRack(room.racks?.['1'])}</div>
        </div>
        <div class="adm-detail-section">
          <div class="adm-detail-hdr">לוח</div>
          ${boardHtml}
        </div>
        <div class="adm-detail-section">
          <div class="adm-detail-hdr">מהלכים</div>
          ${renderMoveHistory(room.moveHistory, room.players, 1)}
        </div>`;
    }
  }

  function renderBoardGrid(flat) {
    if (!flat) return '<div class="adm-detail-empty">אין נתוני לוח</div>';
    let html = '<table class="adm-board-grid"><tbody>';
    for (let r = 0; r < 10; r++) {
      html += '<tr>';
      for (let c = 0; c < 10; c++) {
        const t = flat[r * 10 + c];
        if (t?.letter) {
          const cls = t.isJoker ? 'adm-board-cell adm-board-cell--joker' : 'adm-board-cell adm-board-cell--tile';
          html += `<td class="${cls}">${esc(t.letter)}</td>`;
        } else {
          html += '<td class="adm-board-cell adm-board-cell--empty"></td>';
        }
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  function renderRack(tiles) {
    if (!Array.isArray(tiles) || !tiles.length) return '<span class="adm-detail-empty">ריק</span>';
    return tiles.map((t) => {
      const cls = t.isJoker ? 'adm-rack-tile adm-rack-tile--joker' : 'adm-rack-tile';
      return `<span class="${cls}">${esc(t.letter ?? '?')}</span>`;
    }).join('');
  }

  function renderMoveHistory(moveHistory, players, highlightSlot) {
    if (!Array.isArray(moveHistory) || !moveHistory.length)
      return '<div class="adm-detail-empty">אין מהלכים</div>';
    return moveHistory.map((move, i) => {
      const name = esc(players?.[move.slot]?.displayName ?? `שחקן ${(move.slot ?? 0) + 1}`);
      const words = (move.words ?? []).map(esc).join(', ');
      const timeStr = move.ts ? new Date(move.ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      const dimmed = highlightSlot !== null && move.slot !== highlightSlot ? ' adm-move-row--dim' : '';
      return `<div class="adm-move-row${dimmed}">
        <span class="adm-move-num">${i + 1}</span>
        <span class="adm-move-name">${name}</span>
        <span class="adm-move-words">${words || '—'}</span>
        <span class="adm-move-score">+${move.score ?? 0}</span>
        ${timeStr ? `<span class="adm-move-time">${timeStr}</span>` : ''}
      </div>`;
    }).join('');
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
