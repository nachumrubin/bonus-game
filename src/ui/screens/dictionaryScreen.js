import { $, on, setText } from '../domHelpers.js';
import { cleanDictionaryWord, parseSuggestedWords } from '../../game/account/dictionaryService.js';

export const DICT_INTENT = Object.freeze({
  OPEN_QUERY:       'dictionary/query/open',
  CLOSE_QUERY:      'dictionary/query/close',
  CHECK_QUERY:      'dictionary/query/check',
  SUBMIT_SUGGEST:   'dictionary/suggest/submit',
  OPEN_ADMIN_LOGIN: 'dictionary/admin-login/open',
  ADMIN_SIGN_IN:    'dictionary/admin/sign-in',
  ADMIN_SIGN_OUT:   'dictionary/admin/sign-out',
  ADMIN_CLOSE:      'dictionary/admin/close',
  ADMIN_APPROVE:    'dictionary/admin/approve',
  ADMIN_REJECT:     'dictionary/admin/reject',
  ADMIN_CONFIRM:    'dictionary/admin/confirm',
  ADMIN_CANCEL:     'dictionary/admin/cancel',
});

export const DICT_RENDER = Object.freeze({
  QUERY_RESULT:      'dictionary/query/result',
  SUGGESTION_STATUS: 'dictionary/suggest/status',
  ADMIN_LOGIN_ERROR: 'dictionary/admin-login/error',
  ADMIN_OPEN:        'dictionary/admin/open',
  ADMIN_RENDER:      'dictionary/admin/render',
  ADMIN_CONFIRM:     'dictionary/admin/confirm-open',
});

export function formatQueryResult({ word, valid, reason } = {}) {
  if (reason === 'empty') return { text: 'הקלד מילה', className: 'shres' };
  if (reason === 'loading') return { text: 'המילון עדיין נטען...', className: 'shres' };
  if (valid) return { text: `"${word}" — מילה חוקית ✓`, className: 'shres ok' };
  return { text: `"${word}" — לא נמצאה במילון ✕`, className: 'shres bad' };
}

export function buildAdminSuggestionsHtml(suggestions = [], selectedIds = new Set()) {
  if (!suggestions.length) {
    return '<div style="font-size:12px;color:#9ec4d8;">אין הצעות ממתינות</div>';
  }
  return suggestions.map((item) => `
    <label data-dict-suggestion="${escapeHtml(item.id)}" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border:1px solid #42657a;border-radius:8px;background:#0f2533;">
      <input type="checkbox" data-dict-suggestion-id="${escapeHtml(item.id)}" ${selectedIds.has(item.id) ? 'checked' : ''}>
      <span style="font-size:13px;color:#d7ebf8;">${escapeHtml(item.word)}</span>
    </label>
  `).join('');
}

export function mountDictionaryScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountDictionaryScreen: bus required');

  const queryOverlay = $('#ov-shailta', root);
  const loginOverlay = $('#ov-dict-login', root);
  const adminOverlay = $('#ov-dict-admin', root);
  const confirmOverlay = $('#ov-dict-confirm', root);
  const cleanups = [];
  let selectedIds = new Set();
  let lastAdminPayload = { suggestions: [] };
  let pendingAction = null;

  patchClick('button[onclick="openShailta()"]', root, () => bus.emit(DICT_INTENT.OPEN_QUERY, {}));
  patchClick('button[onclick="checkShailta()"]', queryOverlay ?? root, () => checkQuery('shin', 'shres', { clearAfterCheck: true }));
  patchClick('button[onclick="ovClose(\'ov-shailta\')"]', queryOverlay ?? root, () => {
    queryOverlay?.classList?.add('hidden');
    bus.emit(DICT_INTENT.CLOSE_QUERY, {});
  });
  patchClick('button[onclick="checkSettingsShailta()"]', root, () => checkQuery('settings-shin', 'settings-shres'));
  patchClick('button[onclick="suggestDictionaryWord()"]', root, () => submitSuggestions());
  patchClick('button[onclick="openDictionaryAdvancedSettings()"]', root, () => bus.emit(DICT_INTENT.OPEN_ADMIN_LOGIN, {}));
  patchClick('button[onclick="dictionaryAdminSignIn()"]', loginOverlay ?? root, () => signIn());
  patchClick('button[onclick="closeDictionaryAdvancedSettings()"]', loginOverlay ?? root, () => loginOverlay?.classList?.add('hidden'));
  patchClick('button[onclick="approveDictionaryWord()"]', adminOverlay ?? root, () => requestDecision('approve'));
  patchClick('button[onclick="rejectDictionaryWord()"]', adminOverlay ?? root, () => requestDecision('reject'));
  patchClick('button[onclick="dictionaryAdminSignOut()"]', adminOverlay ?? root, () => bus.emit(DICT_INTENT.ADMIN_SIGN_OUT, {}));
  patchClick('button[onclick="closeAdminWindow()"]', adminOverlay ?? root, () => {
    adminOverlay?.classList?.add('hidden');
    bus.emit(DICT_INTENT.ADMIN_CLOSE, {});
  });
  patchClick('button[onclick="confirmDictionaryDecision()"]', confirmOverlay ?? root, () => {
    confirmOverlay?.classList?.add('hidden');
    if (pendingAction) bus.emit(DICT_INTENT.ADMIN_CONFIRM, { action: pendingAction, ids: [...selectedIds] });
    pendingAction = null;
  });
  patchClick('button[onclick="cancelDictionaryDecision()"]', confirmOverlay ?? root, () => {
    pendingAction = null;
    confirmOverlay?.classList?.add('hidden');
    bus.emit(DICT_INTENT.ADMIN_CANCEL, {});
  });

  const queryInput = $('#shin', root);
  cleanups.push(on(queryInput, 'keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault?.();
      checkQuery('shin', 'shres', { clearAfterCheck: true });
    }
  }));
  const settingsInput = $('#settings-shin', root);
  cleanups.push(on(settingsInput, 'keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault?.();
      checkQuery('settings-shin', 'settings-shres');
    }
  }));
  const passInput = $('#dict-admin-password', root);
  cleanups.push(on(passInput, 'keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault?.();
      signIn();
    }
  }));
  const list = $('#dict-admin-suggestions', root);
  cleanups.push(on(list, 'change', (e) => {
    const id = e?.target?.getAttribute?.('data-dict-suggestion-id');
    if (!id) return;
    if (e.target.checked) selectedIds.add(id);
    else selectedIds.delete(id);
  }));

  cleanups.push(bus.on(DICT_INTENT.OPEN_QUERY, () => {
    const input = $('#shin', root);
    const result = $('#shres', root);
    if (input) input.value = '';
    if (result) { result.textContent = ''; result.className = 'shres'; }
    queryOverlay?.classList?.remove('hidden');
    globalThis.setTimeout?.(() => {
      input?.focus?.();
      input?.select?.();
    }, 0);
  }));

  cleanups.push(bus.on(DICT_RENDER.QUERY_RESULT, ({ target = 'main', ...payload } = {}) => {
    const result = target === 'settings' ? $('#settings-shres', root) : $('#shres', root);
    const formatted = formatQueryResult(payload);
    setText(result, formatted.text);
    if (result) result.className = formatted.className;
  }));

  cleanups.push(bus.on(DICT_RENDER.SUGGESTION_STATUS, ({ message = '', isError = false } = {}) => {
    const el = $('#dict-word-status', root);
    setText(el, message);
    if (el?.style) el.style.color = isError ? '#ff9c9c' : '#9fd4f5';
  }));

  cleanups.push(bus.on(DICT_INTENT.OPEN_ADMIN_LOGIN, () => {
    setText($('#dict-login-status', root), '');
    loginOverlay?.classList?.remove('hidden');
  }));

  cleanups.push(bus.on(DICT_RENDER.ADMIN_LOGIN_ERROR, ({ message = 'שגיאה בהתחברות' } = {}) => {
    const el = $('#dict-login-status', root);
    setText(el, message);
    if (el?.style) el.style.color = '#ff9c9c';
  }));

  cleanups.push(bus.on(DICT_RENDER.ADMIN_OPEN, () => {
    loginOverlay?.classList?.add('hidden');
    adminOverlay?.classList?.remove('hidden');
    $('#dict-admin-logout-btn', root)?.classList?.remove('hidden');
  }));

  cleanups.push(bus.on(DICT_RENDER.ADMIN_RENDER, (payload = {}) => {
    lastAdminPayload = payload;
    selectedIds = new Set([...selectedIds].filter((id) => payload.suggestions?.some((s) => s.id === id)));
    if (list) list.innerHTML = buildAdminSuggestionsHtml(payload.suggestions ?? [], selectedIds);
  }));

  cleanups.push(bus.on(DICT_RENDER.ADMIN_CONFIRM, ({ action, count } = {}) => {
    pendingAction = action;
    setText($('#dict-admin-confirm-text', root), action === 'approve'
      ? `לאשר ${count} מילה/ים? פעולה זו בלתי הפיכה.`
      : `לדחות ${count} מילה/ים? פעולה זו בלתי הפיכה.`);
    confirmOverlay?.classList?.remove('hidden');
  }));

  cleanups.push(bus.on(DICT_INTENT.ADMIN_SIGN_OUT, () => {
    selectedIds = new Set();
    pendingAction = null;
    adminOverlay?.classList?.add('hidden');
    confirmOverlay?.classList?.add('hidden');
    $('#dict-admin-logout-btn', root)?.classList?.add('hidden');
    if (list) list.innerHTML = buildAdminSuggestionsHtml([]);
  }));

  function checkQuery(inputId, resultId, { clearAfterCheck = false } = {}) {
    const input = root.querySelector?.(`#${inputId}`);
    const result = root.querySelector?.(`#${resultId}`);
    const word = cleanDictionaryWord(input?.value);
    if (input) input.value = word;
    const target = inputId === 'settings-shin' ? 'settings' : 'main';
    bus.emit(DICT_INTENT.CHECK_QUERY, { word, target });
    if (clearAfterCheck && word) {
      if (input) input.value = '';
      input?.focus?.();
    }
    return !!word && !!result;
  }

  function submitSuggestions() {
    const input = $('#dict-word-input', root);
    const words = parseSuggestedWords(input?.value);
    bus.emit(DICT_INTENT.SUBMIT_SUGGEST, { words });
  }

  function signIn() {
    const input = $('#dict-admin-password', root);
    bus.emit(DICT_INTENT.ADMIN_SIGN_IN, { password: String(input?.value ?? '') });
    if (input) input.value = '';
  }

  function requestDecision(action) {
    if (selectedIds.size === 0) {
      bus.emit(DICT_RENDER.SUGGESTION_STATUS, {
        message: action === 'approve' ? 'נא לבחור לפחות הצעה אחת לאישור' : 'נא לבחור לפחות הצעה אחת לדחייה',
        isError: true,
      });
      return;
    }
    bus.emit(action === 'approve' ? DICT_INTENT.ADMIN_APPROVE : DICT_INTENT.ADMIN_REJECT, {
      ids: [...selectedIds],
      suggestions: lastAdminPayload.suggestions ?? [],
    });
  }

  function patchClick(selector, scope, handler) {
    const btn = scope?.querySelector?.(selector);
    if (!btn) return;
    btn.removeAttribute?.('onclick');
    cleanups.push(on(btn, 'click', (e) => {
      e.preventDefault?.();
      handler(e);
    }));
  }

  function unmount() {
    for (const off of cleanups.splice(0)) try { off(); } catch {}
  }

  return { unmount };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}
