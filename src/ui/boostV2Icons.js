// boostV2Icons — one inline-SVG icon per Boost 2.0 challenge family.
//
// Each icon carries the challenge's parameter inside the drawing (the letter
// in the crosshair, the length in the bullseye, the score next to the bolt…),
// so a card or a board marker reads at a glance without text. Pure strings:
// no DOM access, safe to unit-test. Colours come from CSS (.v2-ic--<family>
// sets --ic-a, the family accent); tiles are always gold.

const TILE = '#f6c453';
const TILE_EDGE = '#b9831f';
const TILE_TX = '#3a2400';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// Font size (in the 24-unit viewBox) that fits `text` into a slot `w` wide.
function fit(text, w, max) {
  const n = [...String(text)].length || 1;
  return Math.min(max, (w / (n * 0.62))).toFixed(1);
}

function txt(text, x, y, size, fill = 'currentColor') {
  if (text === '' || text == null) return '';
  // The icon is drawn left-to-right (.v2-ic-svg sets direction:ltr), so
  // "6+" keeps its order inside the RTL page.
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="middle" dominant-baseline="central" font-weight="900" font-family="Heebo,Arial,sans-serif">${esc(text)}</text>`;
}

const tile = (x, y, w, h, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${(Math.min(w, h) * 0.22).toFixed(1)}" fill="${TILE}" stroke="${TILE_EDGE}" stroke-width=".8"${extra}/>`;

// The parameter shown inside the icon (shorter than parameterBadge: the
// drawing already says what kind of number it is).
export function iconParam(def) {
  const p = def?.parameters ?? {};
  switch (def?.family) {
    case 'LETTER_HUNT':    return p.targetLetter ?? '';
    case 'LONG_WORD':      return `${p.minimumLength}+`;
    case 'TILE_MASTER':    return `${p.minimumNewTiles}+`;
    case 'DOUBLE_LETTER':  return p.minRepeatedLetters >= 2 ? '×2' : '';
    case 'UNIQUE_LETTERS': return String(p.minimumLength ?? '');
    case 'WORD_EDGE':      return p.targetLetter ?? '';
    case 'POWER_WORD':     return `${p.minimumBaseScore}+`;
    case 'EXACT_TARGET':   return String(p.exactLength ?? '');
    default:               return '';
  }
}

const DRAW = {
  // Crosshair around the letter.
  LETTER_HUNT: (v) => '<g fill="none" stroke="var(--ic-a)" stroke-width="2" stroke-linecap="round">'
    + '<circle cx="12" cy="12" r="8"/><path d="M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5"/></g>'
    + tile(7, 7, 10, 10) + txt(v, 12, 12.4, fit(v, 9, 8), TILE_TX),
  // Four tiles in a row, the length, a double arrow.
  LONG_WORD: (v) => [1.5, 7.2, 12.9, 18.6].map(x => tile(x, 2.5, 4.4, 4.8)).join('')
    + txt(v, 12, 13, fit(v, 16, 9), 'var(--ic-t)')
    + '<path d="M3 20.5h18M6 17.8l-3 2.7 3 2.7M18 17.8l3 2.7-3 2.7" fill="none" stroke="var(--ic-a)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  // A stack of tiles; the count on the front one.
  TILE_MASTER: (v) => tile(1.5, 6.5, 11, 14, ' opacity=".55"') + tile(5, 4.5, 11, 14.5, ' opacity=".8"')
    + tile(9, 3, 13.5, 17) + txt(v, 15.75, 11.8, fit(v, 12, 9), TILE_TX),
  // Two identical tiles with a spark.
  DOUBLE_LETTER: (v) => tile(1.5, 9, 9.8, 11.5) + tile(12.7, 9, 9.8, 11.5)
    + txt('א', 6.4, 14.9, 8, TILE_TX) + txt('א', 17.6, 14.9, 8, TILE_TX)
    + '<path d="M12 2v4M6.5 3.2l1.4 3M17.5 3.2l-1.4 3" fill="none" stroke="var(--ic-a)" stroke-width="1.8" stroke-linecap="round"/>'
    + (v ? `<circle cx="20" cy="20" r="4" fill="var(--ic-a)"/>${txt(v, 20, 20.2, fit(v, 6.4, 4.6), '#fff')}` : ''),
  // Three different letters and a check-badge with the length.
  UNIQUE_LETTERS: (v) => tile(1, 3.5, 7, 8, ' transform="rotate(-8 4.5 7.5)"') + tile(8.5, 2.5, 7, 8) + tile(16, 3.5, 7, 8, ' transform="rotate(8 19.5 7.5)"')
    + txt('א', 4.5, 7.7, 5, TILE_TX) + txt('ב', 12, 6.7, 5, TILE_TX) + txt('ג', 19.5, 7.7, 5, TILE_TX)
    + `<circle cx="12" cy="17.5" r="5.6" fill="var(--ic-a)"/>${txt(v, 12, 17.7, fit(v, 8, 7), '#fff')}`,
  // The letter tile at the start (right, RTL) or the end (left) of the word;
  // the arrow follows the reading direction.
  WORD_EDGE: (v, def) => {
    const start = def?.parameters?.position === 'START';
    const tx = start ? 12.5 : 1.5;
    const arrow = start
      ? '<path d="M11 12H2.5M5.5 9l-3 3 3 3" />'
      : '<path d="M22 12h-8M17 9l-3 3 3 3" />';
    return `<g fill="none" stroke="var(--ic-a)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${arrow}</g>`
      + tile(tx, 6.5, 10, 11) + txt(v, tx + 5, 12.3, fit(v, 9, 8), TILE_TX);
  },
  // An arch joining two Boost squares.
  BRIDGE_BUILDER: () => '<path d="M4.5 16.5A7.5 7.5 0 0 1 19.5 16.5" fill="none" stroke="' + TILE + '" stroke-width="3.2" stroke-linecap="round"/>'
    + '<path d="M4.5 16.5A7.5 7.5 0 0 1 19.5 16.5" fill="none" stroke="' + TILE_EDGE + '" stroke-width=".6" stroke-dasharray="1.6 2.2"/>'
    + '<rect x="1" y="15" width="7" height="7" rx="1.6" fill="var(--ic-a)"/><rect x="16" y="15" width="7" height="7" rx="1.6" fill="var(--ic-a)"/>'
    + '<path d="M4.5 16.6l.8 1.6 1.7.2-1.3 1.2.4 1.7-1.6-.9-1.6.9.4-1.7-1.3-1.2 1.7-.2zM19.5 16.6l.8 1.6 1.7.2-1.3 1.2.4 1.7-1.6-.9-1.6.9.4-1.7-1.3-1.2 1.7-.2z" fill="' + TILE + '"/>',
  // A lightning bolt and the score to reach.
  POWER_WORD: (v) => '<path d="M11.5 1.5L3 13.2h5.6L6.2 22.5 15.5 9.6H9.8z" fill="#ffd23f" stroke="#e08a00" stroke-width=".8" stroke-linejoin="round"/>'
    + txt(v, 17.4, 17.6, fit(v, 10.5, 8), 'var(--ic-t)'),
  // A bullseye with the exact length in the middle.
  EXACT_TARGET: (v) => '<circle cx="12" cy="12" r="10.5" fill="var(--ic-a)"/><circle cx="12" cy="12" r="7.6" fill="#fff"/>'
    + '<circle cx="12" cy="12" r="5.4" fill="var(--ic-a)"/><circle cx="12" cy="12" r="3.9" fill="#fff"/>'
    + txt(v, 12, 12.3, fit(v, 6.5, 6.6), '#1b1b1b'),
};

export function hasFamilyIcon(family) {
  return Object.prototype.hasOwnProperty.call(DRAW, family);
}

// Inline <svg> for a challenge definition (empty string for unknown families).
export function familyIconSVG(def) {
  const draw = DRAW[def?.family];
  if (!draw) return '';
  return `<svg class="v2-ic-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${draw(iconParam(def), def)}</svg>`;
}

// Wrapped icon element: `<span class="v2-ic v2-ic--letter_hunt">…</span>`.
export function familyIconHTML(def, extraClass = '') {
  const svg = familyIconSVG(def);
  if (!svg) return '';
  return `<span class="v2-ic v2-ic--${def.family.toLowerCase()}${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true">${svg}</span>`;
}
