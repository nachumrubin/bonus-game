// Extra turn — the player gets to play another turn instead of handing
// control to the opponent. Activated by B5 and the B13 wheel.
//
// Lives in activeBoosts as:
//   { slot, boostId: 'extra_turn', payload: {}, turnNumber }
//
// Fires on onTurnEnd of the slot's own turn — instead of advancing to the
// opponent, the engine resets currentTurnSlot back to this slot. consume()
// drops the entry (one-shot).

import { TRIGGERS } from '../../core/boostEngine.js';

export default {
  id: 'extra_turn',
  name: 'תור נוסף',
  description: 'שחק שוב במקום להעביר את התור',
  trigger: TRIGGERS.ON_TURN_END,

  canActivate(ctx, entry) {
    // Only fires for the slot that earned it, on its own turn-end
    return ctx.endingSlot === entry.slot;
  },

  apply(ctx /* , entry */) {
    return { ...ctx, repeatTurn: true };
  },

  consume() { return null; },

  buildSyncPayload() { return {}; },
  applyRemote(_payload, ctx) { return { ...ctx, repeatTurn: true }; },

  animationKey: 'extraTurnFlash',
};
