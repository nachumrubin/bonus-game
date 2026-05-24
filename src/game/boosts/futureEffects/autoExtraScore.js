// One-shot extra score. Used to fold a bonus reward (B2/B4/B9 auto, B1/B3/B8/B10/B11/B12
// mini-game success, or B13 wheel pts_50/pts_1) into the move's score on the
// SAME turn the bonus square was triggered.
//
// Lives in activeBoosts as:
//   { slot, boostId: 'auto_extra_score', payload: { extra }, turnNumber }
//
// Fires on beforeScoreCommit. consume() drops the entry.

import { TRIGGERS } from '../../core/boostEngine.js';

export default {
  id: 'auto_extra_score',
  name: 'ניקוד נוסף',
  description: 'מוסיף נקודות לתור הזה',
  trigger: TRIGGERS.BEFORE_SCORE_COMMIT,

  canActivate(ctx, entry) {
    return ctx.state?.currentTurnSlot === entry.slot;
  },

  apply(ctx, entry) {
    const extra = entry.payload?.extra ?? 0;
    return { ...ctx, score: (ctx.score ?? 0) + extra };
  },

  consume() { return null; },

  buildSyncPayload(_ctx, entry) { return { extra: entry.payload?.extra ?? 0 }; },
  applyRemote(payload, ctx) { return { ...ctx, score: (ctx.score ?? 0) + (payload.extra ?? 0) }; },

  animationKey: 'autoScoreFlash',
};
