// Forces the opponent to skip their next turn. Activated by the B13 wheel.
//
// Lives in activeBoosts as:
//   { slot, boostId: 'skip_opponent_turn', payload: {}, turnNumber }
//
// Fires on onTurnStart when the OPPONENT (not the boost's owner) is about to
// play. Sets ctx.skipTurn = true; the engine then auto-passes for them.
// consume() drops the entry.

import { TRIGGERS } from '../../core/boostEngine.js';

export default {
  id: 'skip_opponent_turn',
  name: 'דילוג על תור היריב',
  description: 'היריב מדלג על התור הבא',
  trigger: TRIGGERS.ON_TURN_START,

  canActivate(ctx, entry) {
    // Fires when it's the opponent's turn, not the booster's own turn
    return ctx.startingSlot != null && ctx.startingSlot !== entry.slot;
  },

  apply(ctx /* , entry */) {
    return { ...ctx, skipTurn: true };
  },

  consume() { return null; },

  buildSyncPayload() { return {}; },
  applyRemote(_payload, ctx) { return { ...ctx, skipTurn: true }; },

  animationKey: 'skipTurnFlash',
};
