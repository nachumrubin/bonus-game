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
import {
  WORD_MERGE_STAGGER_MS,
  WORD_MERGE_FLIGHT_MS,
  BOOST_MERGE_DELAY_MS,
  HOLD_AFTER_MERGE_MS,
  SUM_FLIGHT_MS,
  COUNTUP_PEAK_MS,
} from '../scoreAnimationTimings.js';

export function createAnimationController({ bus, mySlot = null }) {
  if (!bus) throw new Error('createAnimationController: bus required');

  let enabled = true;
  let renderer = null;

  function setEnabled(on) { enabled = !!on; }
  function setRenderer(r) { renderer = r; }

  // Translate an engine event payload into an animation directive that the
  // renderer can act on. Keeping the directives data-only means tests can
  // assert on them without a DOM.
  const directives = []; // append-only log of triggered animations (for tests)
  function trigger(directive) {
    directives.push(directive);
    if (!enabled || !renderer) return;
    try {
      const fn = renderer[directive.kind];
      if (fn) fn(directive.payload);
    } catch (e) {
      console.warn('[anim]', directive.kind, e);
    }
  }

  const subs = [];

  // Score-merge sequence constants come from src/ui/scoreAnimationTimings.js
  // (single source of truth, shared with gameScreen.renderScores). Each
  // word's +N chip flies to a central sum chip; once all words + bonus
  // extra have merged, the sum holds briefly then flies into the score box.

  // Returns { mergeEnd, totalToPanelLanding } so callers can align their
  // own timing (count-up, glow duration, etc.) to the merge sequence.
  function scoreMergeTiming({ wordCount, bonusExtra }) {
    const lastWordStart = wordCount > 0 ? (wordCount - 1) * WORD_MERGE_STAGGER_MS : 0;
    const boostStart    = bonusExtra > 0 ? lastWordStart + BOOST_MERGE_DELAY_MS : lastWordStart;
    const mergeEnd      = boostStart + WORD_MERGE_FLIGHT_MS;
    const totalToPanelLanding = mergeEnd + HOLD_AFTER_MERGE_MS + SUM_FLIGHT_MS;
    return { mergeEnd, totalToPanelLanding };
  }

  function emitScoreSequence({ slot, placed, wordTiles, score, baseScore, bonusExtra }) {
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

    // Single merge directive — gameScreen orchestrates the per-word chip
    // flights, the running-sum count-up, the boost extra merge, and the
    // final flight to the score panel as one cohesive sequence.
    trigger({
      kind: 'scoreMergeSequence',
      payload: { slot, placed, words: wordsForRender, finalScore: total, baseScore: base, bonusExtra: extra },
    });

    // Per-word glow timed to the per-word chip launches — each word
    // lights up when its +N chip leaves and stays glowing until the
    // panel count-up finishes.
    if (wordsForRender.length > 0) {
      const { totalToPanelLanding } = scoreMergeTiming({ wordCount: wordsForRender.length, bonusExtra: extra });
      const glowEnd = totalToPanelLanding + COUNTUP_PEAK_MS;
      wordsForRender.forEach((w, i) => {
        const start = i * WORD_MERGE_STAGGER_MS;
        trigger({
          kind: 'scoringWordGlow',
          payload: { slot, wordTiles: [w.wordTiles], placed, delayMs: start, durationMs: Math.max(280, glowEnd - start) },
        });
      });
    }
  }

  function emitMoveAnimations({ slot, placed, words, wordTiles, score, opponent = false, scoringDeferred = false }) {
    trigger({ kind: 'tilePlaceIn',     payload: { slot, placed, opponent } });
    if (!opponent) trigger({ kind: 'validFlash', payload: { slot, words, wordTiles, placed } });
    if ((placed?.length ?? 0) >= RACK_SIZE) {
      trigger({ kind: 'bingoLabel', payload: { slot, placed, wordTiles } });
    }
    if ((words?.length ?? 0) > 1) {
      trigger({ kind: 'multiplierLabel', payload: { slot, words, wordTiles } });
    }
    // The booster's rack just got refilled from the bag — cascade the new
    // tiles in. Opponent moves don't touch the local rack so skip there.
    if (!opponent && (placed?.length ?? 0) > 0) {
      trigger({ kind: 'tileCascadeIn', payload: { slot, count: placed.length } });
    }
    if (scoringDeferred) return;
    emitScoreSequence({ slot, placed, wordTiles, score });
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

  function bonusOverlayPresentDom() {
    const doc = globalThis.document;
    if (!doc) return false;
    for (const id of ['ov-bonus', 'ov-bonus-intro']) {
      const el = doc.getElementById?.(id);
      if (el && !el.classList?.contains?.('hidden')) return true;
    }
    if (doc.querySelector?.('.bonus-award-positioner')) return true;
    return false;
  }
  function isOverlayActive() {
    return overlayCount > 0 || bonusOverlayPresentDom();
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

  subs.push(bus.on('bonus/pending',  () => { overlayCount += 1; }));
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

  subs.push(bus.on(EV.BOOST_ACTIVATED, ({ slot, boostId, bonusIdx, payload, consumed, pending }) => {
    trigger({ kind: 'bonusActivate',   payload: { slot, boostId, bonusIdx } });
    trigger({ kind: 'boostPulse',      payload: { slot, boostId } });
    // Consumption events (e.g. a free_tile_swap being spent) reuse
    // BOOST_ACTIVATED — those should NOT pop the modal overlay again.
    if (consumed) return;
    // `pending: true` is the turn-start REMINDER emission from
    // emitTurnStartEffects (a queued future-effect boost waking up on the
    // booster's next turn — e.g. free_tile_swap from the wheel of fortune).
    // The player already saw + acknowledged the award overlay when the
    // boost was first granted; re-popping the modal on every turn start
    // until the boost is consumed is exactly the loop the user reported.
    // Only the boost-badge pulse fires for pending reminders.
    if (pending) return;
    // Fresh activation opens the modal award overlay (in animationController's
    // renderer) which counts as an open bonus overlay for score-commit gating.
    overlayCount += 1;
    // Only show the award overlay when the activation belongs to the local
    // player. For a pinned local seat (bot games, online), an opponent's
    // bonus must not pop a modal for us — finalization for the bot is
    // handled by attachBonusFlow in main.js. mySlot=null means a shared
    // local screen (2P offline) where every activation is "ours" to ack.
    if (mySlot != null && slot !== mySlot) return;
    // Every fresh bonus-square activation routes through the same modal
    // award overlay so the player always sees a concrete description of
    // what they earned. The legacy small "+BONUS" float that the player
    // could miss is gone.
    trigger({
      kind: 'bonusAwardOverlay',
      payload: { slot, boostId, bonusIdx, extra: payload?.extra ?? 0, boostPayload: payload ?? null },
    });
  }));

  subs.push(bus.on(EV.TURN_CHANGED, ({ currentTurnSlot }) => {
    trigger({ kind: 'playerGlowPulse', payload: { slot: currentTurnSlot } });
  }));

  subs.push(bus.on(EV.GAME_COMPLETED, ({ winnerSlot }) => {
    trigger({ kind: 'scorePanelArrive', payload: { winnerSlot } });
    trigger({ kind: 'overlayCardIn',    payload: { kind: 'gameOver', winnerSlot } });
  }));

  subs.push(bus.on(EV.TILES_EXCHANGED, ({ count }) => {
    trigger({ kind: 'bagBounce', payload: { count } });
    trigger({ kind: 'tileCascadeIn', payload: { count } });
  }));

  function dispose() {
    for (const off of subs) try { off(); } catch { /* swallow */ }
    subs.length = 0;
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
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
