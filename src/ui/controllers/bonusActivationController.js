// bonusActivationController — bridges the engine's MOVE_CONFIRMED event to
// the bonus-square / mini-game UI flow.
//
// Responsibilities:
//   1. Subscribe to EV.MOVE_CONFIRMED on the bus.
//   2. For each just-placed tile, check whether (r, c) lands on a bonus
//      square slot that is not yet `bonusSqUsed`.
//   3. For each new activation, look up the BONUS_TYPES assignment and call
//      bonusResolver.resolveBonusActivation. If the result is `auto` or
//      `future`, dispatch CMD.ACTIVATE_BOOST immediately. If it's
//      `minigame` or `wheel`, emit BONUS_PENDING so a mini-game / wheel UI
//      can take over.
//   4. Expose `resolveMiniGame({ success, earnedPts })` and
//      `resolveWheel({ outcomeId })` for the mini-game UI to call back
//      into. These produce the boost entries via bonusResolver and
//      dispatch CMD.ACTIVATE_BOOST.
//
// State is owned per-controller, not per-session; main.js wires this once
// per game-screen mount and disposes on unmount.

import { EV } from '../../events/eventTypes.js';
import { CMD } from '../../events/commands.js';
import { BDEFS, BONUS_TYPES } from '../../game/boosts/data.js';
import {
  resolveBonusActivation,
  resolveMiniGameResult,
  resolveWheelResult,
} from '../../game/boosts/bonusResolver.js';

// UI bus events. The controller emits BONUS_PENDING to ask the UI to play
// a mini-game; the UI responds by calling resolveMiniGame()/resolveWheel().
export const BONUS_PENDING = 'bonus/pending';
export const BONUS_RESOLVED = 'bonus/resolved';

function findActivatedIdxs(placed, state) {
  const used = state.bonusSqUsed ?? {};
  const out = [];
  for (let i = 0; i < BDEFS.length; i++) {
    if (used[i]) continue;
    const b = BDEFS[i];
    if (placed.some(p => p.r === b.br && p.c === b.bc)) out.push(i);
  }
  return out;
}

function bonusTypeForIdx(state, idx) {
  const ba = state.bonusAssignment?.[idx];
  // Fall back to a deterministic BONUS_TYPES lookup if assignment is empty.
  return ba?.type ?? BONUS_TYPES[idx % BONUS_TYPES.length].type;
}

export function createBonusActivationController({ bus, session, dispatch } = {}) {
  if (!bus)     throw new Error('createBonusActivationController: bus required');
  if (!session) throw new Error('createBonusActivationController: session required');
  const dispatchFn = dispatch ?? ((cmd) => session.dispatch(cmd));

  // Local marker so we don't refire for the same slot if the engine doesn't
  // update bonusSqUsed (the engine flow may rely on a follow-up patch).
  const localUsed = new Set();
  let pendingQueue = []; // [{ idx, bonusType, slot, turnNumber }]

  // The engine emits EV.BONUS_PENDING directly from collectBonusActivations
  // (it pre-marks state.bonusSqUsed before MOVE_CONFIRMED fires, so the
  // MOVE_CONFIRMED-derived path below is a no-op in production and only
  // runs in unit tests that mock the session). We mirror engine-emitted
  // pendings into our local queue so resolveMiniGame / resolveWheel can
  // pair the mini-game result back to the right slot+turn — and crucially
  // emit BONUS_RESOLVED, which is what un-pauses the turn timer and bot.
  const offEnginePending = bus.on(EV.BONUS_PENDING, (pending) => {
    if (!pending || pending.idx == null) return;
    if (pendingQueue.some(p => p.idx === pending.idx)) return;
    pendingQueue.push({
      idx: pending.idx,
      bonusType: pending.bonusType,
      slot: pending.slot,
      turnNumber: pending.turnNumber,
      miniGameKey: pending.miniGameKey,
      kind: pending.kind ?? 'minigame',
    });
  });

  const offMove = bus.on(EV.MOVE_CONFIRMED, ({ slot, placed }) => {
    const state = session.state;
    if (!state) return;
    const idxs = findActivatedIdxs(placed ?? [], state).filter(i => !localUsed.has(i));
    if (idxs.length === 0) return;

    for (const idx of idxs) localUsed.add(idx);

    const turnNumber = state.turnNumber ?? 1;
    for (const idx of idxs) {
      const bonusType = bonusTypeForIdx(state, idx);
      const result = resolveBonusActivation({ bonusType, slot, turnNumber });
      if (result.error) {
        console.warn('[bonusActivation]', result.error);
        continue;
      }
      if (result.entries.length > 0) {
        for (const entry of result.entries) {
          dispatchFn({ type: CMD.ACTIVATE_BOOST, payload: { ...entry, bonusIdx: idx } });
        }
        // No BONUS_RESOLVED here: immediate (auto/future) bonuses go through
        // the BOOST_ACTIVATED → award-overlay → BONUS_AWARD_ACK lifecycle.
        // Firing BONUS_RESOLVED now would resume the timer (and flush the
        // score animation) before the player has seen / acknowledged the
        // award overlay. BONUS_RESOLVED stays paired with BONUS_PENDING,
        // i.e. only the mini-game / wheel path emits it.
      }
      if (result.miniGamePending || result.wheelPending) {
        pendingQueue.push({
          idx, bonusType, slot, turnNumber,
          miniGameKey: result.miniGameKey,
          kind: result.wheelPending ? 'wheel' : 'minigame',
        });
        bus.emit(BONUS_PENDING, {
          idx, bonusType, slot, turnNumber,
          miniGameKey: result.miniGameKey,
          kind: result.wheelPending ? 'wheel' : 'minigame',
        });
      }
    }
  });

  // Mini-game callback: produces an auto_extra_score entry and dispatches it.
  function resolveMiniGame({ success, earnedPts } = {}) {
    const top = pendingQueue.shift();
    if (!top || top.kind !== 'minigame') return { ok: false, reason: 'no-pending' };
    const { entries } = resolveMiniGameResult({
      slot: top.slot, turnNumber: top.turnNumber, success: !!success, earnedPts,
    });
    for (const entry of entries) {
      dispatchFn({ type: CMD.ACTIVATE_BOOST, payload: { ...entry, bonusIdx: top.idx } });
    }
    if (entries.length === 0) {
      dispatchFn({ type: CMD.FINALIZE_BOOST_AWARD, payload: { slot: top.slot, extra: 0, bonusIdx: top.idx } });
    }
    bus.emit(BONUS_RESOLVED, { ...top, success: !!success, earnedPts: earnedPts ?? 0, kind: 'minigame' });
    return { ok: true, entries };
  }

  function resolveWheel({ outcomeId } = {}) {
    const top = pendingQueue.shift();
    if (!top || top.kind !== 'wheel') return { ok: false, reason: 'no-pending' };
    const { entries, error } = resolveWheelResult({
      slot: top.slot, turnNumber: top.turnNumber, outcomeId,
    });
    if (error) {
      console.warn('[bonusActivation.wheel]', error);
      return { ok: false, reason: error };
    }
    for (const entry of entries) {
      dispatchFn({ type: CMD.ACTIVATE_BOOST, payload: { ...entry, bonusIdx: top.idx } });
    }
    if (entries.length === 0) {
      dispatchFn({ type: CMD.FINALIZE_BOOST_AWARD, payload: { slot: top.slot, extra: 0, bonusIdx: top.idx } });
    }
    bus.emit(BONUS_RESOLVED, { ...top, outcomeId, kind: 'wheel' });
    return { ok: true, entries };
  }

  // Auto-resolve the next pending mini-game/wheel without playing UI. Used
  // when the placing slot isn't the local player (e.g. the bot triggered the
  // bonus square). Adds `earnedPts` directly to the placing slot's score via
  // FINALIZE_BOOST_AWARD (no award overlay), clears the pending bonus, and
  // emits BONUS_RESOLVED so paused subscribers (bot, turn timer) resume.
  function skipPending({ earnedPts = 0 } = {}) {
    const top = pendingQueue.shift();
    if (!top) return { ok: false, reason: 'no-pending' };
    dispatchFn({
      type: CMD.FINALIZE_BOOST_AWARD,
      payload: { slot: top.slot, extra: Number(earnedPts) || 0, bonusIdx: top.idx },
    });
    bus.emit(BONUS_RESOLVED, { ...top, success: earnedPts > 0, earnedPts: Number(earnedPts) || 0, skipped: true });
    return { ok: true };
  }

  function dispose() {
    try { offMove(); } catch {}
    try { offEnginePending(); } catch {}
    pendingQueue = [];
    localUsed.clear();
  }

  return {
    resolveMiniGame,
    resolveWheel,
    skipPending,
    dispose,
    // Test/inspection helpers
    _peekPending: () => pendingQueue.slice(),
    _localUsed: () => Array.from(localUsed),
  };
}
