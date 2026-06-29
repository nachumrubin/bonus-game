// Admin monitoring screen — visible only to admins.
// Emits ADMIN_INTENT.* for all actions; main.js handles Firebase reads/writes
// and emits ADMIN_RENDER.DATA with results.
import { $, on, setText } from '../domHelpers.js';
import { parseSuggestedWords } from '../../game/account/dictionaryService.js';
import { DICT_INTENT, DICT_RENDER } from './dictionaryScreen.js';

export const ADMIN_INTENT = Object.freeze({
  LOAD:                'admin/load',
  APPROVE_SUGGESTION:  'admin/approveSuggestion',
  REJECT_SUGGESTION:   'admin/rejectSuggestion',
  BACK:                'admin/back',
  LOAD_DEBUG_REPORTS:  'admin/loadDebugReports',
  CLOSE_DEBUG_REPORTS: 'admin/closeDebugReports',
  RESPOND_DEBUG_REPORTS: 'admin/respondDebugReports',
  LOAD_DEBUG_INDEX:    'admin/loadDebugIndex',
  LOAD_DEBUG_TIMELINE: 'admin/loadDebugTimeline',
  REPLAY_GAME:         'admin/replayGame',
});

export const ADMIN_RENDER = Object.freeze({
  DATA:               'admin/render/data',
  SUGGESTION_DONE:    'admin/render/suggestionDone',
  DEBUG_REPORTS:      'admin/render/debugReports',
  DEBUG_INDEX:        'admin/render/debugIndex',
  DEBUG_TIMELINE:     'admin/render/debugTimeline',
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
    ['stats', 'players', 'words', 'reports', 'debug'].forEach((t) => {
      const panel = $(`#adm-panel-${t}`, screenEl);
      if (panel) panel.style.display = t === tab ? '' : 'none';
    });
    if (tab === 'reports' && !reportsLoaded) bus.emit(ADMIN_INTENT.LOAD_DEBUG_REPORTS, {});
    if (tab === 'debug' && !debugIndexLoaded) bus.emit(ADMIN_INTENT.LOAD_DEBUG_INDEX, {});
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
  const bulkRejectBtn = $('#adm-bulk-reject-btn', screenEl);

  function selectedSuggestionKeys() {
    return Array.from(screenEl.querySelectorAll('.adm-sugg-cb:checked'))
      .map((cb) => cb.dataset.admKey)
      .filter(Boolean);
  }

  if (bulkApproveBtn) {
    cleanups.push(on(bulkApproveBtn, 'click', () => {
      const keys = selectedSuggestionKeys();
      if (!keys.length) return;
      keys.forEach((key) => {
        const sugg = lastSuggestions.find((s) => s.key === key);
        if (sugg) bus.emit(ADMIN_INTENT.APPROVE_SUGGESTION, { key: sugg.key, word: sugg.word, type: sugg.type });
      });
    }));
  }
  if (bulkRejectBtn) {
    cleanups.push(on(bulkRejectBtn, 'click', () => {
      const keys = selectedSuggestionKeys();
      if (!keys.length) return;
      keys.forEach((key) => bus.emit(ADMIN_INTENT.REJECT_SUGGESTION, { key }));
    }));
  }

  function updateBulkBtn() {
    const n = selectedSuggestionKeys().length;
    if (bulkApproveBtn) {
      bulkApproveBtn.disabled = n === 0;
      bulkApproveBtn.textContent = n > 0 ? `✓ אשר ${n} נבחרים` : '✓ אשר נבחרים';
    }
    if (bulkRejectBtn) {
      bulkRejectBtn.disabled = n === 0;
      bulkRejectBtn.textContent = n > 0 ? `✕ הסר ${n} נבחרים` : '✕ הסר כל הנבחרים';
    }
  }

  // ── Player search ──────────────────────────────────────────────────────────
  const playerSearch = $('#adm-player-search', screenEl);
  if (playerSearch) {
    cleanups.push(on(playerSearch, 'input', () => renderFilteredPlayers()));
  }

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

    // Always keep roomsFallback fresh from the stats load. renderDebugGames()
    // uses this when debugIndex (from the dedicated debugGameIndex Firebase path)
    // is empty, so recent rooms are visible before "רענן רשימה" is clicked or
    // when the debug index hasn't accumulated entries yet.
    if (rooms.length > 0) {
      roomsFallback = rooms.map((r) => ({
        gameId:    r.roomId,
        hostName:  r.players?.['0']?.displayName ?? null,
        guestName: r.players?.['1']?.displayName ?? null,
        hostUid:   r.players?.['0']?.uid ?? null,
        guestUid:  r.players?.['1']?.uid ?? null,
        status:    r.status ?? null,
        mode:      r.mode ?? null,
        appVersion: null,
        createdAt: r.createdAt ?? null,
      }));
      if (debugIndex.length === 0) renderDebugGames();
    }

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

  // ── Contact reports tab ──────────────────────────────────────────────────
  let reportsLoaded = false;
  let debugReports = [];
  let reportLoadError = '';

  const reportSearch = $('#adm-report-search', screenEl);
  const reportReason = $('#adm-report-reason', screenEl);
  const reportStatus = $('#adm-report-status', screenEl);
  const reportLoadBtn = $('#adm-report-load-btn', screenEl);
  const reportSelectAll = $('#adm-report-select-all', screenEl);
  const reportRespondBtn = $('#adm-report-respond-btn', screenEl);
  const reportCloseBtn = $('#adm-report-close-btn', screenEl);
  const reportListEl = $('#adm-report-list', screenEl);
  const reportCountEl = $('#adm-report-count', screenEl);
  const reportResponseModal = $('#adm-report-response-modal', screenEl);
  const reportResponseOutcome = $('#adm-report-response-outcome', screenEl);
  const reportResponseMessage = $('#adm-report-response-message', screenEl);
  const reportResponseCount = $('#adm-report-response-count', screenEl);
  const reportResponseCancel = $('#adm-report-response-cancel', screenEl);
  const reportResponseSend = $('#adm-report-response-send', screenEl);

  if (reportLoadBtn) cleanups.push(on(reportLoadBtn, 'click', () => bus.emit(ADMIN_INTENT.LOAD_DEBUG_REPORTS, {})));
  if (reportSearch) cleanups.push(on(reportSearch, 'input', () => renderReports()));
  if (reportReason) cleanups.push(on(reportReason, 'change', () => renderReports()));
  if (reportStatus) cleanups.push(on(reportStatus, 'change', () => renderReports()));
  if (reportSelectAll) {
    cleanups.push(on(reportSelectAll, 'change', () => {
      const checked = reportSelectAll.checked;
      screenEl.querySelectorAll('.adm-report-cb:not(:disabled)').forEach((cb) => { cb.checked = checked; });
      updateReportActionBtns();
    }));
  }
  if (reportCloseBtn) {
    cleanups.push(on(reportCloseBtn, 'click', () => {
      const keys = selectedReportKeys();
      if (!keys.length) return;
      reportCloseBtn.disabled = true;
      bus.emit(ADMIN_INTENT.CLOSE_DEBUG_REPORTS, { keys });
    }));
  }
  if (reportRespondBtn) {
    cleanups.push(on(reportRespondBtn, 'click', () => {
      const keys = selectedReportKeys();
      if (!keys.length) return;
      openReportResponseModal(keys.length);
    }));
  }
  if (reportResponseCancel) cleanups.push(on(reportResponseCancel, 'click', () => closeReportResponseModal()));
  if (reportResponseModal) {
    cleanups.push(on(reportResponseModal, 'click', (e) => {
      if (e.target === reportResponseModal) closeReportResponseModal();
    }));
  }
  if (reportResponseSend) {
    cleanups.push(on(reportResponseSend, 'click', () => {
      const keys = selectedReportKeys();
      if (!keys.length) return;
      const outcome = reportResponseOutcome?.value || 'handled';
      const message = String(reportResponseMessage?.value ?? '').trim();
      reportResponseSend.disabled = true;
      if (reportRespondBtn) reportRespondBtn.disabled = true;
      bus.emit(ADMIN_INTENT.RESPOND_DEBUG_REPORTS, { keys, outcome, message });
      screenEl.querySelectorAll('.adm-report-cb:checked').forEach((cb) => { cb.checked = false; });
      closeReportResponseModal();
    }));
  }

  cleanups.push(bus.on(ADMIN_RENDER.DEBUG_REPORTS, ({ reports = [], error = '' } = {}) => {
    reportsLoaded = true;
    debugReports = reports;
    reportLoadError = String(error || '');
    renderReports();
  }));

  if (reportListEl) {
    reportListEl.onclick = (e) => {
      const gameId = e.target.closest?.('[data-report-game]')?.dataset?.reportGame;
      if (!gameId) return;
      switchTab('debug');
      bus.emit(ADMIN_INTENT.LOAD_DEBUG_TIMELINE, { gameId });
    };
    cleanups.push(on(reportListEl, 'change', (e) => {
      if (e.target.classList?.contains?.('adm-report-cb')) updateReportActionBtns();
    }));
  }

  function renderReports() {
    if (!reportListEl) return;
    if (reportLoadError) {
      if (reportCountEl) reportCountEl.textContent = `0 / ${debugReports.length.toLocaleString('he-IL')}`;
      if (reportSelectAll) reportSelectAll.checked = false;
      reportListEl.innerHTML = `<div class="adm-debug-empty">${esc(reportLoadError)}</div>`;
      updateReportActionBtns();
      return;
    }
    const q = (reportSearch?.value ?? '').trim().toLowerCase();
    const reason = reportReason?.value ?? 'all';
    const status = reportStatus?.value ?? 'open';
    const filtered = debugReports.filter((r) => {
      if (reason !== 'all' && r.reason !== reason) return false;
      const resolved = isReportResolved(r);
      if (status === 'open' && resolved) return false;
      if (status === 'resolved' && !resolved) return false;
      if (!q) return true;
      return [
        r.reportId, r.key, r.reason, r.status, r.userMessage, r.userId, r.playerName,
        r.screen, r.gameId, r.appVersion, r.platform, r.resolvedBy, r.responseOutcome, r.responseMessage,
      ].some((v) => String(v ?? '').toLowerCase().includes(q));
    });
    if (reportCountEl) {
      reportCountEl.textContent = `${filtered.length.toLocaleString('he-IL')} / ${debugReports.length.toLocaleString('he-IL')}`;
    }
    if (reportSelectAll) reportSelectAll.checked = false;
    const rows = filtered.slice(0, 200);
    if (rows.length === 0) {
      reportListEl.innerHTML = '<div class="adm-debug-empty">לא נמצאו פניות</div>';
      updateReportActionBtns();
      return;
    }
    reportListEl.innerHTML = rows.map((r) => {
      const when = reportTime(r);
      const msg = String(r.userMessage ?? '').trim();
      const gameId = r.gameId ? String(r.gameId) : '';
      const resolved = isReportResolved(r);
      return `<div class="adm-report-row">
        <div class="adm-report-head">
          <label class="adm-report-check">
            <input type="checkbox" class="adm-report-cb" data-report-key="${esc(r.key ?? r.reportId ?? '')}" ${resolved ? 'disabled' : ''}>
          </label>
          <span class="adm-report-reason adm-report-reason--${esc(cssToken(r.reason ?? 'unknown'))}">${esc(reasonLabel(r.reason))}</span>
          ${resolved ? '<span class="adm-report-status">סגור</span>' : ''}
          <span class="adm-report-player">${esc(r.playerName ?? r.userId ?? 'שחקן לא ידוע')}</span>
          <span class="adm-report-time">${esc(when)}</span>
        </div>
        <div class="adm-report-msg">${esc(msg || 'לא צורף פירוט')}</div>
        <div class="adm-report-meta">
          ${gameId ? `<button class="adm-report-game" data-report-game="${esc(gameId)}">פתח משחק ${esc(gameId)}</button>` : '<span>ללא משחק מקושר</span>'}
          <span>${esc(r.screen ?? 'מסך לא ידוע')}</span>
          <span>v:${esc(r.appVersion ?? '—')}</span>
          ${r.userId ? `<span class="adm-report-uid">${esc(r.userId)}</span>` : ''}
          ${r.responseOutcome ? `<span class="adm-report-response-chip">${esc(outcomeLabel(r.responseOutcome))}</span>` : ''}
        </div>
        ${r.responseMessage ? `<div class="adm-report-response-preview">${esc(r.responseMessage)}</div>` : ''}
      </div>`;
    }).join('');
    updateReportActionBtns();
  }

  function selectedReportKeys() {
    return Array.from(screenEl.querySelectorAll('.adm-report-cb:checked'))
      .map((cb) => cb.dataset.reportKey)
      .filter(Boolean);
  }

  function updateReportActionBtns() {
    const n = selectedReportKeys().length;
    if (reportCloseBtn) {
      reportCloseBtn.disabled = n === 0;
      reportCloseBtn.textContent = n > 0 ? `סגור ${n} פניות` : 'סגור פניות';
    }
    if (reportRespondBtn) {
      reportRespondBtn.disabled = n === 0;
      reportRespondBtn.textContent = n > 0 ? `השב וסגור ${n}` : 'השב וסגור';
    }
    if (reportResponseModal && !reportResponseModal.classList.contains('hidden')) {
      updateReportResponseCount(n);
    }
  }

  function openReportResponseModal(count) {
    if (!reportResponseModal) return;
    if (reportResponseOutcome) reportResponseOutcome.value = 'handled';
    if (reportResponseMessage) reportResponseMessage.value = '';
    if (reportResponseSend) reportResponseSend.disabled = false;
    updateReportResponseCount(count);
    reportResponseModal.classList.remove('hidden');
  }

  function closeReportResponseModal() {
    if (!reportResponseModal) return;
    reportResponseModal.classList.add('hidden');
    if (reportResponseSend) reportResponseSend.disabled = false;
    updateReportActionBtns();
  }

  function updateReportResponseCount(count) {
    if (!reportResponseCount) return;
    reportResponseCount.textContent = count > 0
      ? `${count.toLocaleString('he-IL')} פניות נבחרות. הודעה תישלח רק לפניות עם משתמש מחובר.`
      : '';
  }

  function isReportResolved(report) {
    return report?.status === 'resolved' || report?.resolved === true || report?.resolvedAt != null;
  }

  function reasonLabel(reason) {
    const labels = {
      'game-bug': 'דווח על בעיה במשחק',
      dictionary: 'מילון או הצעת מילה',
      account: 'חשבון, חברים או התראות',
      feedback: 'הצעת שיפור',
      other: 'אחר',
    };
    return labels[reason] ?? (reason || 'לא סווג');
  }

  function outcomeLabel(outcome) {
    const labels = {
      handled: 'טופל',
      rejected: 'נדחה',
      appreciated: 'תודה על ההצעה',
      'need-more-info': 'צריך עוד פרטים',
    };
    return labels[outcome] ?? (outcome || 'תגובה נשלחה');
  }

  function reportTime(report) {
    const ms = report.serverTimestamp ?? report.clientTimestamp ?? report.createdAt ?? null;
    return typeof ms === 'number' && Number.isFinite(ms)
      ? new Date(ms).toLocaleString('he-IL')
      : 'זמן לא ידוע';
  }

  function cssToken(value) {
    return String(value ?? '').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  }

  // ── Debug tab ──────────────────────────────────────────────────────────────
  let debugIndexLoaded = false;
  let debugIndex = [];          // [{ gameId, hostName, guestName, status, appVersion, createdAt, ... }]
  let roomsFallback = [];       // normalized rooms from the stats load; shown when debugIndex is empty
  let currentTimeline = null;

  const debugSearch   = $('#adm-debug-search', screenEl);
  const debugLoadBtn  = $('#adm-debug-load-btn', screenEl);
  const debugGamesEl  = $('#adm-debug-games', screenEl);
  const debugDetailEl = $('#adm-debug-detail', screenEl);
  const debugBackBtn  = $('#adm-debug-back-btn', screenEl);
  const debugReplayBtn = $('#adm-debug-replay-btn', screenEl);

  if (debugLoadBtn) cleanups.push(on(debugLoadBtn, 'click', () => bus.emit(ADMIN_INTENT.LOAD_DEBUG_INDEX, {})));
  if (debugSearch)  cleanups.push(on(debugSearch, 'input', () => renderDebugGames()));
  if (debugBackBtn) cleanups.push(on(debugBackBtn, 'click', () => {
    if (debugDetailEl) debugDetailEl.style.display = 'none';
    if (debugGamesEl)  debugGamesEl.style.display = '';
  }));
  if (debugReplayBtn) cleanups.push(on(debugReplayBtn, 'click', () => {
    if (currentTimeline?.gameId) bus.emit(ADMIN_INTENT.REPLAY_GAME, { gameId: currentTimeline.gameId });
  }));

  cleanups.push(bus.on(ADMIN_RENDER.DEBUG_INDEX, ({ games = [] } = {}) => {
    debugIndexLoaded = true;
    debugIndex = games;
    renderDebugGames();
  }));
  cleanups.push(bus.on(ADMIN_RENDER.DEBUG_TIMELINE, (payload = {}) => paintDebugTimeline(payload)));

  if (debugGamesEl) {
    debugGamesEl.onclick = (e) => {
      const row = e.target.closest?.('[data-debug-gid]');
      if (row) bus.emit(ADMIN_INTENT.LOAD_DEBUG_TIMELINE, { gameId: row.dataset.debugGid });
    };
  }

  function renderDebugGames() {
    if (!debugGamesEl) return;
    const source = debugIndex.length > 0 ? debugIndex : roomsFallback;
    const q = (debugSearch?.value ?? '').trim().toLowerCase();
    const rows = (q
      ? source.filter((g) => [g.gameId, g.hostName, g.guestName, g.hostUid, g.guestUid, g.status, g.appVersion]
          .some((v) => String(v ?? '').toLowerCase().includes(q)))
      : source
    ).slice(0, 200);
    if (rows.length === 0) {
      debugGamesEl.innerHTML = '<div class="adm-debug-empty">לא נמצאו משחקים</div>';
      return;
    }
    debugGamesEl.innerHTML = rows.map((g) => {
      const when = g.createdAt ? new Date(g.createdAt).toLocaleString('he-IL') : '—';
      return `<div class="adm-debug-game-row" data-debug-gid="${esc(g.gameId)}">
        <div class="adm-debug-game-players">${esc(g.hostName ?? '?')} <span class="adm-debug-vs">vs</span> ${esc(g.guestName ?? '?')}</div>
        <div class="adm-debug-game-meta">
          <span class="adm-debug-status adm-debug-status--${esc(g.status ?? '')}">${esc(g.status ?? '—')}</span>
          <span class="adm-debug-gid">${esc(g.gameId)}</span>
          <span class="adm-debug-ver">v:${esc(g.appVersion ?? '—')}</span>
          <span class="adm-debug-when">${esc(when)}</span>
        </div>
      </div>`;
    }).join('');
  }

  function paintDebugTimeline({ gameId, timeline } = {}) {
    currentTimeline = timeline ? { ...timeline, gameId } : null;
    if (debugGamesEl)  debugGamesEl.style.display = 'none';
    if (debugDetailEl) debugDetailEl.style.display = '';
    const idx = timeline?.index ?? {};
    const summaryEl = $('#adm-debug-summary', screenEl);
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="adm-debug-summary-row"><b>${esc(idx.hostName ?? '?')}</b> vs <b>${esc(idx.guestName ?? '?')}</b></div>
        <div class="adm-debug-summary-row">משחק: <code>${esc(gameId)}</code> · סטטוס: ${esc(idx.status ?? '—')} · מצב: ${esc(idx.mode ?? '—')}</div>
        <div class="adm-debug-summary-row">גרסת אפליקציה: ${esc(idx.appVersion ?? '—')} · נוצר: ${idx.createdAt ? esc(new Date(idx.createdAt).toLocaleString('he-IL')) : '—'}</div>
        <div class="adm-debug-summary-row">אירועים: ${timeline?.events?.length ?? 0} · צילומי מצב: ${timeline?.snapshots?.length ?? 0} · אזהרות: ${timeline?.warnings?.length ?? 0}</div>`;
    }

    const warnEl = $('#adm-debug-warnings', screenEl);
    if (warnEl) {
      const ws = timeline?.warnings ?? [];
      warnEl.innerHTML = ws.length === 0 ? '<div class="adm-debug-ok">✓ אין אזהרות</div>'
        : ws.map((w) => `<div class="adm-debug-warn adm-debug-warn--${esc(w.severity ?? 'low')}">
            <span class="adm-debug-warn-type">${esc(w.type)}</span>
            <span class="adm-debug-warn-msg">${esc(w.message ?? '')}</span>
            ${w.version != null ? `<span class="adm-debug-warn-ver">v${esc(w.version)}</span>` : ''}
          </div>`).join('');
    }

    // The per-event timeline + reports lists were removed from the detail view —
    // the replay overlay's time-aligned grid covers the event walkthrough. The
    // header summary (counts) and the warnings (anomaly diagnostics) stay.
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
