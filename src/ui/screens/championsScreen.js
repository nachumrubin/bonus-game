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

const MEDALS = [
  '<img src="assets/rewards/gold medal.png" alt="מקום ראשון" class="champ-medal-icon">',
  '<img src="assets/rewards/silver medal.png" alt="מקום שני" class="champ-medal-icon">',
  '<img src="assets/rewards/bronze medal.png" alt="מקום שלישי" class="champ-medal-icon">',
];

export function buildChampionsHtml(entries = [], { myUid = null, myPosition = null, myEntry = null } = {}) {
  if (!entries.length && !myEntry) return '<div class="champs-empty">עדיין אין שחקנים מדורגים</div>';

  const rows = entries.map((entry, i) => {
    const pos = i + 1;
    const isMe = myUid != null && entry.uid === myUid;
    // Show the position number for the current user so they can identify their rank;
    // show medal icons for everyone else in the top 3.
    const rankCell = MEDALS[i] ?? pos;
    return `<tr data-champ-uid="${escapeHtml(entry.uid)}"${isMe ? ' class="champ-me"' : ''}>`
      + `<td>${rankCell}</td>`
      + `<td>${escapeHtml(entry.name)}</td>`
      + `<td>${Number(entry.rating) || 0}</td>`
      + `</tr>`;
  }).join('');

  // Append separator + user row when they are outside the displayed top-N.
  let outsideRow = '';
  if (myEntry && myPosition != null) {
    outsideRow = `<tr class="champ-outside-sep"><td colspan="3"></td></tr>`
      + `<tr data-champ-uid="${escapeHtml(myEntry.uid)}" class="champ-me champ-me--outside">`
      + `<td>${myPosition}</td>`
      + `<td>${escapeHtml(myEntry.name)}</td>`
      + `<td>${Number(myEntry.rating) || 0}</td>`
      + `</tr>`;
  }

  return '<table class="champs-table"><thead><tr><th>#</th><th>שם</th><th>דירוג</th></tr></thead><tbody>'
    + rows + outsideRow
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

  cleanups.push(bus.on(CHAMPS_RENDER, ({ entries = [], myUid = null, myPosition = null, myEntry = null, target = 'all' } = {}) => {
    const html = buildChampionsHtml(entries, { myUid, myPosition, myEntry });
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
