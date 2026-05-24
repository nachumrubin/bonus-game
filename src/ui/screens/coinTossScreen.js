// coinTossScreen — wraps the #scoin "first turn" splash.
//
// Flow:
//   1. main.js calls coin.show({ startingSlot, p1Name, p2Name }) right after
//      a session is created but before mountGameScreen.
//   2. The screen briefly animates the coin (legacy CSS keyframe coinFlip),
//      then enables the "enter game" button.
//   3. Click → emits ENTER intent → main.js shows the game screen and
//      starts the session.
//
// For matchmaking and friend live-mode, this could be skipped (we just flip
// status to 'playing' immediately). Spine plan §1.4 keeps coin toss as an
// option; main.js decides per-mode whether to show it.

import { $, on, setText } from '../domHelpers.js';

export const COIN_INTENT = Object.freeze({
  ENTER: 'coin/enter',
});

export const COIN_OPEN = 'overlay/coin/open';
export const COIN_WAITING = 'overlay/coin/waiting';

export function mountCoinTossScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountCoinTossScreen: bus required');
  const screen = $('#scoin', root);
  if (!screen) {
    console.warn('[coinTossScreen] #scoin not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];

  const enterBtn = $('button[onclick="enterGameAfterCoinToss()"]', screen);
  const coinDisc = $('#coin-disc', screen);
  const coinSub  = $('#coin-sub', screen);
  const coinMsg  = $('#coin-msg', screen);

  if (enterBtn) {
    enterBtn.removeAttribute('onclick');
    cleanups.push(on(enterBtn, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(COIN_INTENT.ENTER);
    }));
  }

  cleanups.push(bus.on(COIN_OPEN, ({ startingSlot, p1Name, p2Name } = {}) => {
    show({ startingSlot, p1Name, p2Name });
  }));
  cleanups.push(bus.on(COIN_WAITING, () => {
    setText(coinMsg, 'ממתינים לשחקן השני...');
    if (enterBtn) enterBtn.disabled = true;
  }));

  function show({ startingSlot, p1Name = 'שחקן 1', p2Name = 'שחקן 2' } = {}) {
    setText(coinSub, 'מטילים מטבע...');
    setText(coinMsg, 'בהצלחה!');
    if (enterBtn) enterBtn.disabled = true;

    const startingName = startingSlot === 0 ? p1Name : p2Name;
    if (coinDisc) {
      // Reset to the neutral face during the flip; the name lands after the
      // animation completes so the player sees the reveal.
      setText(coinDisc, '🪙');
      coinDisc.classList?.remove('flipping');
      void coinDisc.offsetWidth;
      coinDisc.classList?.add('flipping');
    }

    setTimeout(() => {
      setText(coinSub, `${startingName} פותח/ת!`);
      if (coinDisc) setText(coinDisc, startingName);
      if (enterBtn) enterBtn.disabled = false;
    }, 1700); // matches coinFlip keyframe length (1.6s)
  }

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
