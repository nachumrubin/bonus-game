// boostVetoScreen — wires #ov-boost-veto.
//
// Shown when an opponent's `cancel_next_opponent_bonus` boost suppresses
// the bonus the player just earned. The spine emits `suppressBonus`
// internally; this overlay renders the user-facing notice.
//
// Driven by BV_OPEN with { boostId, opponentName }.

import { $, on, setText } from '../domHelpers.js';

export const BV_INTENT = Object.freeze({
  CLOSE: 'boostVeto/close',
});

export const BV_OPEN  = 'boostVeto/open';
export const BV_CLOSE = 'boostVeto/close';

function describe(payload = {}) {
  const opponent = payload.opponentName ?? 'היריב';
  if (payload.boostId === 'auto_extra_score') return `${opponent} ביטל את הבונוס שלך`;
  if (payload.boostId)                        return `${opponent} ביטל את ${payload.boostId}`;
  return `${opponent} ביטל את הבוסט שלך`;
}

export function mountBoostVetoScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountBoostVetoScreen: bus required');

  const overlay = $('#ov-boost-veto', root);
  const titleEl = $('#boost-veto-title', root);
  const descEl  = $('#boost-veto-desc',  root);
  const closeBtn = $('button[onclick="ovClose(\'ov-boost-veto\')"]', root);

  const cleanups = [];
  if (closeBtn) {
    cleanups.push(on(closeBtn, 'click', () => bus.emit(BV_INTENT.CLOSE, {})));
  }

  cleanups.push(bus.on(BV_OPEN, (payload = {}) => {
    if (titleEl) setText(titleEl, payload.title ?? 'הבוסט בוטל');
    if (descEl)  setText(descEl,  describe(payload));
    overlay?.classList?.remove?.('hidden');
  }));
  cleanups.push(bus.on(BV_CLOSE, () => overlay?.classList?.add?.('hidden')));
  cleanups.push(bus.on(BV_INTENT.CLOSE, () => overlay?.classList?.add?.('hidden')));

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}

// Re-exported for tests
export { describe as describeVeto };
