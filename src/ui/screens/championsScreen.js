import { $, on } from '../domHelpers.js';

export const CHAMPS_INTENT = Object.freeze({
  OPEN: 'champions/open',
  CLOSE: 'champions/close',
});

export const CHAMPS_OPEN = 'champions/render/open';
export const CHAMPS_RENDER = 'champions/render';
export const CHAMPS_ERROR = 'champions/error';

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

export function buildChampionsHtml(entries = []) {
  if (!entries.length) return '<div class="champs-empty">עדיין אין שחקנים מדורגים</div>';
  return '<table class="champs-table"><thead><tr><th>#</th><th>שם</th><th>דירוג</th></tr></thead><tbody>'
    + entries.map((entry, i) =>
      `<tr data-champ-uid="${escapeHtml(entry.uid)}"><td>${i + 1}</td><td>${escapeHtml(entry.name)}</td><td>${Number(entry.rating) || 0}</td></tr>`,
    ).join('')
    + '</tbody></table>';
}

export function mountChampionsScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountChampionsScreen: bus required');

  const overlay = $('#ov-champs', root);
  const homeWrap = $('#champions-wrap-home', root);
  const endWrap = $('#champions-wrap', root);
  const cleanups = [];

  const closeBtn = $('button[onclick="ovClose(\'ov-champs\')"]', overlay ?? root);
  if (closeBtn) {
    closeBtn.removeAttribute?.('onclick');
    cleanups.push(on(closeBtn, 'click', (e) => {
      e.preventDefault?.();
      overlay?.classList?.add('hidden');
      bus.emit(CHAMPS_INTENT.CLOSE, {});
    }));
  }

  cleanups.push(bus.on(CHAMPS_OPEN, () => {
    paintLoading(homeWrap);
    overlay?.classList?.remove('hidden');
    bus.emit(CHAMPS_INTENT.OPEN, {});
  }));

  cleanups.push(bus.on(CHAMPS_RENDER, ({ entries = [], target = 'all' } = {}) => {
    const html = buildChampionsHtml(entries);
    if (target === 'home' || target === 'all') paint(homeWrap, html);
    if (target === 'end' || target === 'all') paint(endWrap, html);
  }));

  cleanups.push(bus.on(CHAMPS_ERROR, ({ target = 'all' } = {}) => {
    const html = '<div class="champs-empty">לא ניתן לטעון דירוגים כרגע</div>';
    if (target === 'home' || target === 'all') paint(homeWrap, html);
    if (target === 'end' || target === 'all') paint(endWrap, html);
  }));

  function paintLoading(el) {
    paint(el, '<div class="champs-empty">טוען דירוגים...</div>');
  }

  function paint(el, html) {
    if (el) el.innerHTML = html;
  }

  function unmount() {
    for (const off of cleanups.splice(0)) {
      try { off(); } catch {}
    }
  }

  return { unmount };
}
