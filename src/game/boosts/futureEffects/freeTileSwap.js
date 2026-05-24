// Banks a free tile-exchange action that doesn't consume the player's turn.
// Activated by the B13 wheel.
//
// Lives in activeBoosts as:
//   { slot, boostId: 'free_tile_swap', payload: {}, turnNumber }
//
// Doesn't fire on a built-in trigger. The 🔄 boost badge emits
// BB_INTENT.REDEEM_TILE_SWAP; main.js opens the exchange overlay with a
// freeSwap flag; gameController.exchangeTiles forwards freeSwap into
// CMD.EXCHANGE_TILE; the engine's handleExchange resolves it by removing
// this active-boost entry and skipping the normal advanceTurn step. This
// module only carries metadata so the UI can show / hide the badge.

import { TRIGGERS } from '../../core/boostEngine.js';

export default {
  id: 'free_tile_swap',
  name: 'החלפת אריחים חינם',
  description: 'החלף אריחים מבלי לבזבז תור',
  // No automatic trigger — the engine handles consumption when the player
  // explicitly redeems it.
  trigger: TRIGGERS.AFTER_SCORE_COMMIT,
  canActivate() { return false; },
  apply(ctx) { return ctx; },

  buildSyncPayload() { return {}; },
  applyRemote(_payload, ctx) { return ctx; },

  animationKey: 'tileSwapFlash',
};
