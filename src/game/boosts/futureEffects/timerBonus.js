// Adds extra seconds to the slot's next turn timer (live mode only).
// Activated by the B13 wheel.
//
// Lives in activeBoosts as:
//   { slot, boostId: 'timer_bonus', payload: { seconds }, turnNumber }
//
// Fires on onTurnStart of the slot's own next turn — extends ctx.turnDeadlineMs.
// consume() drops the entry.

import { TRIGGERS } from '../../core/boostEngine.js';

export default {
  id: 'timer_bonus',
  name: 'בונוס זמן',
  description: 'מקבל שניות נוספות בתור הבא',
  trigger: TRIGGERS.ON_TURN_START,

  canActivate(ctx, entry) {
    return ctx.startingSlot === entry.slot;
  },

  apply(ctx, entry) {
    const ms = (entry.payload?.seconds ?? 0) * 1000;
    if (!ctx.turnDeadlineMs || ms <= 0) return ctx;
    return { ...ctx, turnDeadlineMs: ctx.turnDeadlineMs + ms };
  },

  consume() { return null; },

  buildSyncPayload(_ctx, entry) { return { seconds: entry.payload?.seconds ?? 0 }; },
  applyRemote() { /* timer is a local UI concern; no remote effect */ },

  animationKey: 'timerBonusFlash',
};
