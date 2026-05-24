// Cancels the opponent's NEXT bonus square activation. Activated by the
// B13 wheel "cancel_boost" outcome.
//
// Lives in activeBoosts as:
//   { slot, boostId: 'cancel_next_opponent_bonus', payload: {}, turnNumber }
//
// Fires on beforeMoveValidate when the OPPONENT (not the booster) places a
// tile on a bonus square. The engine reads ctx.suppressBonus = true and
// commits the move WITHOUT triggering the bonus mini-game / future effect.
// consume() drops the entry (one-shot defensive ability).

import { TRIGGERS } from '../../core/boostEngine.js';
import { isBonusPos } from '../../core/board.js';

export default {
  id: 'cancel_next_opponent_bonus',
  name: 'ביטול בוסט יריב',
  description: 'מבטל את הבוסט הבא של היריב',
  trigger: TRIGGERS.AFTER_MOVE_VALIDATE,

  canActivate(ctx, entry) {
    if (ctx.state?.currentTurnSlot === entry.slot) return false; // not the booster's own move
    const placed = ctx.placed ?? [];
    return placed.some(p => isBonusPos(p.r, p.c));
  },

  apply(ctx /* , entry */) {
    return { ...ctx, suppressBonus: true };
  },

  consume() { return null; },

  buildSyncPayload() { return {}; },
  applyRemote(_payload, ctx) { return { ...ctx, suppressBonus: true }; },

  animationKey: 'cancelBoostFlash',
};
