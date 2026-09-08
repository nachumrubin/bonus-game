// animationController — pure visual; subscribes to engine events and
// triggers animation keys. The 27 CSS keyframes in [index.html](index.html)
// remain unchanged at cutover; this controller just *triggers* them.
//
// Hard rule (matches the legacy hard rule preserved in the plan):
// animations are visual only. They never gate state.
//
// Skipping animations is a per-client choice. setEnabled(false) makes every
// trigger a no-op — opponent's view is unaffected because they receive
// state via Firebase, not animations.
//
// The actual DOM-touching renderer is injected via setRenderer({...}).
// This keeps the controller pure and testable.

import { EV } from '../../events/eventTypes.js';
import { RACK_SIZE } from '../../game/core/tileBag.js';
import { bonusOverlayOpen } from '../domHelpers.js';
import { mergeSequenceTiming } from '../scoreAnimationTimings.js';
import { BOOST_RESULT_READY, BOOST_RESULT_REVEAL_DELAY_MS } from '../boostPresentation.js';

// Presentation-only delay. The engine has already resolved the Boost; this
// only leaves the board unobscured long enough for its cause to register.
export { BOOST_RESULT_REVEAL_DELAY_MS } from '../boostPresentation.js';

export function createAnimationController({ bus, mySlot = null, showOpponentBoostOverlay = false, reducedMotion = () => false }) {
  if (!bus) throw new Error('createAnimationController: bus required');

  let enabled = true;
  let renderer = null;
  const presentationTimers = new Map();
  const presentedBoosts = new Map();

  function setEnabled(on) { enabled = !!on; }
  function setRenderer(r) { renderer = r; }

  // Directives whose INFORMATION the player must still receive under reduced
  // motion, even though the full choreography is disabled — an accepted move
  // and a rejected move. The renderer paints these as a STATIC emphasis (no
  // travel). Everything else stays a no-op while disabled. Sound/haptic are
  // unaffected (they aren't motion). BOOST_MOTION_SPEC §15.
  //   - acceptedWordSweep → a brief static brightness lift on the word.
  //   - illegalPulse → the static red that identifies the illegal placement
  //     (the shake is skipped; illegalPulse already carries the "rejected" info).
  const REDUCED_MOTION_INFO = new Set(['acceptedWordSweep', 'illegalPulse', 'yourTurnCue', 'bonusActivate']);
  const REQUIRED_PRESENTATION = new Set(['bonusAwardOverlay']);

  // Translate an engine event payload into an animation directive that the
  // renderer can act on. Keeping the directives data-only means tests can
  // assert on them without a DOM.
  const directives = []; // append-only log of triggered animations (for tests)
  function callRenderer(kind, payload) {
    try {
      const fn = renderer[kind];
      if (fn) fn(payload);
    } catch (e) {
      console.warn('[anim]', kind, e);
    }
  }
  function trigger(directive) {
    directives.push(directive);
    if (!renderer) return;
    if (!enabled) {
      // Choreography off. Under reduced motion, still forward the small set of
      // information-critical directives so the player gets a static accept/reject
      // cue; the renderer branches on its own reduced-motion flag.
      if (REQUIRED_PRESENTATION.has(directive.kind)) {
        callRenderer(directive.kind, { ...directive.payload, reducedMotion: reducedMotion() });
      } else if (reducedMotion() && REDUCED_MOTION_INFO.has(directive.kind)) {
        callRenderer(directive.kind, { ...directive.payload, reducedMotion: true });
      }
      return;
    }
    callRenderer(directive.kind, directive.payload);
  }

  function presentBoost(payload, showResult, countsAsOverlay = false) {
    const bonusIdx = payload.bonusIdx ?? payload.idx;
    const key = Number.isInteger(bonusIdx) ? `${payload.slot}:${bonusIdx}` : null;
    if (key && presentedBoosts.has(key)) return false;
    if (key) presentedBoosts.set(key, payload.slot);
    if (countsAsOverlay) overlayCount += 1;
    trigger({ kind: 'bonusActivate', payload: { ...payload, bonusIdx } });
    const reveal = () => {
      bus.emit(BOOST_RESULT_READY, { ...payload, bonusIdx });
      showResult?.();
    };
    if (!enabled || reducedMotion() || key == null) { reveal(); return true; }
    const handle = setTimeout(() => {
      presentationTimers.delete(handle);
      // Required UI survives a preference change during the ignition beat.
      reveal();
    }, BOOST_RESULT_REVEAL_DELAY_MS);
    presentationTimers.set(handle, { slot: payload.slot, countsAsOverlay });
    return true;
  }

  function cancelBoostPresentation({ slot } = {}) {
    for (const [handle, entry] of presentationTimers) {
      if (slot != null && entry.slot !== slot) continue;
      clearTimeout(handle);
      presentationTimers.delete(handle);
      if (entry.countsAsOverlay) overlayCount = Math.max(0, overlayCount - 1);
    }
    for (const [key, owner] of presentedBoosts) {
      if (slot == null || owner === slot) presentedBoosts.delete(key);
    }
  }

  const subs = [];

  // Score-merge sequence constants come from src/ui/scoreAnimationTimings.js
  // (single source of truth, shared with gameScreen.renderScores). Each
  // word's +N chip flies to a central sum chip; once all words + bonus
  // extra have merged, the sum holds briefly then flies into the score box.

  // Delegates to the shared mergeSequenceTiming (single source of truth).
  function scoreMergeTiming({ wordCount, bonusExtra, multiplier }) {
    return mergeSequenceTiming({ wordCount, bonusExtra, multiplier });
  }

  function emitScoreSequence({ slot, placed, wordTiles, score, baseScore, bonusExtra, multiplier }) {
    const validWords = Array.isArray(wordTiles)
      ? wordTiles.filter(wt => Array.isArray(wt) && wt.length > 0)
      : [];
    const wordsForRender = validWords.map(wt => ({
      wordTiles: wt,
      wordScore: wt.reduce((a, t) => a + (Number(t?.val) || 0), 0),
    })).filter(w => w.wordScore > 0);
    const total = Number(score) || 0;
    const base  = baseScore != null ? Number(baseScore) : total;
    const extra = Number(bonusExtra) || 0;
    const mult  = Number(multiplier) || 1;

    // Single merge directive — gameScreen orchestrates the per-word chip
    // flights, the running-sum count-up, the ×N multiplier chip, the boost
    // extra merge, and the final flight to the score panel as one sequence.
    trigger({
      kind: 'scoreMergeSequence',
      payload: { slot, placed, words: wordsForRender, finalScore: total, baseScore: base, bonusExtra: extra, multiplier: mult },
    });

  }

  function emitMoveAnimations({ slot, placed, words, wordTiles, score, baseScore, bonusExtra, multiplier, opponent = false, scoringDeferred = false }) {
    // Local tiles already played their tentative-placement settle in gameScreen
    // when the player put them down (Phase 3A) — re-popping them on confirm would
    // double-animate. Confirmation is instead communicated by acceptedWordSweep + the
    // score sequence below. Opponent tiles were NOT previously visible as local
    // tentative tiles, so they still get an arrival pop (BOOST_MOTION_SPEC §6/§13).
    if (opponent) trigger({ kind: 'tilePlaceIn', payload: { slot, placed, opponent } });
    if (!opponent) trigger({ kind: 'acceptedWordSweep', payload: { slot, words, wordTiles, placed } });
    if ((placed?.length ?? 0) >= RACK_SIZE) {
      trigger({ kind: 'bingoLabel', payload: { slot, placed, wordTiles } });
    }
    // (A multi-word move used to emit a `multiplierLabel` directive that
    // rendered a misleading bare "×" — it meant "more than one word", not a
    // score multiplier, and the real ×N multiplier already has its own chip in
    // the score-merge sequence. Removed per BOOST_MOTION_SPEC §1.5; the multiple
    // word chips flying to the sum already communicate the multi-word move.)
    // The booster's rack just got refilled from the bag — cascade the new
    // tiles in. Opponent moves don't touch the local rack so skip there.
    if (!opponent && (placed?.length ?? 0) > 0) {
      trigger({ kind: 'tileCascadeIn', payload: { slot, count: placed.length } });
    }
    if (scoringDeferred) return;
    emitScoreSequence({ slot, placed, wordTiles, score, baseScore, bonusExtra, multiplier });
  }

  function emitScoreCommitAnimations(payload) {
    emitScoreSequence(payload);
  }

  // Overlay-gated emission: animation sequence holds while any bonus
  // overlay is open (mini-game intro, mini-game UI, bonus award modal, or
  // legacy `#ov-bonus` results screen). Once everything closes, the held
  // payload fires so the player sees the chip, glow, count-up and panel
  // glow swap as a single coherent burst.
  let overlayCount = 0;
  let pendingCommitPayload = null;
  let pollHandle = null;

  function isOverlayActive() {
    return overlayCount > 0 || bonusOverlayOpen(globalThis.document);
  }
  function flushScoreCommit() {
    if (!pendingCommitPayload || isOverlayActive()) return;
    const p = pendingCommitPayload;
    pendingCommitPayload = null;
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
    emitScoreCommitAnimations(p);
  }
  function schedulePoll() {
    if (pollHandle) return;
    pollHandle = setInterval(() => {
      if (!pendingCommitPayload) {
        clearInterval(pollHandle); pollHandle = null; return;
      }
      if (!isOverlayActive()) flushScoreCommit();
    }, 100);
  }

  subs.push(bus.on('bonus/resolved', () => { overlayCount = Math.max(0, overlayCount - 1); flushScoreCommit(); }));
  subs.push(bus.on('bonus/award-acknowledged', () => { overlayCount = Math.max(0, overlayCount - 1); flushScoreCommit(); }));

  subs.push(bus.on(EV.MOVE_CONFIRMED, (payload) => emitMoveAnimations({ ...payload, opponent: false })));
  subs.push(bus.on(EV.MOVE_SCORE_COMMITTED, (payload) => {
    if (isOverlayActive()) {
      pendingCommitPayload = payload;
      schedulePoll();
    } else {
      emitScoreCommitAnimations(payload);
    }
  }));

  subs.push(bus.on(EV.OPPONENT_MOVED, (payload) => {
    if (payload?.slot === mySlot) return; // shouldn't happen but defensive
    emitMoveAnimations({ ...payload, opponent: true });
  }));

  subs.push(bus.on(EV.INVALID_MOVE_REJECTED, ({ reason, placed, invalidWords, invalidWordTiles }) => {
    trigger({ kind: 'shakeWord',     payload: { reason, placed, invalidWords, invalidWordTiles } });
    trigger({ kind: 'illegalPulse',  payload: { reason, placed, invalidWords, invalidWordTiles } });
  }));

  subs.push(bus.on(EV.BONUS_PENDING, payload => presentBoost({ ...payload, presentation: 'intro' }, null, true)));
  subs.push(bus.on('bonus/aborted', cancelBoostPresentation));
  subs.push(bus.on(EV.GAME_COMPLETED, () => cancelBoostPresentation()));
  subs.push(bus.on(EV.GAME_STARTED, () => cancelBoostPresentation()));

  subs.push(bus.on(EV.BOOST_ACTIVATED, ({ slot, boostId, bonusIdx, payload, consumed, pending }) => {
    // Consumption events (e.g. a free_tile_swap being spent) reuse
    // BOOST_ACTIVATED — those should NOT pop the modal overlay again.
    if (consumed) return;
    // `pending: true` is the turn-start REMINDER emission from
    // emitTurnStartEffects (a queued future-effect boost waking up on the
    // booster's next turn — e.g. free_tile_swap from the wheel of fortune).
    // The player already saw + acknowledged the award overlay when the
    // boost was first granted; re-popping the modal on every turn start
    // until the boost is consumed is exactly the loop the user reported.
    // Pending reminders do not replay the award UI or badge entrance.
    if (pending) return;
    // Fresh activation opens the modal award overlay (in animationController's
    // renderer) which counts as an open bonus overlay for score-commit gating.
    // For a pinned local seat (online), an opponent's bonus must not pop a
    // modal — finalization is handled server-side. In bot games we DO want to
    // show the overlay so the human can see what the bot earned; that path is
    // opted in via showOpponentBoostOverlay. mySlot=null means a shared local
    // screen (2P offline) where every activation is "ours" to ack.
    const isOpponent = mySlot != null && slot !== mySlot;
    // Every fresh bonus-square activation routes through the same modal
    // award overlay so the player always sees a concrete description of
    // what they earned. The legacy small "+BONUS" float that the player
    // could miss is gone.
    const awardDirective = {
      kind: 'bonusAwardOverlay',
      payload: { slot, boostId, bonusIdx, extra: payload?.extra ?? 0, boostPayload: payload ?? null, isOpponent },
    };
    const fresh = presentBoost({ slot, boostId, bonusIdx, kind: 'award' }, () => {
      if (renderer && (!isOpponent || showOpponentBoostOverlay)) {
        callRenderer(awardDirective.kind, { ...awardDirective.payload, reducedMotion: reducedMotion() });
      }
    }, !isOpponent || showOpponentBoostOverlay);
    if (!fresh || (isOpponent && !showOpponentBoostOverlay)) return;
    // Retain immediate semantic diagnostics while DOM presentation waits.
    directives.push(awardDirective);
  }));

  let lastYourTurnSignature = null;
  subs.push(bus.on(EV.GAME_STARTED, () => { lastYourTurnSignature = null; }));
  subs.push(bus.on(EV.TURN_CHANGED, ({ currentTurnSlot }) => {
    trigger({ kind: 'playerGlowPulse', payload: { slot: currentTurnSlot } });
  }));
  subs.push(bus.on(EV.TURN_PRESENTATION_READY, ({ currentTurnSlot, turnNumber }) => {
    const isLocalTurn = mySlot == null || currentTurnSlot === mySlot;
    const signature = `${currentTurnSlot}:${turnNumber ?? ''}`;
    if (isLocalTurn && signature !== lastYourTurnSignature) {
      lastYourTurnSignature = signature;
      trigger({ kind: 'yourTurnCue', payload: { slot: currentTurnSlot, turnNumber } });
    }
  }));

  // Turn-flow notices ("your turn was skipped", "the opponent plays again").
  // Deliberately NOT routed through the modal award overlay: these fire while
  // the OTHER player is acting, so they must not demand a tap, and they must
  // not increment overlayCount (that gate exists to hold score-commit
  // animations behind a modal — a self-dismissing banner has nothing to hold).
  subs.push(bus.on(EV.TURN_EFFECTS_APPLIED, ({ effects }) => {
    for (const effect of effects ?? []) {
      if (!effect?.type) continue;
      trigger({ kind: 'turnEffectBanner', payload: { ...effect, mySlot } });
    }
  }));

  subs.push(bus.on(EV.TILES_EXCHANGED, ({ count }) => {
    trigger({ kind: 'bagBounce', payload: { count } });
    trigger({ kind: 'tileCascadeIn', payload: { count } });
  }));

  function dispose() {
    for (const off of subs) try { off(); } catch { /* swallow */ }
    subs.length = 0;
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
    cancelBoostPresentation();
    pendingCommitPayload = null;
    overlayCount = 0;
    renderer = null;
  }

  return {
    setEnabled,
    setRenderer,
    dispose,
    _directives: directives, // exposed for tests
  };
}
