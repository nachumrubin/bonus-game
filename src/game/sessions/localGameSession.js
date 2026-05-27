// Local play session — offline solo (no opponent), offline 2-player
// (pass-and-play), or offline-vs-bot (when paired with attachBotPlayer).
//
// This session is mostly a thin wrapper around the engine: the UI dispatches
// commands directly via session.dispatch(...). The wrapper exists to:
//   - hold the engine, bus, and mode descriptor in one place,
//   - expose start() / dispose() for lifecycle,
//   - centralise the place where saveLocal / loadLocal will eventually be
//     wired (deferred until Stage 7).

import { createEngine, createInitialState } from '../core/gameEngine.js';
import { modeDescriptor } from './modes.js';

/**
 * @typedef {import('../core/gameEngine.js').GameState} GameState
 * @typedef {import('../core/gameEngine.js').SpineCommand} SpineCommand
 * @typedef {{ uid?: string, displayName?: string, [key: string]: any }} SessionPlayer
 * @typedef {{
 *   state: GameState,
 *   engine: ReturnType<typeof createEngine>,
 *   bus: { on(type: string, fn: Function): Function, emit(type: string, payload?: any): void },
 *   mode: string,
 *   descriptor: ReturnType<typeof modeDescriptor>,
 *   start(): void,
 *   dispatch(cmd: SpineCommand): void,
 *   dispose(): void,
 *   _subs: Array<Function>
 * }} LocalGameSession
 */

/**
 * Create an offline/local session wrapper around the core engine.
 *
 * Pass `initialState` to restore a previously saved game; in that case the
 * other state-shaping options (tileBagSeed, players, startingSlot, settings)
 * are ignored and `mode` defaults to `initialState.mode`.
 *
 * @param {{ bus: LocalGameSession['bus'], mode?: string, tileBagSeed?: string, players?: Record<0 | 1, SessionPlayer>, startingSlot?: 0 | 1, settings?: Record<string, any>, initialState?: import('../core/gameEngine.js').GameState }} options
 * @returns {LocalGameSession}
 */
export function createLocalGameSession({
  bus,
  mode,
  tileBagSeed,
  players,
  startingSlot = 0,
  settings = {},
  initialState = null,
}) {
  if (!bus) throw new Error('createLocalGameSession: bus is required');

  let state;
  if (initialState) {
    state = initialState;
    mode = mode ?? state.mode ?? 'offline-2p';
  } else {
    if (!tileBagSeed) throw new Error('createLocalGameSession: tileBagSeed is required');
    if (!players?.[0] || !players?.[1]) throw new Error('createLocalGameSession: players are required');
    mode = mode ?? 'offline-2p';
    state = createInitialState({ mode, tileBagSeed, players, startingSlot, settings });
  }
  const engine = createEngine({ state, bus });
  const descriptor = modeDescriptor(mode);

  const subs = [];

  function start() { engine.start(); }

  function dispatch(cmd) { engine.dispatch(cmd); }

  function dispose() {
    for (const off of subs) {
      try { off(); } catch { /* swallow */ }
    }
    subs.length = 0;
  }

  return {
    state,
    engine,
    bus,
    mode,
    descriptor,
    start,
    dispatch,
    dispose,
    _subs: subs, // exposed so attachBotPlayer can register cleanup hooks
  };
}
