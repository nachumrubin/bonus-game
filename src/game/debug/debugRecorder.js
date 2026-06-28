// Game Debug Timeline — the recorder (integration glue).
//
// One global instance, mounted once at boot. It (re)initialises per game on
// EV.GAME_STARTED by reading the active game, then:
//   • translates bus events into an append-only event timeline (/gameEvents),
//   • writes this device's own local view to /clientSnapshots (deduped),
//   • for online games, watches the room doc and writes the server-authoritative
//     /gameSnapshots per version plus /debugWarnings from the state validator,
//   • keeps an in-memory ring buffer of recent actions + the last event id, used
//     by the manual "report a problem" payload.
//
// ALL debug writes are best-effort (debugLogger swallows failures) so debug
// recording can never disrupt gameplay. This module is the ONLY place that
// knows how to map gameplay → debug data.

import { EV } from '../../events/eventTypes.js';
import { DEBUG_EVENT } from './debugSchema.js';
import { compactSnapshot, hashState } from './stateHash.js';
import { validateTransition } from './gameStateValidator.js';
import {
  logGameEvent, createGameSnapshot, putClientSnapshot, createDebugWarning,
  upsertGameIndex, appVersion as readAppVersion, platformInfo,
} from './debugLogger.js';

const RING_MAX = 30;

// Renderable subset stored in each snapshot so the replay tool can draw the board.
function renderable(state = {}) {
  return {
    status: state.status ?? null,
    board: state.board ?? null,
    scores: state.scores ?? null,
    racks: state.racks ?? null,
    currentTurnSlot: state.currentTurnSlot ?? null,
    turnNumber: state.turnNumber ?? null,
    lastMove: state.lastMove ?? null,
    players: state.players ?? null,
  };
}

export function mountDebugRecorder({
  bus,
  getDb = () => null,
  getActiveGame = () => globalThis.__spine?.activeGame ?? null,
  getMinAppVersion = () => null,
  watchRoom = null,         // injected roomService.watchRoom; null disables server capture
} = {}) {
  if (!bus) throw new Error('mountDebugRecorder: bus required');

  let ctx = null;          // per-game context
  let lastActions = [];
  let lastEventId = null;
  let lastClientHash = null;
  let prevServerCompact = null;
  let lastServerVersion = null;
  let unwatch = null;

  const subs = [];
  const on = (type, fn) => subs.push(bus.on(type, (p) => { try { fn(p); } catch (e) { console.warn('[debug] handler', type, e?.message ?? e); } }));

  function env() {
    return { appVersion: readAppVersion(), ...platformInfo() };
  }

  function pushAction(type, summary) {
    lastActions.push({ type, summary, at: Date.now() });
    if (lastActions.length > RING_MAX) lastActions.shift();
  }

  function record(type, { summary = '', payload = null, userId = null, playerName = null, turnNumber = null } = {}) {
    pushAction(type, summary);
    const db = getDb();
    if (!db || !ctx?.gameId) return;
    const e = env();
    Promise.resolve(logGameEvent(db, ctx.gameId, {
      type, summary, payload, userId, playerName, turnNumber,
      slot: ctx.mySlot, appVersion: e.appVersion, platform: e.platform, deviceInfo: e.deviceInfo,
    })).then((id) => { if (id) lastEventId = id; });
  }

  function writeClientSnapshot(state) {
    if (!state) return;
    const h = hashState(state);
    if (h === lastClientHash) return;           // only on a real visible change
    lastClientHash = h;
    const db = getDb();
    if (!db || !ctx?.gameId || (ctx.mySlot !== 0 && ctx.mySlot !== 1)) return;
    const e = env();
    putClientSnapshot(db, ctx.gameId, ctx.mySlot, {
      ...renderable(state),
      compact: compactSnapshot(state),
      hash: h,
      believedVersion: lastServerVersion,
      appVersion: e.appVersion,
    });
  }

  // ── Per-game lifecycle ───────────────────────────────────────────
  function startGame() {
    teardownGame();
    const ag = getActiveGame();
    const session = ag?.session ?? null;
    ctx = {
      gameId: session?.roomId ?? null,        // online only; null for offline/bot
      mySlot: session?.mySlot ?? ag?.mySlot ?? null,
      online: !!ag?.online,
      getState: () => session?.state ?? null,
    };
    lastActions = []; lastEventId = null; lastClientHash = null;
    prevServerCompact = null; lastServerVersion = null;

    const state = ctx.getState();
    record(DEBUG_EVENT.GAME_STARTED, { summary: 'Game started', turnNumber: state?.turnNumber });
    if (getDb() && ctx.gameId) {
      const p = state?.players ?? {};
      upsertGameIndex(getDb(), ctx.gameId, {
        hostName: p?.[0]?.displayName ?? null, guestName: p?.[1]?.displayName ?? null,
        hostUid: p?.[0]?.uid ?? null, guestUid: p?.[1]?.uid ?? null,
        status: state?.status ?? 'playing', mode: ag?.mode ?? null,
        appVersion: readAppVersion(), createdAt: Date.now(),
      });
    }
    writeClientSnapshot(state);

    if (ctx.online && ctx.gameId && typeof watchRoom === 'function') {
      unwatch = watchRoom(getDb(), ctx.gameId, (room) => { try { onServerRoom(room); } catch (e) { console.warn('[debug] onServerRoom', e?.message ?? e); } });
    }
  }

  function onServerRoom(room) {
    if (!room || room.version == null) return;
    if (room.version === lastServerVersion) return;
    lastServerVersion = room.version;
    const db = getDb();
    const serverCompact = compactSnapshot(room);
    const serverHash = hashState(serverCompact);

    if (db && ctx?.gameId) {
      createGameSnapshot(db, ctx.gameId, room.version, {
        ...renderable(room), compact: serverCompact, hash: serverHash, version: room.version,
      });

      // Server-state validation. Only the host (slot 0) writes these so a
      // stored-state anomaly isn't duplicated by both clients. Per-client
      // mismatch is surfaced later by the admin tool comparing the two streams.
      if (ctx.mySlot === 0) {
        const expectedDelta = Number.isFinite(room.lastMove?.score) ? Number(room.lastMove.score) : undefined;
        const warnings = validateTransition(prevServerCompact, serverCompact, {
          expectedDelta,
          appVersion: room.lastMove?.appVersion ?? null,
          minAppVersion: getMinAppVersion(),
        });
        for (const w of warnings) {
          createDebugWarning(db, ctx.gameId, { ...w, version: room.version });
        }
      }
    }
    prevServerCompact = serverCompact;
  }

  function teardownGame() {
    if (unwatch) { try { unwatch(); } catch { /* swallow */ } unwatch = null; }
    ctx = null;
  }

  // ── Bus capture ──────────────────────────────────────────────────
  on(EV.GAME_STARTED, () => startGame());

  on(EV.MOVE_CONFIRMED, (p = {}) => {
    if (!ctx) return;
    const state = ctx.getState();
    const slot = p.slot;
    const name = state?.players?.[slot]?.displayName ?? `שחקן ${(slot ?? 0) + 1}`;
    const last = state?.moveHistory?.[state.moveHistory.length - 1];
    const words = Array.isArray(last?.words) ? last.words : [];
    const userId = state?.players?.[slot]?.uid ?? null;
    record(DEBUG_EVENT.WORD_SUBMITTED, { summary: `${name} submitted a move`, payload: { placed: p.placed }, userId, playerName: name, turnNumber: state?.turnNumber });
    record(DEBUG_EVENT.WORD_ACCEPTED, { summary: `${name} played ${words.join(', ') || '—'} for ${p.score} points`, payload: { words, score: p.score, scoringDeferred: !!p.scoringDeferred }, userId, playerName: name, turnNumber: state?.turnNumber });
    record(DEBUG_EVENT.SCORE_CHANGED, { summary: `Score: host ${state?.scores?.[0]} – guest ${state?.scores?.[1]}`, payload: { scores: state?.scores } });
    writeClientSnapshot(state);
  });

  on(EV.INVALID_MOVE_REJECTED, (p = {}) => {
    if (!ctx) return;
    record(DEBUG_EVENT.WORD_REJECTED, { summary: `Move rejected: ${p.reason}`, payload: { reason: p.reason, placed: p.placed, invalidWords: p.invalidWords } });
  });

  on(EV.TURN_CHANGED, (p = {}) => {
    if (!ctx) return;
    const state = ctx.getState();
    const name = state?.players?.[p.currentTurnSlot]?.displayName ?? `שחקן ${(p.currentTurnSlot ?? 0) + 1}`;
    record(DEBUG_EVENT.TURN_CHANGED, { summary: `Turn → ${name} (turn ${p.turnNumber})`, payload: { currentTurnSlot: p.currentTurnSlot, turnNumber: p.turnNumber, reason: p.reason }, turnNumber: p.turnNumber });
    writeClientSnapshot(state);
  });

  on(EV.TILES_EXCHANGED, (p = {}) => {
    if (!ctx) return;
    record(DEBUG_EVENT.TILES_SWAPPED, { summary: `Exchanged ${p.count} tile(s)${p.free ? ' (free)' : ''}`, payload: p });
    writeClientSnapshot(ctx.getState());
  });

  on(EV.LOCK_PLACED, (p = {}) => {
    if (!ctx) return;
    record(DEBUG_EVENT.LOCK_PLACED, { summary: `Lock placed at (${p.lock?.r},${p.lock?.c})`, payload: p });
    writeClientSnapshot(ctx.getState());
  });

  on(EV.BOOST_ACTIVATED, (p = {}) => {
    if (!ctx) return;
    record(DEBUG_EVENT.BOOST_ACTIVATED, { summary: `Boost ${p.boostId}`, payload: p });
  });

  on(EV.OPPONENT_MOVED, () => { if (ctx) writeClientSnapshot(ctx.getState()); });

  on(EV.GAME_COMPLETED, (p = {}) => {
    if (!ctx) return;
    const state = ctx.getState();
    const resigned = p.abandonedBy === 0 || p.abandonedBy === 1;
    record(resigned ? DEBUG_EVENT.PLAYER_RESIGNED : DEBUG_EVENT.GAME_ENDED, {
      summary: resigned ? `Slot ${p.abandonedBy} left (${p.abandonReason ?? 'resign'})` : `Game ended (winner: ${p.winnerSlot})`,
      payload: { status: p.status, winnerSlot: p.winnerSlot, scores: p.scores, abandonedBy: p.abandonedBy, abandonReason: p.abandonReason },
    });
    writeClientSnapshot(state);
    if (getDb() && ctx.gameId) upsertGameIndex(getDb(), ctx.gameId, { status: p.status ?? 'completed' });
  });

  on('game/paused', () => { if (ctx) record(DEBUG_EVENT.GAME_PAUSED, { summary: 'Game paused' }); });
  on('game/resumed', () => { if (ctx) record(DEBUG_EVENT.GAME_RESUMED, { summary: 'Game resumed' }); });

  // ── Public surface (for the report button + error capture) ───────
  function getLastActions() { return lastActions.slice(); }
  function getLastEventId() { return lastEventId; }
  function getContext() { return ctx ? { gameId: ctx.gameId, mySlot: ctx.mySlot, online: ctx.online } : null; }
  function localSnapshot() { return ctx ? compactSnapshot(ctx.getState()) : null; }
  // Log an error/event from outside (window.onerror, manual report flows).
  function recordError(summary, payload) { record(DEBUG_EVENT.ERROR_OCCURRED, { summary, payload }); }

  function dispose() {
    teardownGame();
    for (const off of subs) { try { off(); } catch { /* swallow */ } }
    subs.length = 0;
  }

  return { dispose, getLastActions, getLastEventId, getContext, localSnapshot, recordError };
}
