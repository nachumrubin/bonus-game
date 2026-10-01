// bonusIntroScreen — wires #ov-bonus-intro.
//
// Shown after a tile lands on a bonus square that requires a mini-game
// or wheel. Displays a one-line "you triggered X — N points" and a "let's
// play" button. The actual mini-game UI mounts when the user clicks
// through.
//
// Driven by BI_OPEN with { bonusType, miniGameKey, tilePts, kind }.
// Emits BI_INTENT.START on the play button.

import { $, on, setText } from '../domHelpers.js';
import { BONUS_TILE_DEFS } from '../../game/boosts/bonusTileDefs.js';
import { g, getGender } from '../genderText.js';
import { BOOST_BOLT_ICON_HTML } from '../boostIcon.js';

export const BI_INTENT = Object.freeze({
  START: 'bonusIntro/start',
});

export const BI_OPEN  = 'bonusIntro/open';
export const BI_CLOSE = 'bonusIntro/close';

// Per-bonus copy for the intro overlay. Keyed by bonus type (B1..B14).
// Titles are plain text — the icon lives in the medal above (#bintro-ic), so a
// leading ⚡ in the title just duplicated it.
const TITLE_BY_TYPE = {
  B1:  'אנגרמה!',
  B3:  'אנגרמה!',
  B8:  'תשבץ!',
  B10: 'מילים מצטלבות!',
  B11: 'מילה נסתרת!',
  B12: 'כוורת!',
  B13: 'גלגל המזל!',
  B14: 'אות פותחת!',
};

// Medal icon HTML per bonus type. Default: the glowing bolt glyph; the wheel
// keeps its 🎡 (legacy B13 icon, HEAD:index.html:6202).
const ICON_HTML_BY_TYPE = {
  B13: '<span class="ovic-emoji" aria-hidden="true">🎡</span>',
};

function descByType(bonusType) {
  const key = {
    B1:  'descB1',
    B3:  'descB3',
    B8:  'descB8',
    B10: 'descB10',
    B11: 'descB11',
    B12: 'descB12',
    B13: 'descB13',
    B14: 'descB14',
  }[bonusType];
  return key ? g(key, getGender()) : 'משחקון בוסט';
}

export function describeBonus(bonusType) {
  const def = BONUS_TILE_DEFS[bonusType];
  return {
    title:    TITLE_BY_TYPE[bonusType] ?? 'בוסט!',
    desc:     descByType(bonusType),
    iconHtml: ICON_HTML_BY_TYPE[bonusType] ?? BOOST_BOLT_ICON_HTML,
    // Plain-text icon for places that can't take HTML (the online liveBonus
    // doc the opponent's spectator overlay reads).
    icon:     bonusType === 'B13' ? '🎡' : '⚡',
    pts:      def?.tilePts ?? 0,
  };
}

export function mountBonusIntroScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountBonusIntroScreen: bus required');

  const overlay = $('#ov-bonus-intro', root);
  const ic      = $('#bintro-ic',      root);
  const titleEl = $('#bintro-title',   root);
  const descEl  = $('#bintro-desc',    root);
  const ptsEl   = $('#bintro-pts',     root);
  const startBtn = $('button[onclick="startBonusGame()"]', root);

  const cleanups = [];
  let pendingPayload = null;

  if (startBtn) {
    // Strip the inline `onclick="startBonusGame()"` so the (undefined)
    // legacy global doesn't fire on top of our spine listener.
    startBtn.removeAttribute?.('onclick');
    cleanups.push(on(startBtn, 'click', (e) => {
      e?.preventDefault?.();
      bus.emit(BI_INTENT.START, pendingPayload ?? {});
      overlay?.classList?.add?.('hidden');
    }));
  }

  cleanups.push(bus.on(BI_OPEN, (payload = {}) => {
    pendingPayload = payload;
    const info = describeBonus(payload.bonusType);
    if (titleEl) setText(titleEl, info.title);
    if (descEl)  setText(descEl,  info.desc);
    // Points sit in their own gold pill (the B1/B3 copy already says "100
    // נקודות", so appending them to the description repeated the number).
    if (ptsEl) {
      ptsEl.innerHTML = info.pts ? `<svg class="gi f" aria-hidden="true"><use href="#gi-star"/></svg>${info.pts} נקודות` : '';
      ptsEl.hidden = !info.pts || info.desc.includes(String(info.pts));
    }
    if (ic) ic.innerHTML = info.iconHtml;
    overlay?.classList?.remove?.('hidden');
  }));

  cleanups.push(bus.on(BI_CLOSE, () => {
    pendingPayload = null;
    overlay?.classList?.add?.('hidden');
  }));

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
      pendingPayload = null;
    },
    _peekPayload: () => pendingPayload,
  };
}
