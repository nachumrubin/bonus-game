// Score multiplier for the next N turns of a specific slot.
//
// Activated by:
//   - B6 (×4 next turn, payload {multiplier:4, turnsRemaining:1})
//   - B7 (×2 next 2 turns, payload {multiplier:2, turnsRemaining:2})
//   - B13 wheel "double_2" (×2 next 2 turns)
//
// Lives in activeBoosts as:
//   { slot, boostId: 'multiply_next_turns', payload: { multiplier, turnsRemaining }, turnNumber }
//
// Fires on beforeScoreCommit. consume() decrements turnsRemaining; entry is
// dropped when it reaches 0.

import { TRIGGERS } from '../../core/boostEngine.js';

export default {
  id: 'multiply_next_turns',
  name: 'בוסט הכפלה',
  description: 'מכפיל את הניקוד של התור הבא',
  trigger: TRIGGERS.BEFORE_SCORE_COMMIT,

  canActivate(ctx, entry) {
    // Only fires when the current player's slot matches the boost's owner
    return ctx.state?.currentTurnSlot === entry.slot;
  },

  apply(ctx, entry) {
    const m = entry.payload?.multiplier ?? 1;
    return { ...ctx, score: Math.round((ctx.score ?? 0) * m) };
  },

  consume(entry) {
    const remaining = (entry.payload?.turnsRemaining ?? 1) - 1;
    if (remaining <= 0) return null;
    return { ...entry, payload: { ...entry.payload, turnsRemaining: remaining } };
  },

  buildSyncPayload(_ctx, entry) {
    return { multiplier: entry.payload?.multiplier ?? 1 };
  },

  applyRemote(payload, ctx) {
    return { ...ctx, score: Math.round((ctx.score ?? 0) * (payload.multiplier ?? 1)) };
  },

  animationKey: 'multiplierFlash',
};
