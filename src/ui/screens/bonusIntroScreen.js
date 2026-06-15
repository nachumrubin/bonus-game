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

export const BI_INTENT = Object.freeze({
  START: 'bonusIntro/start',
});

export const BI_OPEN  = 'bonusIntro/open';
export const BI_CLOSE = 'bonusIntro/close';

// Per-bonus copy for the intro overlay. Keyed by bonus type (B1..B13).
const TITLE_BY_TYPE = {
  B1:  '⚡ אנגרמה!',
  B3:  '⚡ אנגרמה!',
  B8:  '⚡ תשבץ!',
  B10: '⚡ מילים מצטלבות!',
  B11: '⚡ מילה נסתרת!',
  B12: '⚡ כוורת!',
  B13: '🎡 גלגל המזל!',
  B14: '⚡ אות פותחת!',
};

// Legacy used the `🎡` Ferris-wheel emoji as the bonus-intro icon for
// B13 (see HEAD:index.html:6202). We don't override the `#bintro-ic`
// element via HTML for B13 — the existing emoji-extraction path in the
// BI_OPEN handler picks up `🎡` from `info.title.split(' ')[0]`.
const ICON_HTML_BY_TYPE = {};

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
    title:    TITLE_BY_TYPE[bonusType] ?? '⚡ בוסט!',
    desc:     descByType(bonusType),
    iconHtml: ICON_HTML_BY_TYPE[bonusType] ?? null,
    pts:      def?.tilePts ?? 0,
  };
}

export function mountBonusIntroScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountBonusIntroScreen: bus required');

  const overlay = $('#ov-bonus-intro', root);
  const ic      = $('#bintro-ic',      root);
  const titleEl = $('#bintro-title',   root);
  const descEl  = $('#bintro-desc',    root);
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
    if (descEl)  setText(descEl,  info.desc + (info.pts ? ` (${info.pts} נקודות)` : ''));
    if (ic) {
      if (info.iconHtml != null) {
        // Allow rich-HTML icons (e.g. for future bonus types that need
        // more than a plain emoji).
        ic.innerHTML = info.iconHtml;
      } else if ((info.title.match(/[🎰⚡🎡]/) || []).length) {
        setText(ic, info.title.split(' ')[0]);
      }
    }
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
