// Boost registry boot.
//
// Call registerAllBoosts() once at app boot. After that, the boostEngine
// is aware of every persistent-effect plugin and can resolve activeBoosts
// entries via runHook().
//
// The bonus *tile* definitions (B1-B13 metadata: trigger category, mini-game
// key, point value) are exported separately as BONUS_TILE_DEFS — the engine
// reads these to decide what to do when a player lands on a bonus square,
// then either auto-applies a reward, opens a mini-game, or queues a
// persistent effect.

import { register, _resetRegistry } from '../core/boostEngine.js';

import multiplyNextTurns         from './futureEffects/multiplyNextTurns.js';
import extraTurn                 from './futureEffects/extraTurn.js';
import timerBonus                from './futureEffects/timerBonus.js';
import skipOpponentTurn          from './futureEffects/skipOpponentTurn.js';
import freeTileSwap              from './futureEffects/freeTileSwap.js';
import cancelNextOpponentBonus   from './futureEffects/cancelNextOpponentBonus.js';
import autoExtraScore            from './futureEffects/autoExtraScore.js';

const ALL_PLUGINS = [
  multiplyNextTurns,
  extraTurn,
  timerBonus,
  skipOpponentTurn,
  freeTileSwap,
  cancelNextOpponentBonus,
  autoExtraScore,
];

export function registerAllBoosts() {
  for (const def of ALL_PLUGINS) register(def);
}

export function _resetAndRegister() {
  _resetRegistry();
  registerAllBoosts();
}

export { BONUS_TILE_DEFS, WHEEL_OUTCOMES } from './bonusTileDefs.js';
export { BONUS_TYPES, BDEFS } from './data.js';
