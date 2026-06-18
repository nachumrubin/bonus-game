// gameController — pure view-model layer for the active game.
//
// Subscribes to the bus and maintains an in-memory snapshot of "what should
// the UI show right now" derived from engine state + events. The actual DOM
// rendering reads this view-model and reflects it; the controller never
// imports `document` itself (that's domHelpers' job).
//
// Why a view-model rather than just reading state directly?
//   - Lets us pre-compute display strings (turn label, score formatting)
//     once instead of per-render-frame.
//   - Lets renderer code be a pure function of view-model → DOM, easy to
//     re-render after a hot reload or a screen change.
//   - Makes the controller fully testable in Node — no jsdom required.
//
// The view-model is intentionally read-only from outside. UI code calls
// dispatch(cmd) to send intents; the controller forwards them through the
// session.

import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { HV } from '../../game/core/letterDistribution.js';

export function createGameController({ bus, session, mySlot = null }) {
  if (!bus) throw new Error('createGameController: bus required');
  if (!session) throw new Error('createGameController: session required');

  const view = {
    mySlot,
    isMyTurn: false,
    currentTurnSlot: null,
    turnNumber: 0,
    scores: { 0: 0, 1: 0 },
    rackForMe: [],
    // Inactive player's rack for the offline-2p "show both racks" toggle.
    // null in all other modes; see syncFromState.
    rackForOpponent: null,
    opponentSlot: null,
    opponentName: null,
    bagRemaining: 0,
    status: 'playing',
    lastMove: null,
    lastInvalidReason: null,
    placed: [],          // tiles the human has placed but not confirmed
    swappedTiles: [],    // pending tile swaps (committed tile ⇄ rack tile)
    placementDirection: 'H',
    lockedCells: [],
    lockInventory: { 0: [], 1: [] },
    activeBoosts: [],
    // Tentative lock placement awaiting the player's Confirm tap. Same
    // pending-until-שבץ semantics as `placed` tiles: shown on the board with
    // a "preview" style, removable by tapping again or via the Recall (בטל)
    // button, only dispatched to the engine via CMD.PLACE_LOCK when the user
    // confirms the move. Mutex with `placed` — locking and tile-placement
    // are alternative move types in a single turn.
    pendingLock: null,   // { r, c, duration } | null
  };

  function syncFromState() {
    const s = session.state;
    view.currentTurnSlot = s.currentTurnSlot;
    view.turnNumber = s.turnNumber;
    view.scores = { ...s.scores };
    if (mySlot != null) {
      view.rackForMe = [...(s.racks[mySlot] ?? [])];
      view.isMyTurn = s.currentTurnSlot === mySlot;
    } else {
      // Hot-seat 2P or solo: the "active" rack is just the current turn's rack
      view.rackForMe = [...(s.racks[s.currentTurnSlot] ?? [])];
      view.isMyTurn = true;
    }
    // Inactive-player rack peek. Surfaced for the offline-2p "show both
    // racks" toggle (state.settings.showBothRacks). Bot games NEVER expose
    // the bot's rack — the setup screen forces showBothRacks=false there,
    // but we also guard here defensively. Online games (mySlot != null)
    // also don't expose the opponent's rack — that would leak info to the
    // other client.
    if (mySlot == null
        && s.settings?.showBothRacks
        && s.mode === 'offline-2p'
        && (s.currentTurnSlot === 0 || s.currentTurnSlot === 1)) {
      const otherSlot = 1 - s.currentTurnSlot;
      view.rackForOpponent = [...(s.racks[otherSlot] ?? [])];
      view.opponentSlot = otherSlot;
      view.opponentName = s.players?.[otherSlot]?.displayName ?? `שחקן ${otherSlot + 1}`;
    } else {
      view.rackForOpponent = null;
      view.opponentSlot = null;
      view.opponentName = null;
    }
    view.bagRemaining = s.bag?.length ?? 0;
    view.status = s.status;
    // Expose player profile info (name + avatar) so renderers can draw the
    // active player chips, end-game card etc. without diving into session.
    view._players = s.players ?? null;
    // Expose the live 2D board reference so renderers can read tiles.
    // The reference is shared with the engine — read-only by convention.
    view._board = s.board;
    // Off-grid perimeter bonus-square placements live in state.bonusBoard
    // (a Map keyed "r,c"). Expose the live reference so renderBoard can
    // show tiles that landed on perimeter bonus cells.
    view._bonusBoard = s.bonusBoard;
    // Expose turnDeadlineMs for live-mode timer rendering. Online sessions
    // populate this from the room; offline / untimed games leave it null.
    view._turnDeadlineMs = s.turnDeadlineMs ?? null;
    view._livePreview = s.livePreview ?? null;
    view.lockedCells = Array.isArray(s.lockedCells) ? s.lockedCells.map(copyLock) : [];
    view.lockInventory = {
      0: [...(s.lockInventory?.[0] ?? [])],
      1: [...(s.lockInventory?.[1] ?? [])],
    };
    view.activeBoosts = Array.isArray(s.activeBoosts) ? s.activeBoosts.map(b => ({ ...b, payload: { ...(b.payload ?? {}) } })) : [];
  }

  // Initialise immediately from current state
  syncFromState();

  const subs = [];
  // Set to true by MOVE_CONFIRMED / MOVE_SCORE_COMMITTED / OPPONENT_MOVED
  // (all tile-placement paths) so TURN_CHANGED can tell whether tiles were
  // actually placed this turn. If it fires false, the turn was a pass,
  // exchange, or timeout — clear the last-move highlight accordingly.
  let tilesMoved = false;
  subs.push(bus.on(EV.GAME_STARTED, () => { syncFromState(); _onChange(); }));
  subs.push(bus.on(EV.MOVE_CONFIRMED, ({ slot, score, words, wordTiles, placed, baseScore, bonusExtra }) => {
    tilesMoved = true;
    syncFromState();
    view.lastMove = {
      slot, score, words, wordTiles: wordTiles ?? [], placed: placed ?? [],
      baseScore: baseScore ?? score ?? 0,
      bonusExtra: bonusExtra ?? 0,
    };
    view.lastInvalidReason = null;
    view.placed = [];
    view.swappedTiles = [];
    view.pendingLock = null;
    _onChange();
  }));
  subs.push(bus.on(EV.MOVE_SCORE_COMMITTED, ({ slot, score, words, wordTiles, placed, baseScore, bonusExtra }) => {
    tilesMoved = true;
    syncFromState();
    view.lastMove = {
      slot, score, words, wordTiles: wordTiles ?? [], placed: placed ?? [],
      baseScore: baseScore ?? score ?? 0,
      bonusExtra: bonusExtra ?? 0,
    };
    view.lastInvalidReason = null;
    _onChange();
  }));
  subs.push(bus.on(EV.OPPONENT_MOVED, ({ slot, score, words, wordTiles, placed, baseScore, bonusExtra }) => {
    tilesMoved = true;
    syncFromState();
    view.lastMove = {
      slot, score, words, wordTiles: wordTiles ?? [], placed: placed ?? [],
      baseScore: baseScore ?? score ?? 0,
      bonusExtra: bonusExtra ?? 0,
    };
    _onChange();
  }));
  subs.push(bus.on(EV.SCORE_CHANGED, () => { syncFromState(); _onChange(); }));
  subs.push(bus.on(EV.TURN_CHANGED, () => {
    syncFromState();
    // Any pending placement belongs to the turn that just ended (the
    // confirm path already cleared on MOVE_CONFIRMED; if we got here some
    // other way — timeout auto-pass, manual pass, exchange, lock — the
    // tiles should snap back to the rack rather than sit on the board
    // until the player's next turn).
    view.placed = [];
    view.swappedTiles = [];
    view.pendingLock = null;
    // Clear the last-move highlight when no tiles were placed this turn
    // (pass, exchange, timeout). If tilesMoved is true, MOVE_CONFIRMED or
    // OPPONENT_MOVED already set view.lastMove with the new coords so the
    // highlight should stay.
    if (!tilesMoved && view.lastMove) view.lastMove = { ...view.lastMove, placed: [] };
    tilesMoved = false;
    _onChange();
  }));
  subs.push(bus.on(EV.INVALID_MOVE_REJECTED, ({ reason }) => {
    view.lastInvalidReason = reason;
    _onChange();
    // Illegal-word rejections forfeit the turn: after the shake + red-pulse
    // animation finishes, clear the tentative placement and pass. Other
    // reasons (has-gaps, not-connected, word-too-short, …) leave the move
    // in place so the user can correct it and re-submit.
    if (reason === 'word-not-in-dictionary') {
      // Capture the turn at rejection time. If the turn-timer fires and
      // auto-passes during the 1100 ms shake animation, we must NOT issue
      // a second PASS_TURN — that would advance the turn an extra time and
      // give the player (or bot) a free extra turn.
      const rejectedTurnKey = `${session.state?.turnNumber}:${session.state?.currentTurnSlot}`;
      setTimeout(() => {
        view.placed = [];
        _onChange();
        const nowKey = `${session.state?.turnNumber}:${session.state?.currentTurnSlot}`;
        if (nowKey !== rejectedTurnKey) return;
        try { session.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'illegal-word' } }); }
        catch (e) { console.warn('[gameController] auto-pass after illegal word failed', e); }
      }, 1100);
    }
  }));
  subs.push(bus.on(EV.GAME_COMPLETED, () => { syncFromState(); _onChange(); }));
  subs.push(bus.on(EV.TILES_EXCHANGED, () => { syncFromState(); _onChange(); }));
  subs.push(bus.on(EV.BOOST_ACTIVATED, () => { syncFromState(); _onChange(); }));
  subs.push(bus.on(EV.LIVE_PREVIEW_CHANGED, () => { syncFromState(); _onChange(); }));
  subs.push(bus.on(EV.LOCK_PLACED, () => { syncFromState(); view.lastInvalidReason = null; view.placed = []; view.pendingLock = null; _onChange(); }));
  subs.push(bus.on(EV.LOCKS_CHANGED, () => { syncFromState(); _onChange(); }));

  // Listeners that the renderer registers to know when to re-paint.
  const changeListeners = new Set();
  function _onChange() { for (const fn of changeListeners) { try { fn(view); } catch { /* swallow */ } } }
  function onChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); }

  // Mutators for tentative placement state (only the human's UI uses these).
  function placeTile({ r, c, letter, val, isJoker = false, rackIndex = null }) {
    if (isLockedCell(r, c) || boardTileAt(r, c)) {
      view.lastInvalidReason = isLockedCell(r, c) ? 'cell-locked' : 'cell-occupied';
      _onChange();
      return false;
    }
    view.placed.push({ r, c, letter, val, isJoker, rackIndex });
    _onChange();
    return true;
  }
  function recallTile(r, c) {
    view.placed = view.placed.filter(p => !(p.r === r && p.c === c));
    view.swappedTiles = view.swappedTiles.filter(s => !(s.r === r && s.c === c));
    // Same cell could be holding a pending lock — clear that too.
    if (view.pendingLock && view.pendingLock.r === r && view.pendingLock.c === c) {
      view.pendingLock = null;
    }
    _onChange();
  }
  function recallAll() {
    view.placed = [];
    view.swappedTiles = [];
    view.pendingLock = null;
    _onChange();
  }

  // Tentative lock placement (pending-until-Confirm). Mirrors placeTile's UX:
  // visual preview only, no engine dispatch yet. Tapping the SAME cell again
  // toggles the pending lock off, so misclicks are reversible without going
  // to the Recall button.
  function setPendingLock({ r, c, duration }) {
    if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
    if (r < 0 || r > 9 || c < 0 || c > 9) return false;
    if (isLockedCell(r, c) || boardTileAt(r, c)) {
      view.lastInvalidReason = isLockedCell(r, c) ? 'lock-cell-already-locked' : 'lock-cell-occupied';
      _onChange();
      return false;
    }
    const inventory = [...(view.lockInventory?.[mySlot ?? view.currentTurnSlot] ?? [])].filter(n => Number.isInteger(Number(n)) && Number(n) > 0);
    const chosen = Number(duration);
    if (!inventory.includes(chosen)) {
      view.lastInvalidReason = 'lock-unavailable';
      _onChange();
      return false;
    }
    // Tapping the same cell again removes the pending lock — same UX as
    // tapping a placed tile to recall it. Duration mismatch doesn't matter:
    // the user expects "tap to clear" regardless of which duration is
    // currently smallest in the inventory.
    if (view.pendingLock
        && view.pendingLock.r === r
        && view.pendingLock.c === c) {
      view.pendingLock = null;
      _onChange();
      return true;
    }
    view.pendingLock = { r, c, duration: chosen };
    _onChange();
    return true;
  }
  function clearPendingLock() {
    if (!view.pendingLock) return;
    view.pendingLock = null;
    _onChange();
  }
  // Swap a committed board tile with a rack tile. Adds a pending entry to
  // view.swappedTiles; the actual board / rack mutation happens on the
  // engine when confirmMove dispatches.
  function swapBoardTile({ r, c, letter, val, isJoker = false, rackIndex = null }) {
    const committed = boardTileAt(r, c);
    if (!committed) {
      view.lastInvalidReason = 'swap-no-tile';
      _onChange();
      return false;
    }
    if (isLockedCell(r, c)) {
      view.lastInvalidReason = 'cell-locked';
      _onChange();
      return false;
    }
    // Replace any previous pending swap on the same cell.
    view.swappedTiles = view.swappedTiles.filter(s => !(s.r === r && s.c === c));
    view.swappedTiles.push({
      r, c,
      letter, val, isJoker,
      rackIndex,
      oldLetter: committed.letter,
      oldVal:    committed.val,
      oldIsJoker: !!committed.isJoker,
    });
    _onChange();
    return true;
  }
  function unswapBoardTile(r, c) {
    view.swappedTiles = view.swappedTiles.filter(s => !(s.r === r && s.c === c));
    _onChange();
  }
  function setPlacementDirection(direction) {
    view.placementDirection = direction === 'V' ? 'V' : 'H';
    _onChange();
  }

  // Command dispatchers. UI buttons call these.
  function confirmMove() {
    // Pending lock takes the same Confirm path as a tile placement — when
    // the player tapped an empty cell with no rack tile selected, the lock
    // sat in view.pendingLock as a preview; שבץ commits it. Tile placement
    // and lock placement are mutually exclusive in a turn (engine doesn't
    // combine them); we treat pendingLock and `placed` as alternative
    // commit paths.
    if (view.pendingLock && !view.placed.length) {
      if (mySlot != null && view.currentTurnSlot !== mySlot) {
        view.pendingLock = null;
        view.lastInvalidReason = 'turn-already-passed';
        _onChange();
        return false;
      }
      const pl = view.pendingLock;
      session.dispatch({ type: CMD.PLACE_LOCK, payload: { r: pl.r, c: pl.c, duration: pl.duration } });
      // pendingLock is cleared by the EV.LOCK_PLACED subscriber if the
      // engine accepted it; INVALID_MOVE_REJECTED leaves it sitting so
      // the user can see what failed and either move or recall it.
      return true;
    }
    if (!view.placed.length) return false;
    // Race guard: if the timer auto-passed us (or the engine otherwise
    // advanced the turn) between the moment the player tapped "שבץ" and
    // this dispatch, the engine would happily apply the tiles as the
    // OTHER player's move. Refuse: clear the pending placement so the
    // tiles "vanish" rather than steal the wrong player's turn.
    if (mySlot != null && view.currentTurnSlot !== mySlot) {
      view.placed = [];
      view.swappedTiles = [];
      view.lastInvalidReason = 'turn-already-passed';
      _onChange();
      return false;
    }
    session.dispatch({
      type: CMD.CONFIRM_MOVE,
      payload: {
        placed: [...view.placed],
        swappedTiles: view.swappedTiles.map(s => ({
          r: s.r, c: s.c, letter: s.letter, val: s.val, isJoker: !!s.isJoker,
        })),
      },
    });
    return true;
  }
  function passTurn() {
    session.dispatch({ type: CMD.PASS_TURN });
  }
  function exchangeTiles(letters, { freeSwap = false } = {}) {
    session.dispatch({
      type: CMD.EXCHANGE_TILE,
      payload: { letters: [...letters], freeSwap: !!freeSwap },
    });
  }
  function resign() {
    session.dispatch({ type: CMD.RESIGN_GAME, payload: { slot: view.currentTurnSlot } });
  }
  function placeLock({ r, c, duration }) {
    session.dispatch({ type: CMD.PLACE_LOCK, payload: { r, c, duration } });
  }
  function finalizeBoostAward({ slot, extra, bonusIdx } = {}) {
    session.dispatch({ type: CMD.FINALIZE_BOOST_AWARD, payload: { slot, extra, bonusIdx } });
  }

  function isLockedCell(r, c) {
    return view.lockedCells.some(lock => lock.r === r && lock.c === c && (lock.remainingTurns ?? 0) > 0);
  }

  function boardTileAt(r, c) {
    if (r >= 0 && r < 10 && c >= 0 && c < 10) {
      return view._board?.[r]?.[c] ?? null;
    }
    // Off-grid perimeter (bonus square) coords live in state.bonusBoard.
    return view._bonusBoard?.get?.(`${r},${c}`) ?? null;
  }

  // Return the letter/value/joker info that should be VISIBLE in rack slot
  // `i` right now, accounting for pending swaps. When a player swaps a board
  // tile with rack[i], the displaced letter is shown at slot i immediately so
  // it can be played in the same turn — mirrors legacy `racks[turn][rackSlot]
  // = returnedLetter`. Returns null when the slot is empty (or consumed by a
  // pending placement).
  function displayRackTile(i) {
    if (!Number.isInteger(i)) return null;
    if (view.placed.some(p => p.rackIndex === i)) return null;
    const swap = view.swappedTiles.find(s => s?.rackIndex === i);
    if (swap) {
      const isJoker = !!swap.oldIsJoker;
      return {
        letter: isJoker ? '?' : (swap.oldLetter ?? null),
        val: Number(swap.oldVal) || 0,
        isJoker,
      };
    }
    const letter = view.rackForMe?.[i];
    if (!letter) return null;
    const isJoker = letter === '?';
    return { letter, isJoker, val: isJoker ? 0 : (HV[letter] ?? 0) };
  }

  function dispose() {
    for (const off of subs) try { off(); } catch { /* swallow */ }
    subs.length = 0;
    changeListeners.clear();
  }

  return {
    view,
    onChange,
    placeTile, recallTile, recallAll, setPlacementDirection,
    swapBoardTile, unswapBoardTile,
    displayRackTile,
    confirmMove, passTurn, exchangeTiles, resign,
    setPendingLock, clearPendingLock,
    // Legacy direct-dispatch lock — kept for back-compat with anything that
    // hasn't migrated to the pending-then-confirm flow (the gameScreen UI
    // uses setPendingLock now). Bypasses the preview state.
    placeLock,
    finalizeBoostAward,
    dispose,
  };
}

function copyLock(lock) {
  return {
    id: lock.id,
    r: Number(lock.r),
    c: Number(lock.c),
    ownerSlot: lock.ownerSlot,
    remainingTurns: Number(lock.remainingTurns ?? 0),
  };
}
