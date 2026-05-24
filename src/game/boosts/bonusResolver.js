// Resolves a bonus square activation into one or more activeBoosts entries.
//
// The flow:
//   1. UI / engine detects that a placed tile sits on a bonus square (BDEFS index i).
//   2. The bonus type from bonusAssignment[i] is a BONUS_TILE_DEFS key (B1-B13).
//   3. resolveBonusActivation() inspects the def and either:
//        - returns immediate activeBoosts entries (auto / future categories), OR
//        - returns { miniGamePending: true } so UI can play a mini-game first.
//   4. After a mini-game / wheel result, UI dispatches the result back via
//      resolveMiniGameResult() / resolveWheelResult(), which produce the
//      final activeBoosts entries.
//
// Pure: no DOM, no random numbers (the wheel's RNG lives in the UI/session).

import { BONUS_TILE_DEFS, WHEEL_OUTCOMES } from './bonusTileDefs.js';

export function resolveBonusActivation({ bonusType, slot, turnNumber }) {
  const def = BONUS_TILE_DEFS[bonusType];
  if (!def) return { error: `unknown bonus type: ${bonusType}`, entries: [] };

  switch (def.category) {
    case 'auto':
      return {
        entries: [autoExtraEntry(slot, turnNumber, def.autoExtra)],
        miniGamePending: false,
      };

    case 'future':
      return {
        entries: [{
          slot,
          boostId: def.futureEffectId,
          payload: def.futurePayload(),
          turnNumber,
        }],
        miniGamePending: false,
      };

    case 'minigame':
      return {
        entries: [],
        miniGamePending: true,
        miniGameKey: def.miniGameKey,
      };

    case 'wheel':
      return {
        entries: [],
        wheelPending: true,
        miniGameKey: def.miniGameKey,
      };

    default:
      return { entries: [] };
  }
}

// After the UI plays a mini-game, it dispatches the outcome back here. The
// payload depends on the mini-game; for unscramble/honeycomb/etc. the UI
// reports { success: bool, earnedPts?: number } and we add an
// auto_extra_score entry for the earned points (or none on failure).
export function resolveMiniGameResult({ slot, turnNumber, success, earnedPts }) {
  if (!success || !earnedPts) return { entries: [] };
  return { entries: [autoExtraEntry(slot, turnNumber, earnedPts)] };
}

// After the UI spins the wheel, the chosen outcome id is dispatched here.
export function resolveWheelResult({ slot, turnNumber, outcomeId }) {
  const outcome = WHEEL_OUTCOMES.find(o => o.id === outcomeId);
  if (!outcome) return { error: `unknown wheel outcome: ${outcomeId}`, entries: [] };

  if (outcome.kind === 'auto') {
    return { entries: [autoExtraEntry(slot, turnNumber, outcome.extra)] };
  }
  if (outcome.kind === 'future') {
    return {
      entries: [{
        slot,
        boostId: outcome.futureEffectId,
        payload: outcome.payload(),
        turnNumber,
      }],
    };
  }
  return { entries: [] };
}

function autoExtraEntry(slot, turnNumber, extra) {
  return { slot, boostId: 'auto_extra_score', payload: { extra }, turnNumber };
}
