// Online game session.
//
// Wires the local engine to a Firebase room:
//   - Watches the room for moves the OPPONENT made → dispatches a synthetic
//     command that mirrors the move into the local engine.
//   - Subscribes to MOVE_CONFIRMED on the bus → calls roomService.commitTransaction
//     to push the move to Firebase. Stale writes are rejected by the version
//     check inside roomService (replaces the legacy three-layer dedup).
//
// The engine itself doesn't know it's online. It just sees the same commands
// and emits the same events as in offline play. Online concerns (sync,
// presence, push) are added via subscriptions on top of the bus.
//
// `mySlot` is the slot this client owns. Only the slot whose turn it is may
// commit. The watcher silently ignores any room snapshot whose lastMove is
// from this client (echo cancellation).

import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { createEngine } from '../core/gameEngine.js';
import {
  engineStateFromRoom,
  watchRoom,
  commitTransaction,
  leaveRoom,
  setStatus,
  setReady,
  shouldUseSharedTurnTimer,
  turnLimitMsFromSettings,
} from '../online/roomService.js';
import { setCommittedTile } from '../core/board.js';
import { modeDescriptor } from './modes.js';

/**
 * @typedef {import('../core/gameEngine.js').GameState} GameState
 * @typedef {{
 *   state: GameState,
 *   engine: ReturnType<typeof createEngine>,
 *   bus: { on(type: string, fn: Function): Function, emit(type: string, payload?: any): void },
 *   mode: string,
 *   descriptor: ReturnType<typeof modeDescriptor>,
 *   roomId: string,
 *   mySlot: 0 | 1,
 *   start(): void,
 *   dispatch(cmd: import('../core/gameEngine.js').SpineCommand): void,
 *   dispose(): Promise<void>
 * }} OnlineGameSession
 */

/**
 * Create a Firebase-backed online session that mirrors room state into the engine.
 * @param {{ bus: OnlineGameSession['bus'], db: any, room: any, mySlot: 0 | 1 }} options
 * @returns {Promise<OnlineGameSession>}
 */
export async function createOnlineGameSession({
  bus, db, room, mySlot,
}) {
  if (!bus) throw new Error('bus required');
  if (!db) throw new Error('db required');
  if (!room) throw new Error('room required');
  if (mySlot !== 0 && mySlot !== 1) throw new Error('mySlot must be 0 or 1');

  const state = engineStateFromRoom(room);
  state.livePreview = room.livePreview ?? null;
  const engine = createEngine({ state, bus });
  const descriptor = modeDescriptor(room.mode);

  // Track the last applied room version so we can detect echo / staleness.
  let lastAppliedVersion = room.version;

  // Track expected version for the next outgoing transaction.
  let expectedVersion = room.version;
  let lastLivePreviewSig  = JSON.stringify(room.livePreview  ?? null);
  let lastSettingsSig     = JSON.stringify(room.settings    ?? {});
  let lastLiveBonusSig    = JSON.stringify(room.liveBonus   ?? null);
  // Reactions: track by ts to prevent replaying on reconnect.
  // Any reaction with ts <= sessionStartTs is treated as stale.
  const sessionStartTs    = Date.now();
  let lastReactionTs      = (room.liveReaction?.ts ?? 0);

  // Track the `ts` of the most recently observed `lastMove`. State-only
  // snapshots (timeout watchdog rotations, settings/preview writes) preserve
  // the previous lastMove via `...room` spread; without this, a watchdog
  // rotation would erroneously trigger the echo bail whenever the preserved
  // lastMove happens to be ours, leaving the local state.currentTurnSlot /
  // turnDeadlineMs stale (no turn flip, no timer reset, no "your turn" UI).
  let lastSeenMoveTs = room.lastMove?.ts ?? null;

  const subs = [];

  // For "normal" moves MOVE_CONFIRMED commits and the turn rotates in the
  // same write. For deferred-scoring moves (bonus mini-game), MOVE_CONFIRMED
  // intentionally skips the write — the move only lands once
  // MOVE_SCORE_COMMITTED fires with the final score. This flag tracks which
  // path we're on so MOVE_SCORE_COMMITTED doesn't redundantly commit after
  // a non-deferred MOVE_CONFIRMED (that second write would be rejected by
  // the rule's turn check, since data.currentTurnSlot on the server now
  // points to the opponent).
  let deferredCommitPending = false;

  // The post-commit cursor advance must NEVER go past the server's actual
  // room.version. The naive `expectedVersion += 1` races with the watchRoom
  // callback's echo branch: if the snapshot fires before our await resolves,
  // the echo bumps lastAppliedVersion to N+1 and then this handler bumps
  // again to N+2, leaving us one version ahead of the server and silently
  // dropping the opponent's next snapshot at the version-cursor bail.
  // commitTransaction returns the post-commit room, so anchor the cursor to
  // its actual version.
  function advanceVersionCursor(result) {
    const newVersion = Number(result?.room?.version ?? (expectedVersion + 1));
    if (newVersion > expectedVersion) expectedVersion = newVersion;
    if (newVersion > lastAppliedVersion) lastAppliedVersion = newVersion;
  }

  // ─── Outbound: when the engine confirms a local move, push it to Firebase.
  subs.push(bus.on(EV.MOVE_CONFIRMED, async ({ slot, scoringDeferred }) => {
    if (slot !== mySlot) return; // we only commit our own moves
    if (scoringDeferred) {
      deferredCommitPending = true;
      return;
    }
    deferredCommitPending = false;
    const result = await commitCurrentState({ lastMove: state.moveHistory[state.moveHistory.length - 1] ?? null });
    if (result.committed) {
      advanceVersionCursor(result);
    } else {
      // Stale: re-read and resync. Engine state will be overwritten on the
      // next watchRoom snapshot.
      bus.emit('evt/SYNC_REJECTED', { reason: 'stale-version', expected: expectedVersion });
    }
  }));

  subs.push(bus.on(EV.MOVE_SCORE_COMMITTED, async ({ slot }) => {
    if (slot !== mySlot) return;
    // Only commit here when the original MOVE_CONFIRMED deferred its write.
    // Otherwise the write already landed and trying to redo it would race
    // the just-rotated turn slot in the security rule.
    if (!deferredCommitPending) return;
    deferredCommitPending = false;
    const result = await commitCurrentState({ lastMove: state.moveHistory[state.moveHistory.length - 1] ?? null });
    if (result.committed) {
      advanceVersionCursor(result);
    } else {
      // Stale: re-read and resync. Engine state will be overwritten on the
      // next watchRoom snapshot.
      bus.emit('evt/SYNC_REJECTED', { reason: 'stale-version', expected: expectedVersion });
    }
  }));

  subs.push(bus.on(EV.LOCK_PLACED, async ({ slot, lock }) => {
    if (slot !== mySlot) return;
    const result = await commitCurrentState({
      lastMove: {
        slot,
        type: 'lock',
        lock,
        turnNumber: (state.turnNumber ?? 1) - 1,
        ts: Date.now(),
      },
    });
    if (result.committed) {
      advanceVersionCursor(result);
    } else {
      bus.emit('evt/SYNC_REJECTED', { reason: 'stale-version', expected: expectedVersion });
    }
  }));

  // Turn-rotation reasons that originate locally and need to be pushed to
  // Firebase: `pass` (voluntary pass), `illegal-word` (auto-pass after a
  // dictionary rejection), `timeout` (local clock expired). All of them
  // advance the turn in the engine and need a server commit so the next
  // player's deadline gets written. Without `illegal-word` / `timeout` in
  // this list, the next player's turn timer never resets on the opponent's
  // client because no new turnDeadlineMs lands on the room.
  const LOCAL_PASS_REASONS = new Set(['pass', 'illegal-word', 'timeout']);
  subs.push(bus.on(EV.TURN_CHANGED, async ({ reason, prevSlot }) => {
    if (!LOCAL_PASS_REASONS.has(reason) || prevSlot !== mySlot) return;
    const result = await commitCurrentState({
      lastMove: {
        slot: mySlot,
        type: 'pass',
        passReason: reason,
        turnNumber: (state.turnNumber ?? 1) - 1,
        ts: Date.now(),
      },
    });
    if (result.committed) {
      advanceVersionCursor(result);
    } else {
      bus.emit('evt/SYNC_REJECTED', { reason: 'stale-version', expected: expectedVersion });
    }
  }));

  // EV.TILES_EXCHANGED covers both regular exchanges (turn advanced) and the
  // free_tile_swap variant (turn unchanged). In either case we own the move,
  // so push the new rack/bag/activeBoosts to the room.
  subs.push(bus.on(EV.TILES_EXCHANGED, async ({ slot, count, free } = {}) => {
    const ownerSlot = slot ?? mySlot;
    if (ownerSlot !== mySlot) return;
    const result = await commitCurrentState({
      lastMove: {
        slot: mySlot,
        type: free ? 'free-exchange' : 'exchange',
        count: count ?? 0,
        turnNumber: free ? (state.turnNumber ?? 1) : (state.turnNumber ?? 1) - 1,
        ts: Date.now(),
      },
    });
    if (result.committed) {
      advanceVersionCursor(result);
    } else {
      bus.emit('evt/SYNC_REJECTED', { reason: 'stale-version', expected: expectedVersion });
    }
  }));

  subs.push(bus.on(EV.GAME_COMPLETED, async () => {
    // Game-over status is also handled via direct write so it survives
    // a transaction abort. roomService.setStatus skips the version check and
    // clears async indexes for terminal async rooms.
    try {
      const extras = {};
      if (state.abandonedBy === 0 || state.abandonedBy === 1) {
        extras.abandonedBy = state.abandonedBy;
      }
      if (state.abandonReason) {
        extras.abandonReason = state.abandonReason;
      }
      await setStatus(db, room.roomId, state.status, extras);
    } catch { /* swallow */ }
  }));

  // ─── Inbound: watch the room. When a snapshot arrives whose version is
  // newer AND whose last move came from the OPPONENT, replay it into the engine.
  const unwatch = watchRoom(db, room.roomId, (incoming) => {
    if (!incoming) return;
    const previewSig = JSON.stringify(incoming.livePreview ?? null);
    if (previewSig !== lastLivePreviewSig) {
      lastLivePreviewSig = previewSig;
      state.livePreview = incoming.livePreview ?? null;
      bus.emit(EV.LIVE_PREVIEW_CHANGED, { livePreview: state.livePreview });
    }
    const settingsSig = JSON.stringify(incoming.settings ?? {});
    if (settingsSig !== lastSettingsSig) {
      lastSettingsSig = settingsSig;
      state.settings = { ...(incoming.settings ?? {}) };
      bus.emit(EV.ROOM_SETTINGS_CHANGED, { settings: state.settings });
    }
    // liveBonus drives the spectator boost overlay + timer freeze on the
    // opponent. Track it independently of the move/version cursor so a
    // progress update (which doesn't bump room.version) still propagates.
    const liveBonusSig = JSON.stringify(incoming.liveBonus ?? null);
    if (liveBonusSig !== lastLiveBonusSig) {
      lastLiveBonusSig = liveBonusSig;
      state.liveBonus = incoming.liveBonus ?? null;
      bus.emit(EV.LIVE_BONUS_CHANGED, { liveBonus: state.liveBonus });
    }
    // liveReaction: emoji/message sent by either player. Only emit for
    // reactions that arrived after this session started (anti-replay on
    // reconnect). Track by ts to avoid double-firing on the same reaction.
    const incomingReaction = incoming.liveReaction ?? null;
    const incomingReactionTs = incomingReaction?.ts ?? 0;
    if (incomingReaction && incomingReactionTs > sessionStartTs && incomingReactionTs > lastReactionTs) {
      lastReactionTs = incomingReactionTs;
      bus.emit(EV.REACTION_RECEIVED, { reaction: incomingReaction });
    }
    if (incoming.version <= lastAppliedVersion) {
      applyTerminalStatusIfNeeded(incoming);
      return; // already applied or echo
    }

    const previousTurnSlot = state.currentTurnSlot;
    const previousTurnNumber = state.turnNumber;
    const previousStatus = state.status;
    const rawLast = incoming.lastMove ?? incoming.moveHistory?.[incoming.moveHistory.length - 1];
    // A snapshot only counts as "carrying a new move" if its lastMove.ts
    // advanced past what we've already seen. Watchdog rotations / settings
    // writes / live-preview writes preserve the previous lastMove via the
    // ...room spread, so without this check they would look like a new
    // commit from whichever player happened to move last.
    const incomingTs = rawLast?.ts ?? null;
    const isNewMove = incomingTs != null && incomingTs !== lastSeenMoveTs;
    const last = isNewMove ? rawLast : null;
    lastSeenMoveTs = incomingTs ?? lastSeenMoveTs;

    if (isNewMove && rawLast.slot === mySlot) {
      // Genuine echo of our own freshly-committed move. The engine already
      // applied it locally and emitted MOVE_CONFIRMED etc.; just advance
      // the version cursors so we don't double-apply.
      lastAppliedVersion = incoming.version;
      expectedVersion = incoming.version;
      return;
    }

    // Apply the opponent's move's tile placements directly to engine state
    // (board + moveHistory). We don't go through CONFIRM_MOVE because
    // validation already passed on their client; replicating via the same
    // path would re-validate and could diverge if dictionaries drift.
    if (last && last.type !== 'lock' && last.type !== 'pass' && last.type !== 'exchange' && last.type !== 'free-exchange') {
      applyOpponentMove(state, last);
    }

    // Resync state shadow from the room (authoritative) BEFORE emitting
    // events. Listeners (gameController.syncFromState etc.) re-read
    // session.state on every event, so emitting TURN_CHANGED while
    // state.currentTurnSlot is still the old value would leave the
    // active-slot glow / isMyTurn gate stuck on the slot that just played.
    lastAppliedVersion = incoming.version;
    expectedVersion = incoming.version;
    state.scores = { ...incoming.scores };
    state.bag = [...(incoming.bag ?? state.bag ?? [])];
    state.racks = { 0: [...(incoming.racks?.[0] ?? [])], 1: [...(incoming.racks?.[1] ?? [])] };
    state.currentTurnSlot = incoming.currentTurnSlot;
    state.turnNumber = incoming.turnNumber;
    state.moveHistory = [...(incoming.moveHistory ?? [])];
    state.activeBoosts = [...(incoming.activeBoosts ?? [])];
    state.bonusBoard = deserializeBonusBoardLocal(incoming.bonusBoard);
    state.bonusAssignment = [...(incoming.bonusAssignment ?? state.bonusAssignment ?? [])];
    state.bonusSqUsed = { ...(incoming.bonusSqUsed ?? state.bonusSqUsed ?? {}) };
    state.pendingBonuses = [...(incoming.pendingBonuses ?? [])];
    state.lockedCells = [...(incoming.lockedCells ?? [])];
    state.lockInventory = {
      0: [...(incoming.lockInventory?.[0] ?? [])],
      1: [...(incoming.lockInventory?.[1] ?? [])],
    };
    state.settings = { ...(incoming.settings ?? {}) };
    state.livePreview = incoming.livePreview ?? null;
    state.turnDeadlineMs = incoming.turnDeadlineMs ?? null;
    state.missedTurns = incoming.missedTurns ?? { 0: 0, 1: 0 };
    state.firstMove = state.moveHistory.length === 0;
    state.status = incoming.status;

    if (last) {
      if (last.type === 'lock') {
        bus.emit(EV.LOCK_PLACED, { slot: last.slot, lock: last.lock });
        bus.emit(EV.LOCKS_CHANGED, { lockedCells: [...(state.lockedCells ?? [])], lockInventory: state.lockInventory });
      } else if (last.type === 'pass') {
        // State was already resynced from the authoritative room snapshot.
      } else if (last.type === 'exchange' || last.type === 'free-exchange') {
        bus.emit(EV.TILES_EXCHANGED, {
          slot: last.slot,
          count: last.count ?? 0,
          free: last.type === 'free-exchange',
        });
      } else {
        bus.emit(EV.OPPONENT_MOVED, {
          slot: last.slot, placed: last.tiles, words: last.words, wordTiles: last.wordTiles, score: last.score,
        });
        bus.emit(EV.SCORE_CHANGED, { slot: last.slot, score: state.scores[last.slot] });
      }
      // free-exchange does not advance the turn; suppress TURN_CHANGED so
      // notification / timer subscribers don't treat it as a new turn.
      if (last.type !== 'free-exchange') {
        bus.emit(EV.TURN_CHANGED, { currentTurnSlot: state.currentTurnSlot, turnNumber: state.turnNumber });
      }
    } else if (
      previousTurnSlot !== state.currentTurnSlot ||
      previousTurnNumber !== state.turnNumber
    ) {
      bus.emit(EV.TURN_CHANGED, {
        currentTurnSlot: state.currentTurnSlot,
        turnNumber: state.turnNumber,
        reason: 'remote-sync',
      });
    }
    // A version-bumped write (e.g. timeout-watchdog forfeit via commitTransaction)
    // may carry a terminal status without going through applyTerminalStatusIfNeeded.
    // Detect the transition here so EV.GAME_COMPLETED always fires on terminal status.
    if (isTerminalStatus(state.status) && state.status !== previousStatus) {
      state.abandonedBy = incoming.abandonedBy ?? state.abandonedBy ?? null;
      state.abandonReason = incoming.abandonReason ?? state.abandonReason ?? null;
      bus.emit(EV.GAME_COMPLETED, {
        status: state.status,
        winnerSlot: null,
        scores: { ...state.scores },
        abandonedBy: state.abandonedBy,
        abandonReason: state.abandonReason,
      });
    }
  });
  subs.push(unwatch);

  function applyTerminalStatusIfNeeded(incoming) {
    if (!isTerminalStatus(incoming?.status) || incoming.status === state.status) return;
    state.status = incoming.status;
    state.abandonedBy = incoming.abandonedBy ?? state.abandonedBy ?? null;
    state.abandonReason = incoming.abandonReason ?? state.abandonReason ?? null;
    bus.emit(EV.GAME_COMPLETED, {
      status: state.status,
      winnerSlot: null,
      scores: { ...state.scores },
      abandonedBy: state.abandonedBy,
      abandonReason: state.abandonReason,
    });
  }

  function start() { engine.start(); }

  function dispatch(cmd) {
    // Refuse commands when it's not our turn (defensive — UI should already gate this)
    if (cmd?.type === CMD.CONFIRM_MOVE && state.currentTurnSlot !== mySlot) return;
    if (cmd?.type === CMD.PASS_TURN && state.currentTurnSlot !== mySlot) return;
    if (cmd?.type === CMD.PLACE_LOCK && state.currentTurnSlot !== mySlot) return;
    engine.dispatch(cmd);
  }

  async function dispose() {
    for (const off of subs) {
      try { off(); } catch { /* swallow */ }
    }
    subs.length = 0;
    try { await leaveRoom(db, room.roomId, room.players[mySlot].uid); } catch { /* swallow */ }
  }

  async function markReady() { await setReady(db, room.roomId, mySlot, true); }

  return {
    state, engine, bus, mode: room.mode, descriptor,
    roomId: room.roomId,
    mySlot,
    start, dispatch, dispose, markReady,
  };

  function commitCurrentState({ lastMove = null } = {}) {
    return commitTransaction(db, room.roomId, expectedVersion, (currentRoom) => {
      const settings = { ...(state.settings ?? currentRoom.settings ?? {}) };
      const turnChanged = Number(currentRoom.currentTurnSlot ?? 0) !== Number(state.currentTurnSlot ?? 0);
      const shouldRunTimer = shouldUseSharedTurnTimer(currentRoom.mode ?? room.mode, settings);
      let turnDeadlineMs = shouldRunTimer ? (state.turnDeadlineMs ?? currentRoom.turnDeadlineMs ?? null) : null;

      if (shouldRunTimer && turnChanged && lastMove?.type !== 'free-exchange') {
        turnDeadlineMs = Date.now() + turnLimitMsFromSettings(settings);
        state.turnDeadlineMs = turnDeadlineMs;
      } else if (!shouldRunTimer) {
        state.turnDeadlineMs = null;
      }

      const missedTurns = normalizeMissedTurns(currentRoom.missedTurns ?? state.missedTurns);
      if (lastMove?.slot === 0 || lastMove?.slot === 1) {
        missedTurns[lastMove.slot] = 0;
      }
      state.missedTurns = { ...missedTurns };

      // Clear livePreview on any turn-rotating commit. The active player's
      // tentative-tile broadcast must not survive past their turn; otherwise
      // the opponent keeps seeing ghost tiles until the next live-preview
      // write overwrites them. Free-exchange doesn't rotate the turn so it
      // leaves the preview untouched.
      const patch = {
        scores: { ...state.scores },
        bag: [...(state.bag ?? [])],
        racks: { 0: [...state.racks[0]], 1: [...state.racks[1]] },
        board: serializeBoardLocal(state.board),
        bonusBoard: serializeBonusBoardLocal(state.bonusBoard),
        moveHistory: [...state.moveHistory],
        currentTurnSlot: state.currentTurnSlot,
        turnNumber: state.turnNumber,
        activeBoosts: [...state.activeBoosts],
        bonusAssignment: [...(state.bonusAssignment ?? [])],
        bonusSqUsed: { ...(state.bonusSqUsed ?? {}) },
        pendingBonuses: [...(state.pendingBonuses ?? [])],
        lockedCells: [...(state.lockedCells ?? [])],
        lockInventory: {
          0: [...(state.lockInventory?.[0] ?? [])],
          1: [...(state.lockInventory?.[1] ?? [])],
        },
        missedTurns,
        turnDeadlineMs,
        settings,
        lastMove,
      };
      if (turnChanged && lastMove?.type !== 'free-exchange') {
        patch.livePreview = null;
      }
      return patch;
    });
  }
}

function isTerminalStatus(status) {
  return status === 'completed' || status === 'abandoned' || status === 'expired';
}

function normalizeMissedTurns(value = {}) {
  return {
    0: Number(value?.[0] ?? value?.['0'] ?? 0) || 0,
    1: Number(value?.[1] ?? value?.['1'] ?? 0) || 0,
  };
}

function serializeBoardLocal(board2d) {
  const flat = new Array(100).fill(null);
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const t = board2d[r][c];
      if (t) flat[r * 10 + c] = { letter: t.letter, val: t.val, isJoker: !!t.isJoker };
    }
  }
  return flat;
}

function serializeBonusBoardLocal(bonusBoard) {
  if (bonusBoard instanceof Map) return Object.fromEntries(bonusBoard.entries());
  return { ...(bonusBoard ?? {}) };
}

function deserializeBonusBoardLocal(value) {
  return new Map(Object.entries(value ?? {}));
}

function applyOpponentMove(state, lastMove) {
  for (const t of lastMove.tiles) {
    setCommittedTile(state, t.r, t.c, { letter: t.letter, val: t.val, isJoker: !!t.isJoker });
  }
  state.moveHistory.push(lastMove);
  state.firstMove = false;
}
