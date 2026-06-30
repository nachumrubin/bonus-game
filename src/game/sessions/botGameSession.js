// Attaches a bot player to a local session.
//
// Subscribes to TURN_CHANGED on the bus. When the current turn lands on the
// bot's slot, runs searchBotMove() and dispatches the resulting CONFIRM_MOVE
// (or PASS_TURN if no move is found).
//
// The bot's "thinking" delay is configurable. In tests we pass 0; in
// production we pass ~1500ms so the move feels natural.
//
// `wordList` and `isWordValid` are injected so the search stays pure and
// deterministic in tests. Production wires them from hebrewDictionary.

import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { searchBotMove, DIFFICULTY } from './botSearch.js';

/**
 * Attach an automated player to an existing local session.
 * @param {import('./localGameSession.js').LocalGameSession} session
 * @param {{
 *   slot: 0 | 1,
 *   wordList?: string[],
 *   getWordList?: () => string[],
 *   isWordValid(word: string): boolean,
 *   difficulty?: number,
 *   thinkingMs?: number,
 *   rng?: () => number,
 *   scheduler?: (fn: Function, delay: number) => any
 * }} options
 * @returns {{ detach(): void }}
 */
export function attachBotPlayer(session, {
  slot,
  wordList = null,
  getWordList = null,
  isWordValid,
  difficulty = DIFFICULTY.MEDIUM,
  thinkingMs = 0,
  rng = Math.random,
  scheduler = setTimeout,
  cancelScheduler = (typeof clearTimeout !== 'undefined' ? clearTimeout : null),
}) {
  if (!session) throw new Error('attachBotPlayer: session is required');
  if (slot !== 0 && slot !== 1) throw new Error('attachBotPlayer: slot must be 0 or 1');
  if (!Array.isArray(wordList) && typeof getWordList !== 'function') throw new Error('attachBotPlayer: wordList must be an array');
  if (typeof isWordValid !== 'function') throw new Error('attachBotPlayer: isWordValid must be a function');

  const { bus, engine, state } = session;

  // The bot pauses while the human is mid-bonus (mini-game open, wheel
  // spinning, +N overlay still showing). It resumes when the bonus flow
  // emits its corresponding acknowledgement.
  //   - Mini-game / wheel: bonus/pending → wait → bonus/resolved
  //   - Auto bonus overlay: boost/activated → wait → bonus/award-acknowledged
  let bonusPauseCount = 0;
  let pendingActFor = null;        // slot to act on once the pause lifts
  let pendingThinkHandle = null;   // outstanding scheduler() handle (so detach can cancel)
  let detached = false;

  function cancelPendingThink() {
    if (pendingThinkHandle != null) {
      try { cancelScheduler?.(pendingThinkHandle); } catch { /* swallow */ }
      pendingThinkHandle = null;
    }
  }

  function tryAct(currentSlot) {
    if (detached) return;
    if (currentSlot !== slot) return;
    if (state.status !== 'playing') return;
    if (bonusPauseCount > 0) {
      pendingActFor = slot;
      return;
    }
    pendingActFor = null;
    cancelPendingThink();
    pendingThinkHandle = scheduler(() => {
      pendingThinkHandle = null;
      if (detached) return;
      if (state.currentTurnSlot !== slot || state.status !== 'playing') return;
      if (bonusPauseCount > 0) { pendingActFor = slot; return; }
      const activeWordList = typeof getWordList === 'function' ? getWordList() : wordList;
      const result = searchBotMove(state, slot, Array.isArray(activeWordList) ? activeWordList : [], isWordValid, { difficulty, rng });
      if (result) {
        engine.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: result.placed } });
      } else {
        engine.dispatch({ type: CMD.PASS_TURN });
      }
    }, thinkingMs);
  }

  function pause() { bonusPauseCount += 1; }
  function resume() {
    bonusPauseCount = Math.max(0, bonusPauseCount - 1);
    if (bonusPauseCount === 0 && pendingActFor != null) {
      tryAct(pendingActFor);
    }
  }

  const offTurn = bus.on(EV.TURN_CHANGED, ({ currentTurnSlot }) => tryAct(currentTurnSlot));
  const offGameStarted = bus.on(EV.GAME_STARTED, ({ currentTurnSlot }) => tryAct(currentTurnSlot));
  // Bonus pause/resume — use string event names to avoid a circular import
  // between sessions/ and ui/controllers/. The event names match those
  // emitted by bonusActivationController and gameScreen.
  const offBonusPending  = bus.on('bonus/pending',                pause);
  const offBonusResolved = bus.on('bonus/resolved',               resume);
  // Menu pause/resume — same effect as the bonus pair: hold any pending
  // bot move while the human is in the "המשחק מושהה" overlay.
  const offGamePaused    = bus.on('game/paused',                  pause);
  const offGameResumed   = bus.on('game/resumed',                 resume);
  const offBoostActivated = bus.on(EV.BOOST_ACTIVATED, (payload) => {
    // Every fresh bonus-square activation pops the modal award overlay;
    // pause the bot until the player clicks אישור. `consumed: true` events
    // (e.g. spending a free_tile_swap) reuse the same event but don't open
    // the overlay, so we ignore them. `pending: true` is the turn-start
    // reminder for a still-queued future-effect boost (free_tile_swap
    // waking up on the booster's next turn) — no modal opens for those
    // either, so we don't need to pause.
    if (payload?.consumed || payload?.pending) return;
    pause();
  });
  const offBoostAck = bus.on('bonus/award-acknowledged', resume);

  function detach() {
    detached = true;
    cancelPendingThink();
    offTurn(); offGameStarted();
    offBonusPending(); offBonusResolved();
    offGamePaused(); offGameResumed();
    offBoostActivated(); offBoostAck();
  }
  // Push the full detach (not just the bus unsubscribes) so session.dispose()
  // cancels the pending think-timeout. Without this a player leaving the
  // game mid-think would see the bot move/pass fire after teardown.
  session._subs.push(detach);

  return { detach };
}
