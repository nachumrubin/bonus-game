import { $, on, setText } from '../domHelpers.js';
import { cleanDictionaryWord, parseSuggestedWords } from '../../game/account/dictionaryService.js';

export const DICT_INTENT = Object.freeze({
  OPEN_QUERY:            'dictionary/query/open',
  CLOSE_QUERY:           'dictionary/query/close',
  CHECK_QUERY:           'dictionary/query/check',
  SUBMIT_SUGGEST:        'dictionary/suggest/submit',         // admin direct-add (legacy intent name)
  SUBMIT_REMOVAL:        'dictionary/removal/submit',         // admin direct-remove
  USER_SUGGEST:          'dictionary/user-suggest/submit',    // user add-suggestion (pending admin review)
  USER_SUGGEST_REMOVAL:  'dictionary/user-suggest-removal/submit', // user remove-suggestion
  TOGGLE_WORD_INFO:      'dictionary/word-info/toggle',       // { enabled } — "word origin" panel on/off
});

export const DICT_RENDER = Object.freeze({
  QUERY_RESULT:                 'dictionary/query/result',
  SUGGESTION_STATUS:            'dictionary/suggest/status',
  REMOVAL_STATUS:               'dictionary/removal/status',
  USER_SUGGEST_STATUS:          'dictionary/user-suggest/status',
  USER_SUGGEST_REMOVAL_STATUS:  'dictionary/user-suggest-removal/status',
  WORD_INFO:                    'dictionary/word-info/result',  // see wordInfoController.js
});

// Word-info panel ids per check target (the מילון overlay and the settings check).
const WORD_INFO_IDS = Object.freeze({
  main:     { panel: '#shinfo',          toggle: '#shinfo-toggle' },
  settings: { panel: '#settings-shinfo', toggle: '#settings-shinfo-toggle' },
});

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// HTML for the word-info panel; '' means hide it.
export function formatWordInfo({ status, info } = {}) {
  if (status === 'loading') return '<div class="shinfo-note">טוען מידע על המילה...</div>';
  if (status === 'missing') return '<div class="shinfo-note">אין מידע נוסף על המילה הזו.</div>';
  if (status === 'error') return '<div class="shinfo-note">לא ניתן לטעון את המידע כרגע.</div>';
  if (status !== 'ready' || !info) return '';
  const readings = (info.readings ?? []).map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  const more = info.more > 0
    ? `<div class="shinfo-more">ועוד ${info.more} ${info.more === 1 ? 'ניתוח נוסף' : 'ניתוחים נוספים'}</div>`
    : '';
  const source = info.sourceText ? `<div class="shinfo-src">${escapeHtml(info.sourceText)}</div>` : '';
  return `<div class="shinfo-word">${escapeHtml(info.word)}</div>`
    + (readings ? `<ul class="shinfo-readings">${readings}</ul>` : '')
    + more + source;
}

export function formatQueryResult({ word, valid, reason } = {}) {
  if (reason === 'empty') return { text: 'הקלד מילה', className: 'shres' };
  if (reason === 'loading') return { text: 'המילון עדיין נטען...', className: 'shres' };
  if (valid) return { text: `"${word}" — מילה חוקית ✓`, className: 'shres ok' };
  return { text: `"${word}" — לא נמצאה במילון ✕`, className: 'shres bad' };
}

export function mountDictionaryScreen({ root = globalThis.document, bus, getWordInfoEnabled = () => false } = {}) {
  if (!bus) throw new Error('mountDictionaryScreen: bus required');

  const queryOverlay = $('#ov-shailta', root);
  const cleanups = [];

  patchClick('button[onclick="openShailta()"]', root, () => bus.emit(DICT_INTENT.OPEN_QUERY, {}));
  patchClick('button[onclick="checkShailta()"]', queryOverlay ?? root, () => checkQuery('shin', 'shres', { clearAfterCheck: true }));
  patchClick('button[onclick="ovClose(\'ov-shailta\')"]', queryOverlay ?? root, () => {
    queryOverlay?.classList?.add('hidden');
    bus.emit(DICT_INTENT.CLOSE_QUERY, {});
  });
  patchClick('button[onclick="checkSettingsShailta()"]', root, () => checkQuery('settings-shin', 'settings-shres', { clearAfterCheck: true }));
  patchClick('button[onclick="suggestDictionaryWord()"]', root, () => submitSuggestions());
  patchClick('button[onclick="suggestDictionaryRemoval()"]', root, () => submitRemovalSuggestions());
  patchClick('button[onclick="userSuggestDictionaryWord()"]', root, () => submitUserSuggestion());
  patchClick('button[onclick="userSuggestDictionaryRemoval()"]', root, () => submitUserSuggestionRemoval());

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
      checkQuery('settings-shin', 'settings-shres', { clearAfterCheck: true });
    }
  }));

  // "Word origin" toggles (overlay + settings) share one preference.
  for (const ids of Object.values(WORD_INFO_IDS)) {
    const toggle = $(ids.toggle, root);
    if (!toggle) continue;
    cleanups.push(on(toggle, 'change', () => {
      const enabled = !!toggle.checked;
      syncWordInfoToggles(enabled);
      bus.emit(DICT_INTENT.TOGGLE_WORD_INFO, { enabled });
    }));
  }
  syncWordInfoToggles(readWordInfoEnabled());

  cleanups.push(bus.on(DICT_RENDER.WORD_INFO, ({ target = 'main', ...payload } = {}) => {
    const ids = WORD_INFO_IDS[target];
    const panel = ids ? $(ids.panel, root) : null;
    if (!panel) return;
    const html = formatWordInfo(payload);
    panel.innerHTML = html;
    if (html) panel.classList?.remove('hidden');
    else panel.classList?.add('hidden');
  }));

  cleanups.push(bus.on(DICT_INTENT.OPEN_QUERY, () => {
    const input = $('#shin', root);
    const result = $('#shres', root);
    if (input) input.value = '';
    if (result) { result.textContent = ''; result.className = 'shres'; }
    syncWordInfoToggles(readWordInfoEnabled());
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

  cleanups.push(bus.on(DICT_RENDER.REMOVAL_STATUS, ({ message = '', isError = false } = {}) => {
    const el = $('#dict-remove-status', root);
    setText(el, message);
    if (el?.style) el.style.color = isError ? '#ff9c9c' : '#9fd4f5';
  }));

  cleanups.push(bus.on(DICT_RENDER.USER_SUGGEST_STATUS, ({ message = '', isError = false } = {}) => {
    const el = $('#user-suggest-status', root);
    setText(el, message);
    if (el?.style) el.style.color = isError ? '#ff9c9c' : '#9fd4f5';
  }));

  cleanups.push(bus.on(DICT_RENDER.USER_SUGGEST_REMOVAL_STATUS, ({ message = '', isError = false } = {}) => {
    const el = $('#user-suggest-removal-status', root);
    setText(el, message);
    if (el?.style) el.style.color = isError ? '#ff9c9c' : '#9fd4f5';
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

  function submitRemovalSuggestions() {
    const input = $('#dict-remove-input', root);
    const words = parseSuggestedWords(input?.value);
    bus.emit(DICT_INTENT.SUBMIT_REMOVAL, { words });
  }

  function submitUserSuggestion() {
    const input = $('#user-suggest-input', root);
    const word = cleanDictionaryWord(input?.value);
    bus.emit(DICT_INTENT.USER_SUGGEST, { word });
  }

  function submitUserSuggestionRemoval() {
    const input = $('#user-suggest-removal-input', root);
    const word = cleanDictionaryWord(input?.value);
    bus.emit(DICT_INTENT.USER_SUGGEST_REMOVAL, { word });
  }

  function readWordInfoEnabled() {
    try { return !!getWordInfoEnabled(); } catch { return false; }
  }

  function syncWordInfoToggles(enabled) {
    for (const ids of Object.values(WORD_INFO_IDS)) {
      const toggle = $(ids.toggle, root);
      if (toggle) toggle.checked = !!enabled;
    }
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
