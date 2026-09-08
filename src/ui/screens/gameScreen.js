// gameScreen — wires the legacy game-board DOM in [index.html](index.html)
// to the new-spine controllers.
//
// DOM IDs the screen reads/writes (verified against current index.html):
//   #sg                 game screen container
//   #game-grid          12×12 unified grid (built by buildUnifiedGrid())
//   #c{r}_{c}           regular play cell, 0..9 × 0..9
//   #bsq-{idx}          off-grid bonus square, 0..11
//   #brack              rack container; child .bt2 elements are built here
//   #btn-play           confirm-move button
//   #btn-recall         recall-tiles button
//   #btn-exchange       exchange button
//   #ov-exch / #exch-rack exchange overlay
//   #sv1, #sv2          score values
//   #sn1, #sn2          player name labels
//   #is-sv1, #is-sv2    mobile info-strip duplicates
//   #is-sn1, #is-sn2    mobile player-name duplicates
//   #sbar               status bar text
//   #bag-count-text     remaining-tiles count
//   #turn-name          right-panel "whose turn" label
//   #sb1, #sb2          score box containers (`act` class marks active)
//   #is-sb1, #is-sb2    mobile equivalents
//
// The tile HTML structure mirrors legacy renderBoard() / renderRack() so
// the existing CSS keyframes and layout rules apply unchanged.

import { $, on, setText, setClass, bonusOverlayOpen, flashAnimation } from '../domHelpers.js';
import { setAvatarEl } from './avatarScreens.js';
import { g, applyGenderToRoot, getGender } from '../genderText.js';
import { SETTINGS_CHANGED } from './settingsScreen.js';
import { HV } from '../../game/core/letterDistribution.js';
import { LOCK_POINT_COST } from '../../game/core/turnManager.js';
import { BDEFS } from '../../game/boosts/data.js';
import { EV } from '../../events/eventTypes.js';
import { BOOST_IGNITION_DURATION_MS, BOOST_RESULT_READY } from '../boostPresentation.js';
import {
  WORD_MERGE_STAGGER_MS as SCORE_MERGE_WORD_STAGGER_MS,
  WORD_MERGE_FLIGHT_MS  as SCORE_MERGE_WORD_FLIGHT_MS,
  HOLD_AFTER_MERGE_MS   as SCORE_MERGE_HOLD_AFTER_MS,
  SUM_FLIGHT_MS         as SCORE_MERGE_SUM_FLIGHT_MS,
  SUM_CHIP_HOLD_MS,
  countUpDurationMs,
  mergeSequenceTiming,
  scoreSequenceLandingMs,
  scoreInteractionGateMs,
} from '../scoreAnimationTimings.js';

export const GAME_SCREEN_INTENT = Object.freeze({
  LIVE_PREVIEW_CHANGED: 'gameScreen/livePreviewChanged',
  OPEN_EXCHANGE: 'gameScreen/openExchange',
});

const COMPUTER_NAME_HE = '\u05D4\u05DE\u05D7\u05E9\u05D1';

// How long the lock's \u221210 chip takes to fly from the board into the score
// panel. The score count-down is held for this long so the number and the
// chip land together.
const LOCK_COST_FLIGHT_MS = 520;
let nextScorePresentationId = 0;

// Map from (r,c) to the cell DOM id legacy uses.
function cellIdFor(r, c) {
  if (r >= 0 && r < 10 && c >= 0 && c < 10) return `c${r}_${c}`;
  // Bonus squares — find their idx in BDEFS-order (legacy used br=-1/10, bc=-1/10).
  // We don't import BDEFS here to avoid a cycle; instead the caller passes
  // bonusBoardLookup if it ever needs to query them. For now: only play
  // cells get clicks via this screen; bonus squares are activated by the
  // resolver layer, not direct clicks.
  return null;
}

// `resolveAvatar(uid) => Promise<avatar|null>` (optional): looks up a player's
// CURRENT avatar, so the identity strip doesn't render the copy frozen into the
// room document at invite time. Omitted → the stored room avatar is used as-is.
export function mountGameScreen({ controller, animationController, jokerPicker = null, bus = null, resolveAvatar = null, root = globalThis.document, prefersReducedMotion = () => false }) {
  if (!controller) throw new Error('mountGameScreen: controller required');

  const cleanups = [];
  const boostSquareCues = new Map();
  const boostSquareKey = b => `${b.slot}:${b.bonusIdx}`;
  const revealedBoostSquares = new Set((controller.view.activeBoosts ?? []).map(boostSquareKey));
  function clearBoostSquareCues({ slot } = {}) {
    for (const [idx, cue] of boostSquareCues) {
      if (slot != null && cue.slot !== slot) continue;
      cue.clear();
      boostSquareCues.delete(idx);
    }
  }
  if (bus) {
    cleanups.push(bus.on(BOOST_RESULT_READY, payload => {
      revealedBoostSquares.add(boostSquareKey(payload));
      renderMultiplierBanner(controller.view);
    }));
    cleanups.push(bus.on('bonus/aborted', clearBoostSquareCues));
    cleanups.push(bus.on('bonus/aborted', ({ slot } = {}) => {
      for (const key of revealedBoostSquares) if (slot == null || key.startsWith(`${slot}:`)) revealedBoostSquares.delete(key);
    }));
    cleanups.push(bus.on(EV.GAME_COMPLETED, () => clearBoostSquareCues()));
    cleanups.push(bus.on(EV.GAME_STARTED, () => clearBoostSquareCues()));
  }
  // uid → current avatar (null = looked up, none found). Populated lazily by
  // requestLiveAvatar; a cached null stops us re-fetching a missing profile.
  const liveAvatarByUid = new Map();
  const avatarLookupsInFlight = new Set();
  let disposed = false;
  let selectedRackIndex = null;
  let pendingJokerPlacement = null;        // { r, c } awaiting letter pick
  let jokerPickedSub = null;
  let jokerCancelledSub = null;
  let lastRackSignature = '';
  let animateNextRackRender = false;
  let lastOwnPreviewSignature = '';
  // Which lock in the box the player has picked, as { index, duration }. The
  // index is into the DISPLAYED inventory (see displayLockInventory) so that a
  // box holding duplicate durations — the default is [3, 3, 5] — glows exactly
  // the one that was clicked rather than every button sharing its number.
  let selectedLock = null;
  // Rack indices that received a freshly-drawn tile from the bag on the
  // most recent EXCHANGE. Drives the .bt2-just-arrived class so the user
  // can see which tiles are new. Cleared 2s after the exchange — the
  // timeout is tracked so a second exchange resets it cleanly.
  let recentlyArrivedRackIdxs = new Set();
  let recentlyArrivedClearTimer = null;
  // One-shot "just placed tentatively" board coords ("r,c"). renderBoard injects
  // the tile-tentative-in entrance class the first time it paints each coord,
  // then consumes it — so the settle plays exactly once, on the placement render,
  // and never re-fires on an unrelated board re-render. (Phase 3A.)
  const tentativeEntryCoords = new Set();
  // One-shot rack indices a single tentative tile just returned to. renderRack
  // injects the bt2-returned settle onto that slot, then the set is cleared.
  const returnedRackIdxs = new Set();
  // (r, c) of a pending tile currently highlighted on the board. Click-to-
  // select / click-again-to-recall semantics. Cleared on confirm, recall-all,
  // exchange, or any other action that empties view.placed.
  let selectedPlacedCoord = null;
  // True when the pending (not-yet-confirmed) lock on the board is currently
  // selected. Mirrors `selectedPlacedCoord` for tiles: click the placed lock
  // once to select it (it glows), click an empty cell to MOVE it there, or
  // click it a second time to send it back to the lock box. There is only ever
  // one pending lock, so a flag is enough — its coords live on view.pendingLock.
  let pendingLockSelected = false;
  // Lock ids already seen on the board, so a newly committed lock can be told
  // apart from ones that were already there (seeded at mount below).
  let knownLockIds = new Set();
  // Set for one render when a lock's −10 chip is in flight, so renderScores
  // holds the score count-down until the chip lands.
  let lockCostFlightPending = false;

  // Per-score-element tween state. Keyed by the score <span>; tracks the
  // currently-shown integer plus any in-flight rAF/timeout so we can cancel
  // overlapping animations when MOVE_CONFIRMED fires in quick succession.
  const scoreTweens = new Map();
  const scorePresentationCleanups = new Set();
  function beginScorePresentation() {
    const id = ++nextScorePresentationId;
    const finish = () => {
      if (!scorePresentationCleanups.delete(finish)) return;
      bus?.emit(EV.SCORE_PRESENTATION_FINISHED, { id, cancelled: disposed });
    };
    scorePresentationCleanups.add(finish);
    bus?.emit(EV.SCORE_PRESENTATION_STARTED, { id });
    return finish;
  }
  const win = root?.defaultView ?? globalThis;
  const rafFn   = win?.requestAnimationFrame?.bind(win) ?? ((cb) => setTimeout(() => cb(Date.now()), 16));
  const cafFn   = win?.cancelAnimationFrame?.bind(win)  ?? clearTimeout;
  const nowFn   = () => win?.performance?.now?.() ?? Date.now();

  // Active-slot glow hold. Tracked module-locally so `renderScores` (called
  // during initial mount, before later closures are defined) can read it.
  let displayedTurnSlot = null;
  let activeSlotTimer = null;
  let lastAppliedActiveSlot = null;

  // Tracks which board cells are mid-glow during a scoring sequence. The
  // `.scoring-word-glow` class lives on the `.btile` child of each cell,
  // and `renderBoard` rewrites `cell.innerHTML` on every state sync — so
  // without this registry, the very first word's glow would be wiped by
  // the cascade of follow-up events (SCORE_CHANGED, LOCKS_CHANGED,
  // TURN_CHANGED) that fire right after MOVE_CONFIRMED. Key is `r,c`,
  // value is the wall-clock timestamp at which the glow should end.

  // The `.last-move` green tile-fill highlights the tiles the previous
  // player just placed. The highlight persists until the next move is
  // committed (by either player) so the player can always see what was
  // last played, even if they weren't watching.
  let lastMoveSignature = null;
  let lastMoveActive = false;
  function noteLastMoveForHighlight(v) {
    const placed = v?.lastMove?.placed ?? [];
    const sig = `${v?.lastMove?.slot ?? ''}|` +
      placed.map(p => `${p.r},${p.c}`).sort().join(',');
    if (sig === lastMoveSignature) return;
    lastMoveSignature = sig;
    lastMoveActive = placed.length > 0;
  }

  // When the red sum chip lands on the player's score box. Delegates to the
  // shared timing (single source of truth) so this can't drift from
  // animationController / playScoreMergeSequence.
  function scoreAnimationLandingMs(wordCount, bonusExtra, multiplier = 1) {
    return scoreSequenceLandingMs({ wordCount, bonusExtra, multiplier });
  }
  // The count-up should start the moment the sum chip lands — except under
  // reduced motion, where the chip choreography is skipped entirely (the
  // animation controller is disabled), so there is nothing to wait for.
  function countUpStartDelayMs(wordCount, bonusExtra, multiplier = 1) {
    return prefersReducedMotion() ? 0 : scoreAnimationLandingMs(wordCount, bonusExtra, multiplier);
  }
  function lastMoveHighlightActive() {
    return lastMoveActive;
  }

  // Detect any bonus overlay (mini-game intro, mini-game UI, the bonus
  // award modal, or legacy `#ov-bonus` results screen). Score animations
  // hold while any of these are open so the count-up doesn't fire under
  // a still-visible overlay.
  function bonusOverlayPresent() {
    return bonusOverlayOpen(ownerDocumentOf(root) ?? globalThis.document);
  }

  let countUpPollHandle = null;
  function ensureCountUpPoll() {
    if (countUpPollHandle) return;
    countUpPollHandle = setInterval(() => {
      let stillPending = false;
      for (const state of scoreTweens.values()) {
        if (state.pendingTarget != null) { stillPending = true; break; }
      }
      if (!stillPending) { clearInterval(countUpPollHandle); countUpPollHandle = null; return; }
      if (!bonusOverlayPresent()) {
        clearInterval(countUpPollHandle); countUpPollHandle = null;
        flushPendingCountUps();
      }
    }, 100);
  }
  function flushPendingCountUps() {
    for (const [el, state] of scoreTweens) {
      if (state.pendingTarget == null) continue;
      const t = state.pendingTarget;
      state.pendingTarget = null;
      // Use the same per-word-stagger formula renderScores uses so the
      // count-up still lands as the sum chip arrives.
      const v = controller.view;
      const wordCount = Array.isArray(v?.lastMove?.wordTiles) ? v.lastMove.wordTiles.length : 0;
      const bonusExtra = Number(v?.lastMove?.bonusExtra) || 0;
      const multiplier = Number(v?.lastMove?.multiplier) || 1;
      const delay = countUpStartDelayMs(wordCount, bonusExtra, multiplier);
      animateScore(el, t, delay);
    }
  }

  function animateScore(el, target, delayMs = 460) {
    if (!el) return;
    const targetNum = Number(target) || 0;
    let state = scoreTweens.get(el);
    if (!state) {
      // First paint of this element: just snap to the value (avoids a
      // 0→current count-up on screen mount).
      el.textContent = String(targetNum);
      scoreTweens.set(el, { current: targetNum, target: targetNum, raf: 0, timer: 0, pendingTarget: null });
      return;
    }
    if (state.target === targetNum) return;
    // A tween can wait behind an award, or span delayed browser frames. Keep
    // its presentation alive until the final value is painted, not merely
    // until its nominal duration has elapsed. Retargeting reuses this handle.
    state.finishPresentation ??= beginScorePresentation();
    // Hold the count-up while any bonus overlay is open — they'll be
    // flushed by the poller (or the score-fly arrival on a non-bonus move).
    if (bonusOverlayPresent()) {
      state.pendingTarget = targetNum;
      ensureCountUpPoll();
      return;
    }
    state.target = targetNum;
    if (state.raf)   { cafFn(state.raf);   state.raf = 0; }
    if (state.timer) { clearTimeout(state.timer); state.timer = 0; }
    // Delay covers per-word floats + sum-chip flight; computed by the caller
    // based on the move's wordTiles count so the count-up starts the moment
    // the +TOTAL chip lands on the score panel.
    state.timer = setTimeout(() => {
      state.timer = 0;
      const startTime = nowFn();
      const startValue = state.current;
      const delta = state.target - startValue;
      // Bounded count-up curve owned by scoreAnimationTimings (BOOST_MOTION_SPEC
      // §11): small deltas feel near-instant, large deltas earn a slightly
      // longer climb, never a long latency just because the score grew.
      const durationMs = countUpDurationMs(delta);
      const tick = (t) => {
        const elapsed = Math.min(1, (t - startTime) / durationMs);
        const eased = 1 - Math.pow(1 - elapsed, 3);
        state.current = Math.round(startValue + delta * eased);
        el.textContent = String(state.current);
        if (elapsed < 1) {
          state.raf = rafFn(tick);
        } else {
          state.current = state.target;
          el.textContent = String(state.current);
          state.raf = 0;
          const finish = state.finishPresentation;
          state.finishPresentation = null;
          finish?.();
        }
      };
      state.raf = rafFn(tick);
    }, Math.max(0, Number(delayMs) || 0));
  }

  // ─── Action buttons ──────────────────────────────────────
  const btnPlay = $('#btn-play', root);
  const btnRecall = $('#btn-recall', root);
  const btnExchange = $('#btn-exchange', root) ?? $('button[onclick="doExchange()"]', root);
  const btnDirH = $('#bh', root);
  const btnDirV = $('#bv', root);
  const exchangeOverlay = $('#ov-exch', root);
  const exchangeRack = $('#exch-rack', root);
  // Both the ✕ and the "ביטול" button close the exchange overlay. Select them by
  // ID, NOT by their onclick attribute: both shipped with the identical
  // `onclick="ovClose('ov-exch')"`, so an attribute selector matched whichever
  // came first (the ✕) — and since mount STRIPS that onclick, a re-mount no
  // longer matched the ✕ and silently bound the "ביטול" button instead. The ✕
  // was then left with neither an onclick (stripped) nor a listener (cleaned up
  // on unmount), i.e. a dead button.
  const exchangeCloseButtons = [
    $('#exch-close', root),
    $('#exch-cancel', root),
  ].filter(Boolean);
  const lockInvDisplay = $('#lock-inv-display', root);
  btnPlay?.removeAttribute('onclick');
  btnRecall?.removeAttribute('onclick');
  btnExchange?.removeAttribute('onclick');
  for (const btn of exchangeCloseButtons) btn.removeAttribute?.('onclick');
  btnDirH?.removeAttribute('onclick');
  btnDirV?.removeAttribute('onclick');
  // Ensure btn-play / btn-recall (data-gm-html) show the right gender on mount.
  applyGenderToRoot(root, getGender());
  cleanups.push(on(btnPlay, 'click', (e) => { e.preventDefault?.(); controller.confirmMove(); }));
  cleanups.push(on(btnRecall, 'click', (e) => {
    e.preventDefault?.();
    // Recall-all is one of the "major" rack events that should re-trigger
    // the cascade-in wave — the placed tiles snap back to the rack as a
    // group, so the wave reads as the rack rehydrating.
    animateNextRackRender = true;
    controller.recallAll();
  }));
  cleanups.push(on(btnExchange, 'click', (e) => { e.preventDefault?.(); openExchangeOverlay(); }));
  if (bus) {
    cleanups.push(bus.on(GAME_SCREEN_INTENT.OPEN_EXCHANGE, ({ freeSwap = false } = {}) => {
      openExchangeOverlay({ freeSwap });
    }));
    cleanups.push(bus.on(SETTINGS_CHANGED, (changes = {}) => {
      if ('gender' in changes) renderStatus(controller.view);
    }));
    // Highlight the freshly-drawn tiles after an exchange so the user can
    // see which ones are new. tileBag.drawInto appends to the end of the
    // rack, so the new tiles are at the LAST `count` indices in the
    // post-exchange rack. We only highlight on exchanges by the local
    // player (mySlot match) — an opponent's exchange in online doesn't
    // even show on our rack. In hot-seat 2P both players use the same
    // rack render, so we accept any local-side exchange.
    cleanups.push(bus.on(EV.TILES_EXCHANGED, ({ count, slot } = {}) => {
      const mySlot = controller.view?.mySlot;
      const showingSlot = mySlot != null ? mySlot : controller.view?.currentTurnSlot;
      if (Number(slot) !== Number(showingSlot)) return;
      const drawn = Math.max(0, Number(count) || 0);
      if (!drawn) return;
      const rackLen = (controller.view?.rackForMe ?? []).length;
      const startIdx = Math.max(0, rackLen - drawn);
      recentlyArrivedRackIdxs = new Set();
      for (let i = startIdx; i < rackLen; i++) recentlyArrivedRackIdxs.add(i);
      if (recentlyArrivedClearTimer) clearTimeout(recentlyArrivedClearTimer);
      recentlyArrivedClearTimer = setTimeout(() => {
        recentlyArrivedRackIdxs = new Set();
        recentlyArrivedClearTimer = null;
        try { renderRack(controller.view); } catch { /* swallow */ }
      }, 2000);
      // Render now so the class lands on the first repaint, not after the
      // cascade-in finishes 280ms later.
      try { renderRack(controller.view); } catch { /* swallow */ }
    }));
  }
  for (const btn of exchangeCloseButtons) {
    cleanups.push(on(btn, 'click', (e) => { e.preventDefault?.(); closeExchangeOverlay(); }));
  }
  cleanups.push(on(btnDirH, 'click', (e) => { e.preventDefault?.(); controller.setPlacementDirection?.('H'); }));
  cleanups.push(on(btnDirV, 'click', (e) => { e.preventDefault?.(); controller.setPlacementDirection?.('V'); }));

  // Whether the local player is currently allowed to interact. Updated on
  // every render via setInteractionEnabled(); reads cheaply at click time.
  function canInteract() {
    return controller.view?.isMyTurn !== false;
  }

  // ─── Cell clicks ────────────────────────────────────────
  // Cells inherit from #game-grid; we use event delegation on the grid so
  // we don't have to re-bind every cell. The grid is dynamic (legacy
  // buildUnifiedGrid rebuilds it) but stays under the same parent.
  const grid = $('#game-grid', root);
  if (grid) {
    cleanups.push(on(grid, 'click', (e) => {
      if (!canInteract()) return;
      // Interior play cell (#c{r}_{c}) → place on grid.
      const cell = e.target?.closest?.('[id^="c"]');
      if (cell) {
        const m = /^c(\d+)_(\d+)$/.exec(cell.id);
        if (m) {
          onCellClick(Number(m[1]), Number(m[2]));
          return;
        }
      }
      // Perimeter bonus square (#bsq-{idx}) → place at the off-grid (br, bc)
      // coordinate registered in BDEFS. The engine's board model already
      // supports off-grid placements via bonusBoard, and findActivatedIdxs
      // checks the placement against BDEFS.{br,bc} on commit.
      const bsq = e.target?.closest?.('[id^="bsq-"]');
      if (bsq) {
        const m = /^bsq-(\d+)$/.exec(bsq.id);
        if (!m) return;
        const def = BDEFS[Number(m[1])];
        if (!def) return;
        onCellClick(def.br, def.bc);
      }
    }));
  }

  // ─── Rack clicks (delegated on #brack) ──────────────────
  const brack = $('#brack', root);
  if (brack) {
    cleanups.push(on(brack, 'click', (e) => {
      if (!canInteract()) return;
      const tile = e.target?.closest?.('.bt2');
      if (!tile || tile.classList?.contains('emp')) return;
      const idx = Array.prototype.indexOf.call(brack.children, tile);
      if (idx >= 0) selectRack(idx);
    }));
  }

  function selectRack(i) {
    selectedLock = null;
    selectedPlacedCoord = null;
    pendingLockSelected = false;
    selectedRackIndex = (selectedRackIndex === i) ? null : i;
    // Toggle .sel on the LIVE rack nodes instead of rebuilding the rack. The
    // node survives, so the .bt2 transform transition animates the lift in/out,
    // and an A→B switch settles A down while B lifts — no flicker, no rebuild.
    // A full renderRack would recreate the nodes and kill the transition.
    applyRackSelection();
    renderBoard(controller.view);
    renderLockInventory(controller.view);
  }

  // Reflect selectedRackIndex onto the existing rack tiles by toggling `.sel`.
  // Indexing matches the click handler (position in brack.children). In a
  // non-DOM test stub brack has no children, so this is a safe no-op and the
  // selection state (selectedRackIndex) remains the source of truth.
  function applyRackSelection() {
    if (!brack) return;
    const tiles = brack.children ?? [];
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const isSel = i === selectedRackIndex && !tile.classList?.contains?.('emp');
      tile.classList?.[isSel ? 'add' : 'remove']?.('sel');
    }
  }

  function isSamePlaced(a, b) {
    return !!a && !!b && a.r === b.r && a.c === b.c;
  }

  function onCellClick(r, c) {
    const existing = controller.view.placed.find(p => p.r === r && p.c === c);
    if (existing) {
      // Two-step interaction with placed-this-turn tiles:
      //   click once → highlight (select)
      //   click again on the same tile → recall to rack
      //   click on another empty cell while selected → move tile there
      if (isSamePlaced(selectedPlacedCoord, { r, c })) {
        selectedPlacedCoord = null;
        // Deliberate single-tile return: mark the origin rack slot so it plays
        // the "returned" settle when the tile reappears there on the next
        // rack render. (displayRackTile empties slot `rackIndex` while placed.)
        const returningIdx = existing?.rackIndex;
        if (Number.isInteger(returningIdx)) returnedRackIdxs.add(returningIdx);
        controller.recallTile(r, c);
        return;
      }
      selectedRackIndex = null;
      selectedLock = null;
      selectedPlacedCoord = { r, c };
      renderBoard(controller.view);
      renderRack(controller.view);
      renderLockInventory(controller.view);
      return;
    }
    // Pending swap at this cell — clicking it again cancels the swap.
    const pendingSwap = controller.view.swappedTiles?.find(s => s.r === r && s.c === c);
    if (pendingSwap) {
      controller.unswapBoardTile?.(r, c);
      return;
    }
    // Pending lock at this cell. Same two-step interaction as a placed tile:
    //   click once  → select it (glows); an empty cell then MOVES it there
    //   click again → send it back to the lock box (so a double-click on the
    //                 placed lock returns it, select-then-return)
    const pendingLock = controller.view.pendingLock;
    if (pendingLock && pendingLock.r === r && pendingLock.c === c) {
      if (pendingLockSelected) {
        pendingLockSelected = false;
        controller.clearPendingLock?.();
      } else {
        pendingLockSelected = true;
        selectedRackIndex = null;
        selectedLock = null;
        selectedPlacedCoord = null;
      }
      renderRack(controller.view);
      renderLockInventory(controller.view);
      renderBoard(controller.view);
      return;
    }
    // Committed tile + rack tile selected → propose a swap (rack tile
    // replaces the committed letter; the displaced letter returns to the
    // rack on confirm).
    const committed = committedTileAt(controller.view, r, c);
    if (committed && selectedRackIndex != null) {
      const tile = controller.displayRackTile?.(selectedRackIndex);
      const letter = tile?.letter;
      if (!letter) return;
      if (tile.isJoker) {
        // Swap-in joker: open the picker first so the user assigns a letter.
        if (!jokerPicker || !bus) {
          console.warn('[gameScreen] joker swap clicked but no jokerPicker/bus wired');
          return;
        }
        const rackIndex = selectedRackIndex;
        pendingJokerPlacement = { r, c, rackIndex, mode: 'swap' };
        jokerPickedSub = bus.on('joker/picked', ({ letter: picked }) => {
          if (!pendingJokerPlacement) return;
          const { r: pr, c: pc, rackIndex: ri } = pendingJokerPlacement;
          const ok = controller.swapBoardTile?.({ r: pr, c: pc, letter: picked, val: 0, isJoker: true, rackIndex: ri });
          clearJokerSubs();
          if (ok !== false) selectedRackIndex = null;
          renderRack(controller.view);
          renderBoard(controller.view);
        });
        jokerCancelledSub = bus.on('joker/cancelled', () => { clearJokerSubs(); });
        jokerPicker.open();
        return;
      }
      const ok = controller.swapBoardTile?.({ r, c, letter, val: tile.val ?? 0, isJoker: false, rackIndex: selectedRackIndex });
      if (ok !== false) selectedRackIndex = null;
      renderRack(controller.view);
      renderBoard(controller.view);
      return;
    }
    // From here the clicked cell is empty / not a pending placement.
    if (selectedPlacedCoord) {
      // Move the previously-selected placed tile to this cell. Refuse if the
      // destination is locked or already has a committed tile.
      const src = controller.view.placed.find(p =>
        p.r === selectedPlacedCoord.r && p.c === selectedPlacedCoord.c);
      const srcCoord = selectedPlacedCoord;
      selectedPlacedCoord = null;
      if (!src) { renderBoard(controller.view); return; }
      const blocked = isCellBlockedForPlacement(controller.view, r, c);
      if (blocked) { renderBoard(controller.view); return; }
      controller.recallTile(srcCoord.r, srcCoord.c);
      // Repositioning: the destination "receives" the tile and settles (same
      // tentative entrance as a fresh placement); the source cell just empties.
      const moveKey = `${r},${c}`;
      tentativeEntryCoords.add(moveKey);
      const moved = controller.placeTile({
        r, c,
        letter: src.letter, val: src.val,
        isJoker: !!src.isJoker, rackIndex: src.rackIndex ?? null,
      });
      if (moved === false) tentativeEntryCoords.delete(moveKey);
      return;
    }
    if (pendingLockSelected && controller.view.pendingLock) {
      // Move the selected pending lock to this cell (same as moving a placed
      // tile). Refuse destinations the engine wouldn't accept: off-grid
      // perimeter bonus squares, committed tiles, and already-locked cells.
      pendingLockSelected = false;
      const duration = controller.view.pendingLock.duration;
      if (r < 0 || r > 9 || c < 0 || c > 9 || isCellBlockedForPlacement(controller.view, r, c)) {
        renderBoard(controller.view);
        return;
      }
      controller.setPendingLock?.({ r, c, duration });
      renderLockInventory(controller.view);
      renderBoard(controller.view);
      return;
    }
    if (selectedLock != null) {
      // Lock placement from the box: the player picked a lock (it glows in the
      // box), now they pick the square. Shows a preview on the cell and the
      // lock disappears from the box; the actual PLACE_LOCK dispatch waits for
      // שבץ (handled by controller.confirmMove). Perimeter bonus squares are
      // refused — the engine's PLACE_LOCK only accepts 0..9 × 0..9.
      if (r < 0 || r > 9 || c < 0 || c > 9) return;
      if (isCellBlockedForPlacement(controller.view, r, c)) return;
      controller.setPendingLock?.({ r, c, duration: selectedLock.duration });
      selectedLock = null;
      renderLockInventory(controller.view);
      renderBoard(controller.view);
      return;
    }
    if (selectedRackIndex == null) return; // nothing selected — nothing to place
    const rackTile = controller.displayRackTile?.(selectedRackIndex);
    const letter = rackTile?.letter;
    if (!letter) return;

    if (rackTile.isJoker) {
      // Joker placement — open the picker, then commit when the user
      // chooses a target letter. Subscriptions are one-shot; cancelling
      // unselects the rack.
      if (!jokerPicker || !bus) {
        console.warn('[gameScreen] joker tile clicked but no jokerPicker/bus wired');
        return;
      }
      const rackIndex = selectedRackIndex;
      pendingJokerPlacement = { r, c, rackIndex };
      jokerPickedSub = bus.on('joker/picked', ({ letter: picked }) => {
        if (!pendingJokerPlacement) return;
        const { r: pr, c: pc, rackIndex: ri } = pendingJokerPlacement;
        const jokerKey = `${pr},${pc}`;
        tentativeEntryCoords.add(jokerKey);
        const placed = controller.placeTile({ r: pr, c: pc, letter: picked, val: 0, isJoker: true, rackIndex: ri });
        if (placed === false) tentativeEntryCoords.delete(jokerKey);
        clearJokerSubs();
        if (placed !== false) selectedRackIndex = null;
        renderRack(controller.view);
      });
      jokerCancelledSub = bus.on('joker/cancelled', () => {
        clearJokerSubs();
        // Leave selection in place so the user can pick another cell or recall
      });
      jokerPicker.open();
      return;
    }

    const entryKey = `${r},${c}`;
    tentativeEntryCoords.add(entryKey);
    const placed = controller.placeTile({ r, c, letter, val: rackTile.val ?? 0, isJoker: false, rackIndex: selectedRackIndex });
    if (placed !== false) selectedRackIndex = null;
    else tentativeEntryCoords.delete(entryKey);
    renderRack(controller.view);
  }

  function clearJokerSubs() {
    pendingJokerPlacement = null;
    if (jokerPickedSub)    { try { jokerPickedSub();    } catch {} jokerPickedSub = null; }
    if (jokerCancelledSub) { try { jokerCancelledSub(); } catch {} jokerCancelledSub = null; }
  }

  let exchangeIsFreeSwap = false;
  function openExchangeOverlay({ freeSwap = false } = {}) {
    if (!exchangeOverlay || !exchangeRack) return;
    if (controller.view.placed?.length) {
      setText($('#sbar', root), g('cancelBeforeSwap'));
      return;
    }
    // If the local player has a banked free_tile_swap (won on the B13 wheel),
    // spend it automatically — even when the swap was opened via the regular
    // "החלפת אות" button rather than the 🔄 badge. Otherwise a player who won
    // a free swap and then hit the ordinary exchange button would lose a turn
    // while still holding the boost.
    const localSlot = controller.view.mySlot ?? controller.view.currentTurnSlot;
    const hasBankedSwap = (controller.view.activeBoosts ?? []).some(
      b => b && b.boostId === 'free_tile_swap' && b.slot === localSlot,
    );
    exchangeIsFreeSwap = !!freeSwap || hasBankedSwap;
    exchangeOverlay.classList?.toggle?.('free-swap', exchangeIsFreeSwap);
    renderExchangeRack(new Set());
    exchangeOverlay.classList?.remove('hidden');
  }

  function closeExchangeOverlay() {
    exchangeOverlay?.classList?.add('hidden');
  }

  function renderExchangeRack(selected) {
    if (!exchangeRack) return;
    exchangeRack.innerHTML = '';
    const rack = controller.view.rackForMe ?? [];
    rack.forEach((letter, i) => {
      if (!letter) return;
      const tile = makeExchangeTile(root, letter, i, selected.has(i));
      cleanups.push(on(tile, 'click', (e) => {
        e.preventDefault?.();
        // Only one tile may be exchanged per turn (matches the overlay
        // title "החלפת אות אחת"). Clicking another tile moves the
        // selection to it; clicking the already-selected tile toggles it
        // off.
        if (selected.has(i)) {
          selected.delete(i);
        } else {
          selected.clear();
          selected.add(i);
        }
        renderExchangeRack(selected);
      }));
      exchangeRack.appendChild?.(tile);
    });

    // The confirm button used to be appended inline alongside the tiles,
    // forcing everything onto a single cramped row. Put it into the
    // overlay's button bar instead so the tiles wrap freely into two
    // rack-style rows. We re-insert it on every render to keep the count
    // label (`החלף (N)`) accurate.
    const btnBar = exchangeOverlay?.querySelector?.('.ovbtns');
    const previous = btnBar?.querySelector?.('[data-exch="confirm"]');
    if (previous) previous.remove();
    const confirm = makeExchangeConfirmButton(root, selected.size);
    if (confirm.setAttribute) confirm.setAttribute('data-exch', 'confirm');
    else if (confirm.dataset) confirm.dataset.exch = 'confirm';
    cleanups.push(on(confirm, 'click', (e) => {
      e.preventDefault?.();
      const letters = [...selected].sort((a, b) => a - b).map(i => rack[i]).filter(Boolean);
      if (!letters.length) {
        setText($('#sbar', root), g('chooseToSwap'));
        return;
      }
      controller.exchangeTiles(letters, { freeSwap: exchangeIsFreeSwap });
      closeExchangeOverlay();
      selected.clear();
      exchangeIsFreeSwap = false;
    }));
    if (btnBar) btnBar.insertBefore?.(confirm, btnBar.firstChild ?? null);
    else exchangeRack.appendChild?.(confirm); // fallback for stub DOMs in tests
  }

  // ─── Renderer ───────────────────────────────────────────
  // Seed the known-lock set from the state we're mounting onto: locks already
  // on the board (a resumed / reconnected game) must not fire a cost flight.
  knownLockIds = new Set((controller.view.lockedCells ?? []).map(l => l.id));
  cleanups.push(controller.onChange(renderAll));
  renderAll(controller.view);

  function renderAll(v) {
    // Drop a stale `selectedPlacedCoord` if the tile is no longer pending
    // (e.g. after confirm / recall-all / exchange).
    if (selectedPlacedCoord) {
      const stillPending = (v.placed ?? []).some(p =>
        p.r === selectedPlacedCoord.r && p.c === selectedPlacedCoord.c);
      if (!stillPending) selectedPlacedCoord = null;
    }
    // Same for the pending lock: once it's confirmed, recalled, or cleared by
    // a turn change, there is nothing left on the board to keep selected.
    if (pendingLockSelected && !v.pendingLock) pendingLockSelected = false;
    // Must run BEFORE renderScores so it can hold the count-down until the
    // −10 chip lands on the score panel.
    const committedLock = detectCommittedLock(v);
    if (committedLock) {
      lockCostFlightPending = true;
      playLockCostFlight(committedLock);
    }
    emitLivePreview(v);
    renderScores(v);
    renderStatus(v);
    renderTopBars(v);
    renderMultiplierBanner(v);
    renderBoard(v);
    renderLockInventory(v);
    renderRack(v);
    renderInteractionGate(v);
  }

  // Disable the rack + action buttons whenever it isn't this client's turn,
  // OR while the score-animation glow swap is still in flight. The glow,
  // timer, and bottom row all flip together when activeSlotTimer fires.
  // We deliberately do NOT disable the cell grid itself — recall-on-occupied
  // and ghost previews still work via click handlers, which already early-out
  // on canInteract() when the player isn't allowed to mutate state.
  function renderInteractionGate(v) {
    const enabled = v.isMyTurn !== false && !activeSlotTimer;
    for (const btn of [btnPlay, btnRecall, btnExchange, btnDirH, btnDirV]) {
      if (!btn) continue;
      btn.disabled = !enabled;
      btn.classList?.toggle?.('is-disabled', !enabled);
      btn.setAttribute?.('aria-disabled', enabled ? 'false' : 'true');
    }
    if (brack) {
      brack.classList?.toggle?.('is-disabled', !enabled);
      brack.setAttribute?.('aria-disabled', enabled ? 'false' : 'true');
    }
    if (lockInvDisplay) {
      lockInvDisplay.classList?.toggle?.('is-disabled', !enabled);
    }
  }

  function renderScores(v) {
    // Match the count-up start to the moment the red sum chip lands on
    // the player's score panel. The score-merge sequence (see
    // playScoreMergeSequence) is: per-word chips fly into the sum chip
    // (staggered every SCORE_MERGE_WORD_STAGGER_MS), boost extra merges
    // last if any, the sum holds for SCORE_MERGE_HOLD_AFTER_MS, then
    // takes SCORE_MERGE_SUM_FLIGHT_MS to fly to the panel.
    const wordCount  = Array.isArray(v?.lastMove?.wordTiles) ? v.lastMove.wordTiles.length : 0;
    const bonusExtra = Number(v?.lastMove?.bonusExtra) || 0;
    const multiplier = Number(v?.lastMove?.multiplier) || 1;
    // A lock committed this render flies a −10 chip into the score panel; hold
    // the count-down until it lands so the number and the chip agree.
    const scoreDelay = countUpStartDelayMs(wordCount, bonusExtra, multiplier);
    const countUpDelay = lockCostFlightPending
      ? Math.max(scoreDelay, LOCK_COST_FLIGHT_MS)
      : scoreDelay;
    lockCostFlightPending = false;
    animateScore($('#sv1', root), v.scores[0] ?? 0, countUpDelay);
    animateScore($('#sv2', root), v.scores[1] ?? 0, countUpDelay);
    animateScore($('#is-sv1', root), v.scores[0] ?? 0, countUpDelay);
    animateScore($('#is-sv2', root), v.scores[1] ?? 0, countUpDelay);
    renderPendingLockCost(v);
    renderPlayerIdentity(v);
    // Desktop side-panel boxes use `.scbox.act`; the mobile info-strip cards
    // use `.is-pcard.act-cell` (different class name, see styles.css). When
    // a scoring sequence is in flight we keep the previous player's glow lit
    // until the count-up finishes — otherwise the box highlight swaps to the
    // opponent before they actually see the score change. `displayedTurnSlot`
    // is bumped to the engine's `currentTurnSlot` by `maybeScheduleActiveSlotSwap`.
    const glowSlot = displayedTurnSlot ?? v.currentTurnSlot;
    applyActiveSlotGlow(glowSlot);
    maybeScheduleActiveSlotSwap(v, wordCount);
  }

  // Preview of the lock charge, shown on the owner's score card for as long as
  // an unconfirmed lock sits on the board. The real score is NOT touched — the
  // lock can still be moved, returned to the box, or lost to a rejected word,
  // and online scores only change through commitTransaction. The number counts
  // down for real once the move commits.
  function renderPendingLockCost(v) {
    const costSlot = v.pendingLock
      ? (v.mySlot != null ? v.mySlot : v.currentTurnSlot)
      : null;
    for (const slot of [0, 1]) {
      const el = $(`#is-cost-${slot + 1}`, root);
      if (!el) continue;
      if (slot === costSlot) {
        setText(el, `−${LOCK_POINT_COST}`);
        el.classList?.add?.('is-visible');
      } else {
        setText(el, '');
        el.classList?.remove?.('is-visible');
      }
    }
  }

  // Spot a lock that just became committed (either path: lock-only turn or
  // word+lock) by diffing lock ids against the previous render, and fly its
  // cost into the owner's score panel. Seeded on mount so locks already on the
  // board in a resumed game don't animate.
  function detectCommittedLock(v) {
    const cells = Array.isArray(v.lockedCells) ? v.lockedCells : [];
    const next = new Set(cells.map(l => l.id));
    const added = cells.find(l => !knownLockIds.has(l.id));
    knownLockIds = next;
    return added ?? null;
  }

  function playLockCostFlight(lock) {
    const doc = ownerDocumentOf(root);
    const chip = doc?.createElement?.('div');
    if (!chip) return;
    chip.className = 'scoring-float-label lock-cost-chip';
    chip.textContent = `−${LOCK_POINT_COST}`;
    const fromEl = $(`#c${lock.r}_${lock.c}`, root) ?? lookup(root, 'game-grid');
    positionFixedLabel(chip, fromEl, { yOffset: -10 });
    appendOverlay(root, chip);
    const to = centerOf(scoreTargetForSlot(root, lock.ownerSlot));
    const from = centerOf(fromEl);
    if (to && from) {
      // Next frame so the browser paints the start position before we move it.
      rafFn(() => {
        chip.style.transition =
          `transform ${LOCK_COST_FLIGHT_MS}ms cubic-bezier(.22,1,.36,1), opacity ${LOCK_COST_FLIGHT_MS}ms ease-in`;
        chip.style.transform = `translate(calc(-50% + ${to.x - from.x}px), ${to.y - from.y}px) scale(.7)`;
        chip.style.opacity = '0';
      });
    }
    setTimeout(() => chip.remove?.(), LOCK_COST_FLIGHT_MS + 120);
  }

  // Player names + avatars (mobile info-strip and desktop labels). Split out
  // of renderScores so a late-arriving live avatar can repaint the identity
  // without re-entering renderScores — that would restart the score count-up
  // animations mid-flight.
  function renderPlayerIdentity(v) {
    const p0 = v._players?.[0] ?? null;
    const p1 = v._players?.[1] ?? null;
    if (p0?.displayName) {
      setText($('#sn1', root), p0.displayName);
      setText($('#is-sn1', root), p0.displayName);
    }
    if (p1?.displayName) {
      setText($('#sn2', root), p1.displayName);
      setText($('#is-sn2', root), p1.displayName);
    }
    // 'bot' is a sentinel avatar, not a real one — only honour it for the
    // actual computer opponent.
    const rawP1Avatar = avatarFor(p1);
    const p1Avatar = rawP1Avatar === 'bot' && p1?.displayName !== COMPUTER_NAME_HE ? null : rawP1Avatar;
    setAvatarEl($('#is-av1', root), avatarFor(p0) ?? null, { fallback: '👑' });
    setAvatarEl($('#is-av2', root), p1Avatar ?? null, { fallback: '👤' });
  }

  // Prefer the player's CURRENT avatar over the one stored on the room.
  //
  // Room documents snapshot players[n].avatar at invite/accept time and never
  // refresh it, so a room opened from a connection made before the player last
  // changed their avatar shows the stale one — or, for rooms that predate
  // avatars entirely, no avatar at all, which falls through to the 👑/👤
  // fallback for the life of the game. We look the avatar up by uid instead and
  // fall back to the stored value (bots and guests have no profile to read, and
  // the lookup is async — the stored value renders until it lands).
  //
  // Existing rooms are deliberately NOT backfilled; this is a read-time fix.
  function avatarFor(player) {
    if (!player?.uid) return player?.avatar ?? null;
    if (liveAvatarByUid.has(player.uid)) {
      return liveAvatarByUid.get(player.uid) ?? player.avatar ?? null;
    }
    requestLiveAvatar(player.uid);
    return player.avatar ?? null;
  }

  function requestLiveAvatar(uid) {
    if (!resolveAvatar || !uid || avatarLookupsInFlight.has(uid)) return;
    avatarLookupsInFlight.add(uid);
    Promise.resolve()
      .then(() => resolveAvatar(uid))
      .then((avatar) => {
        if (disposed) return;
        liveAvatarByUid.set(uid, avatar ?? null);
        renderPlayerIdentity(controller.view);
      })
      .catch((e) => {
        // Cache the miss so a failing/absent profile doesn't re-fetch on
        // every render; the stored room avatar keeps rendering.
        if (!disposed) liveAvatarByUid.set(uid, null);
        console.warn('[gameScreen] live avatar lookup failed', e);
      })
      .finally(() => avatarLookupsInFlight.delete(uid));
  }

  // Currently-displayed active slot is tracked in `lastAppliedActiveSlot`
  // (declared up top alongside `displayedTurnSlot`). We toggle the .act class
  // only when the slot actually flips — a no-op `add()` on an already-present
  // class doesn't replay the keyframe animation.
  function applyActiveSlotGlow(slot) {
    const slotsToClear = [
      ['#sb1', 'act'], ['#sb2', 'act'],
      ['#is-sb1', 'act-cell'], ['#is-sb2', 'act-cell'],
    ];
    if (slot !== lastAppliedActiveSlot) {
      // Slot flipped — clear .act on every box, force reflow on the new
      // target so the breathing-glow keyframe restarts from frame 0, then
      // add .act to the target.
      for (const [sel, cls] of slotsToClear) {
        const el = $(sel, root);
        if (el) el.classList?.remove(cls);
      }
      if (slot === 0 || slot === 1) {
        const desk = $(`#sb${slot + 1}`, root);
        const info = $(`#is-sb${slot + 1}`, root);
        if (desk) { void desk.offsetWidth; desk.classList?.add('act'); }
        if (info) { void info.offsetWidth; info.classList?.add('act-cell'); }
      }
      lastAppliedActiveSlot = slot;
      return;
    }
    // Same slot as last render — ensure exactly one box on each layout
    // still carries the class (defensive against external toggles like
    // re-mounts) without restarting the animation.
    for (const [sel, cls] of slotsToClear) {
      const el = $(sel, root);
      if (!el) continue;
      const want = (cls === 'act' ? sel === `#sb${slot + 1}` : sel === `#is-sb${slot + 1}`);
      el.classList?.[want ? 'add' : 'remove'](cls);
    }
  }

  // Active-slot glow hold. Schedule a swap of `displayedTurnSlot` aligned
  // with the count-up finish so the glow doesn't jump before the player
  // sees the points commit. Variables are declared above renderScores.
  function maybeScheduleActiveSlotSwap(v, wordCount) {
    const target = v?.currentTurnSlot;
    if (target == null) return;
    if (displayedTurnSlot == null) { displayedTurnSlot = target; return; }
    if (displayedTurnSlot === target) {
      // Target reverted to the currently-displayed slot (e.g. bot played
      // before the previous animation finished). Cancel any pending swap so
      // the interaction gate opens immediately for the correct player.
      if (activeSlotTimer) { clearTimeout(activeSlotTimer); activeSlotTimer = null; }
      return;
    }
    if (activeSlotTimer) return;
    // Hold the previous player's glow + block input until the score animation
    // settles (chip landing + count-up peak). This is visual coherence +
    // misclick avoidance, NOT a correctness barrier — the engine validates
    // every command regardless (see BOOST_MOTION_SPEC §9). Under reduced motion
    // it collapses to a small misclick floor.
    const bonusExtra = Number(v?.lastMove?.bonusExtra) || 0;
    const multiplier = Number(v?.lastMove?.multiplier) || 1;
    const total = scoreInteractionGateMs({ wordCount, bonusExtra, multiplier, reducedMotion: prefersReducedMotion() });
    activeSlotTimer = setTimeout(() => {
      activeSlotTimer = null;
      displayedTurnSlot = controller.view?.currentTurnSlot ?? target;
      _renderAll();
    }, total);
  }
  function _renderAll() {
    // Re-render everything so the glow swap, timer resume, and interaction
    // gate all become visible in the same frame.
    try { renderAll(controller.view); } catch { /* swallow */ }
  }

  function renderStatus(v) {
    if (v.lastInvalidReason) {
      setText($('#sbar', root), invalidReasonText(v.lastInvalidReason));
    } else if (v.status === 'completed' || v.status === 'abandoned') {
      const winner = v.scores[0] > v.scores[1] ? 0 : v.scores[1] > v.scores[0] ? 1 : null;
      setText($('#sbar', root), winner == null ? 'תיקו!' : `שחקן ${winner + 1} ניצח!`);
    } else if (v.placed?.length) {
      setText($('#sbar', root), g('pressConfirm'));
    } else {
      setText($('#sbar', root), g('chooseLetterBoard'));
    }
  }

  function renderTopBars(v) {
    setText($('#bag-count-text', root), String(v.bagRemaining));
    const turnName = v.currentTurnSlot === 0 ? 'שחקן 1' : 'שחקן 2';
    setText($('#turn-name', root), turnName);
    renderDirection(v);
  }

  function renderMultiplierBanner(v) {
    // One banner per player box (mobile info-strip + desktop side panel),
    // anchored as the box's last child so it sits directly under the box,
    // inherits its width via `position: absolute; left/right: 0` — see
    // styles.css `.spine-multiplier-banner`.
    //
    // The banner stays attached to the OWNING slot from the moment the
    // boost is awarded until it expires, including during the opponent's
    // turns. That's why we don't gate on `v.currentTurnSlot` here — we
    // just walk `activeBoosts` and surface a banner for every slot that
    // currently owns a `multiply_next_turns` entry.
    const doc = root.ownerDocument ?? globalThis.document;
    if (!doc?.createElement) return;

    // slot → highest active multiplier for that slot. If a player has
    // stacked B6 (×4) and B7 (×2), surface the more dramatic one.
    const slotMultipliers = new Map();
    for (const b of v.activeBoosts ?? []) {
      if (b?.boostId !== 'multiply_next_turns') continue;
      if (Number.isInteger(b.bonusIdx) && v._pendingBoostAwardSlot === b.slot
        && !revealedBoostSquares.has(boostSquareKey(b))) continue;
      if (b.slot !== 0 && b.slot !== 1) continue;
      const mult = Number(b.payload?.multiplier ?? 2);
      const existing = slotMultipliers.get(b.slot);
      if (existing == null || mult > existing) slotMultipliers.set(b.slot, mult);
    }

    // Drop any banner whose slot no longer has an active multiplier.
    const all = root.querySelectorAll?.('.spine-multiplier-banner') ?? [];
    for (const el of all) {
      const m = el.id && String(el.id).match(/spine-multiplier-banner-(?:is|sc)-(\d+)$/);
      const slot = m ? Number(m[1]) : null;
      if (slot == null || !slotMultipliers.has(slot)) el.remove?.();
    }
    if (slotMultipliers.size === 0) return;

    for (const [slot, multiplier] of slotMultipliers) {
      const targets = [
        { hostId: `is-sb${slot + 1}`, suffix: `is-${slot}` },
        { hostId: `sb${slot + 1}`,    suffix: `sc-${slot}` },
      ];
      for (const { hostId, suffix } of targets) {
        const host = doc.getElementById?.(hostId);
        if (!host) continue;
        if (host.style && !host.style.position) host.style.position = 'relative';
        let banner = doc.getElementById?.(`spine-multiplier-banner-${suffix}`);
        if (!banner) {
          banner = doc.createElement('div');
          banner.id = `spine-multiplier-banner-${suffix}`;
          host.appendChild(banner);
        }
        banner.className = `spine-multiplier-banner mult-${multiplier >= 4 ? 4 : 2}`;
        // While it's the opponent's turn the boost is still queued, just
        // not consumed yet — copy reflects that.
        const isMyTurn = v.currentTurnSlot === slot;
        banner.textContent = multiplier >= 4
          ? (isMyTurn ? '🔥 ×4 בתור הזה' : '🔥 ×4 בתור הבא')
          : (isMyTurn ? '×2 בתור הזה' : '×2 בתור הבא');
      }
    }
  }

  function renderDirection(v) {
    const isH = (v.placementDirection ?? 'H') !== 'V';
    setClass($('#bh', root), 'a', isH);
    setClass($('#bv', root), 'a', !isH);
    setClass($('#is-bh', root), 'a', isH);
    setClass($('#is-bv', root), 'a', !isH);
  }

  function renderBoard(v) {
    // Render committed tiles + tentative placements. Empty cells get cleared.
    // Tile HTML mirrors legacy renderBoard() so existing CSS applies.
    noteLastMoveForHighlight(v);
    const lastMoveCoords = lastMoveHighlightActive() ? lastMoveCoordSet(v) : new Set();
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const cell = $(`#c${r}_${c}`, root);
        if (!cell) continue;
        cell.classList?.remove('np', 'lk', 'ht', 'last-move', 'spine-live-preview', 'spine-lock-cell', 'spine-pending-lock-cell', 'locked-cell', 'selected-placed', 'swap-pending');
        const placedHere = v.placed?.find(p => p.r === r && p.c === c);
        const swapHere = v.swappedTiles?.find(s => s.r === r && s.c === c);
        const committed = boardTileAt(v, r, c);
        const lockedHere = lockAt(v, r, c);
        if (swapHere) {
          // Render the NEW letter that's pending replacement. Mark with
          // .swap-pending so the user sees a swap is in progress; clicking
          // the cell again cancels.
          cell.innerHTML = tileHTML({ letter: swapHere.letter, val: swapHere.val, isJoker: !!swapHere.isJoker }, /*isPlaced=*/true);
          cell.classList?.add('ht', 'np', 'swap-pending');
        } else if (committed) {
          cell.innerHTML = tileHTML(committed, /*isPlaced=*/false);
          cell.classList?.add('ht', 'lk');
          if (lastMoveCoords.has(`${r},${c}`)) cell.classList?.add('last-move');
        } else if (placedHere) {
          // Consume a one-shot tentative-entry marker so the settle plays only
          // on the placement render, never on an unrelated board re-render.
          const entering = tentativeEntryCoords.delete(`${r},${c}`);
          cell.innerHTML = tileHTML(placedHere, /*isPlaced=*/true, entering ? 'tile-tentative-in' : '');
          cell.classList?.add('ht', 'np');
          if (selectedPlacedCoord && selectedPlacedCoord.r === r && selectedPlacedCoord.c === c) {
            cell.classList?.add('selected-placed');
          }
        } else if (isOpponentPreview(v, r, c)) {
          const previewTile = previewTileAt(v, r, c);
          cell.innerHTML = tileHTML(previewTile, /*isPlaced=*/true);
          cell.classList?.add('ht', 'np', 'spine-live-preview');
        } else if (lockedHere) {
          cell.innerHTML = lockHTML(lockedHere);
          cell.classList?.add('spine-lock-cell', 'locked-cell');
        } else if (v.pendingLock && v.pendingLock.r === r && v.pendingLock.c === c) {
          // Tentative lock — same icon as a committed lock but with a
          // .pending modifier so CSS can dim/animate it to signal "this is
          // not yet confirmed". Tap again to remove, or tap שבץ to commit.
          // The pending lock carries its price tag, so the cost is attached to
          // the thing that causes it at the moment the player is deciding.
          cell.innerHTML = lockHTML({ remainingTurns: v.pendingLock.duration })
            + `<span class="spine-lock-cost">−${LOCK_POINT_COST}</span>`;
          cell.classList?.add('spine-lock-cell', 'spine-pending-lock-cell');
          // Selected → same highlight a selected pending TILE gets, so the
          // player can see which lock will move on the next cell tap.
          if (pendingLockSelected) cell.classList?.add('selected-placed');
        } else {
          cell.innerHTML = '';
        }
        // Re-apply an in-flight scoring-word-glow that would otherwise be
        // wiped by the innerHTML rewrite above.
      }
    }
    // Perimeter bonus squares accept tile placements too — render those
    // overlaid on top of the bonus icon so the original lightning glyph is
    // hidden once a tile lands. The `.bsq-tile-host` class flags that the
    // bsq currently has a tile so CSS can suppress the bonus pulse / icon.
    for (let i = 0; i < BDEFS.length; i++) {
      const bsq = $(`#bsq-${i}`, root);
      if (!bsq) continue;
      const { br, bc } = BDEFS[i];
      const placedHere = v.placed?.find(p => p.r === br && p.c === bc);
      const swapHere = v.swappedTiles?.find(s => s.r === br && s.c === bc);
      const committed = boardTileAt(v, br, bc);
      const opponentPreviewTile = (!placedHere && !committed && isOpponentPreview(v, br, bc))
        ? previewTileAt(v, br, bc)
        : null;
      bsq.classList?.remove('bsq-tile-host', 'np', 'selected-placed', 'spine-live-preview', 'last-move', 'swap-pending');
      const iconEl = bsq.querySelector?.('.bsq-ic, .bsq-tile-wrap');
      const tileTarget = bsq.querySelector?.('.bsq-tile-wrap');
      if (swapHere) {
        // A pending swap must be checked BEFORE `committed` — the engine only
        // applies the swap on confirm, so the committed tile here is still the
        // OLD letter. Without this branch the bsq fell through to the
        // `committed` case and kept showing the letter being replaced until the
        // move was finalized. Mirrors the in-grid cell loop above.
        bsq.classList?.add('bsq-tile-host', 'np', 'swap-pending');
        ensureBsqTileWrap(bsq).innerHTML = tileHTML(
          { letter: swapHere.letter, val: swapHere.val, isJoker: !!swapHere.isJoker },
          /*isPlaced=*/true,
        );
      } else if (committed) {
        bsq.classList?.add('bsq-tile-host');
        if (lastMoveCoords.has(`${br},${bc}`)) bsq.classList?.add('last-move');
        ensureBsqTileWrap(bsq).innerHTML = tileHTML(committed, /*isPlaced=*/false);
      } else if (placedHere) {
        const entering = tentativeEntryCoords.delete(`${br},${bc}`);
        bsq.classList?.add('bsq-tile-host', 'np');
        ensureBsqTileWrap(bsq).innerHTML = tileHTML(placedHere, /*isPlaced=*/true, entering ? 'tile-tentative-in' : '');
        if (selectedPlacedCoord && selectedPlacedCoord.r === br && selectedPlacedCoord.c === bc) {
          bsq.classList?.add('selected-placed');
        }
      } else if (opponentPreviewTile) {
        // The opponent placed a tile on this perimeter bonus square but hasn't
        // committed yet. Render the preview tile so it matches the in-grid
        // live-preview behavior (same `.spine-live-preview` styling).
        bsq.classList?.add('bsq-tile-host', 'np', 'spine-live-preview');
        ensureBsqTileWrap(bsq).innerHTML = tileHTML(opponentPreviewTile, /*isPlaced=*/true);
      } else if (tileTarget) {
        tileTarget.remove();
      }
    }
  }

  function ensureBsqTileWrap(bsq) {
    let wrap = bsq.querySelector?.('.bsq-tile-wrap');
    if (!wrap) {
      wrap = (root.ownerDocument ?? globalThis.document).createElement('div');
      wrap.className = 'bsq-tile-wrap';
      bsq.appendChild(wrap);
    }
    return wrap;
  }

  function renderBrack2(v) {
    // Render the inactive player's rack in the legacy #brack2 slot —
    // populated only when v.rackForOpponent is non-null (offline-2p with
    // settings.showBothRacks=true). Read-only peek; no click handlers.
    const row    = root.querySelector?.('#brack2-row');
    const slot   = root.querySelector?.('#brack2');
    const label  = root.querySelector?.('#brack2-label');
    if (!row || !slot) return;
    const opponentRack = v.rackForOpponent;
    if (!Array.isArray(opponentRack)) {
      row.style.display = 'none';
      slot.innerHTML = '';
      return;
    }
    row.style.display = '';
    if (label) label.textContent = v.opponentName ? `מגש ${v.opponentName}` : '';
    let html = '';
    for (let i = 0; i < 8; i++) {
      const letter = opponentRack[i];
      if (!letter) {
        html += '<div class="bt2 emp"></div>';
        continue;
      }
      const isJoker = letter === '?';
      const display = isJoker
        ? `<span class="jok-sym"><img class="jok-img" src="jocker.PNG" alt=""></span>`
        : letter;
      const val = isJoker ? 0 : (HV[letter] ?? 0);
      const valDisplay = isJoker ? '' : val;
      const jok = isJoker ? ' jok' : '';
      html += `<div class="bt2${jok}"><span class="bt2-l">${display}</span><span class="bt2-v">${valDisplay}</span></div>`;
    }
    slot.innerHTML = html;
  }

  function renderRack(v) {
    // Keep the opponent's read-only peek in sync. brack2 is shown only
    // when v.rackForOpponent is non-null (offline-2p + showBothRacks).
    try { renderBrack2(v); } catch { /* swallow */ }
    if (!brack) return;
    const rack = v.rackForMe ?? [];
    // Build a signature that reflects what the rack will actually display —
    // including pending swap-back letters — so the cascade-in animation
    // re-runs when a swap changes the visible rack.
    const tiles = [];
    for (let i = 0; i < 8; i++) tiles.push(controller.displayRackTile?.(i) ?? null);
    const rackSignature = tiles
      .map(t => (t ? `${t.isJoker ? '?' : t.letter}:${t.val}` : '_'))
      .concat(rack)
      .join('|');
    // Cascade-in only on the major rack events — currently:
    //   • the recall-all button (`בטל`) — rack rehydrates from the engine
    //     after the placed tiles snap back,
    //   • a confirmed move's rack refill (animationController's
    //     tileCascadeIn directive),
    //   • a tile exchange (same directive on EV.TILES_EXCHANGED).
    // Minor changes — selecting a tile, placing a single letter,
    // toggling a pending swap — used to also trigger the wave because the
    // rack signature changed, which players reported as noisy. Driving it
    // purely off the explicit flag keeps the cascade tied to "the rack
    // really refreshed", not to every UI nudge.
    const shouldAnimate = animateNextRackRender;
    animateNextRackRender = false;
    lastRackSignature = rackSignature;
    // Build 8 slots; missing tiles and tiles currently placed on the board get the .emp class
    let html = '';
    for (let i = 0; i < 8; i++) {
      const tile = tiles[i];
      if (!tile?.letter) {
        html += `<div class="bt2 emp"></div>`;
        continue;
      }
      const { letter, isJoker, val } = tile;
      const sel = (i === selectedRackIndex) ? ' sel' : '';
      const jok = isJoker ? ' jok' : '';
      // Freshly-drawn tile from the most recent exchange — apply the
      // glow class so the user can see what's new. Cleared after 2s by
      // the EV.TILES_EXCHANGED subscriber.
      const arrived = recentlyArrivedRackIdxs.has(i) ? ' bt2-just-arrived' : '';
      // One-shot "returned to rack" settle for a single tile just recalled.
      const returned = returnedRackIdxs.has(i) ? ' bt2-returned' : '';
      const display = isJoker
        ? `<span class="jok-sym"><img class="jok-img" src="jocker.PNG" alt=""></span>`
        : letter;
      const valDisplay = isJoker ? '' : val;
      const anim = shouldAnimate ? ` anim-in" style="animation:tileDropIn .35s cubic-bezier(.22,.68,0,1.2) both;animation-delay:${i * 35}ms"` : '"';
      const dataLetter = isJoker ? '?' : letter;
      html += `<div class="bt2${sel}${jok}${arrived}${returned}${anim} data-rack-letter="${dataLetter}" data-rack-idx="${i}"><span class="bt2-l">${display}</span><span class="bt2-v">${valDisplay}</span></div>`;
    }
    // Consume the one-shot return markers so the settle plays only on this
    // rebuild, not on any later rack render.
    returnedRackIdxs.clear();
    brack.innerHTML = html;
  }

  function renderLockInventory(v) {
    // The box shows what's still available to place: the engine inventory
    // MINUS the lock currently previewed on the board, so a lock visibly
    // leaves the box the moment it lands on a square and comes back when the
    // player returns it.
    const inventory = displayLockInventory(v);
    // Drop a selection that no longer points at a real button (e.g. the lock
    // was just placed, shrinking the list).
    if (selectedLock && selectedLock.index >= inventory.length) selectedLock = null;
    const affordable = canAffordLock(v);
    if (!affordable) selectedLock = null;

    // The player's own lock box is the `is-pclocks` strip in their info-strip
    // score card — that is the ONLY lock UI actually on screen. The original
    // `#lock-inv-display` picker lives in `.right-panel`, which the retired
    // side-panel layout hides (`display:none !important`), so it is filled too
    // but is invisible in practice. Rendering only there is what made locks
    // unclickable: there was nothing on screen to click.
    const actingSlot = v.mySlot != null ? v.mySlot : v.currentTurnSlot;
    for (const slot of [0, 1]) {
      const box = $(`#is-locks-${slot + 1}`, root);
      if (!box) continue;
      if (slot === actingSlot) {
        fillLockBox(box, inventory, affordable, { interactive: true });
      } else {
        // The other player's locks render as the SAME bordered chips, just
        // inert — a player's lock count shouldn't change appearance (losing
        // its frame) simply because the turn passed to the other side.
        fillLockBox(box, normalizeInventory(v.lockInventory?.[slot]), true, { interactive: false });
      }
    }
    if (lockInvDisplay) fillLockBox(lockInvDisplay, inventory, affordable, { interactive: true });
  }

  // Paint one lock box: a chip per lock the player still holds. `interactive`
  // boxes (the acting player's) are clickable and grey out when the player
  // can't pay the cost; non-interactive ones (the other player's) render the
  // same bordered chips but are inert, so a card never loses its lock frames
  // just because the turn moved to the other side.
  // Shared by the info-strip boxes and the legacy side-panel picker.
  function fillLockBox(box, inventory, affordable, { interactive = true } = {}) {
    box.innerHTML = '';
    if (!inventory.length) {
      box.classList?.remove?.('is-disabled');
      box.title = '';
      setText(box, 'אין');
      return;
    }
    if (!affordable) {
      box.classList?.add?.('is-disabled');
      box.title = `צריך ${LOCK_POINT_COST} נקודות כדי לנעול`;
    } else {
      box.classList?.remove?.('is-disabled');
      box.title = '';
    }
    inventory.forEach((duration, i) => {
      const selected = interactive && affordable && selectedLock?.index === i;
      const btn = makeLockButton(root, duration, i, selected);
      if (!affordable) {
        btn.disabled = true;
        btn.classList?.add?.('is-disabled');
        btn.setAttribute?.('aria-disabled', 'true');
      }
      if (!interactive) {
        // Keep the frame, drop the affordance: no listener, not focusable, and
        // `--static` suppresses the pointer cursor / hover without dimming it.
        btn.disabled = true;
        btn.classList?.add?.('lock-inv-btn--static');
        btn.setAttribute?.('tabindex', '-1');
        box.appendChild?.(btn);
        return;
      }
      cleanups.push(on(btn, 'click', (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        if (!canAffordLock(controller.view)) return; // can't afford — ignore
        selectedRackIndex = null;
        selectedPlacedCoord = null;
        pendingLockSelected = false;
        // Toggle: clicking the glowing lock again de-selects it.
        selectedLock = selectedLock?.index === i ? null : { index: i, duration };
        renderRack(controller.view);
        renderLockInventory(controller.view);
        renderBoard(controller.view);
        renderStatus(controller.view);
      }));
      box.appendChild?.(btn);
    });
  }

  function emitLivePreview(v) {
    if (!bus || !v || v.mySlot == null || !v.isMyTurn) return;
    const tiles = (v.placed ?? []).map(p => ({
      r: p.r, c: p.c, letter: p.letter, val: p.val, isJoker: !!p.isJoker,
    }));
    const sig = JSON.stringify(tiles);
    if (sig === lastOwnPreviewSignature) return;
    lastOwnPreviewSignature = sig;
    bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, { slot: v.mySlot, tiles });
  }

  // ─── Animation renderer wiring ──────────────────────────
  if (animationController) {
    animationController.setRenderer({
      tilePlaceIn: ({ placed }) => {
        for (const p of placed ?? []) {
          const cell = $(`#c${p.r}_${p.c}`, root);
          const tile = cell?.querySelector?.('.btile') ?? cell;
          if (tile) flashClass(tile, 'tile-place-in', 260);
        }
      },
      acceptedWordSweep:  (payload) => playAcceptedWordSweep(root, payload, prefersReducedMotion()),
      shakeWord:          ({ placed, invalidWordTiles } = {}) => {
        // Tile-level shake: flash `is-invalid` on the .btile inside each
        // affected cell. Prefer the full illegal-word tiles when the engine
        // supplies them so the shake covers existing letters that complete
        // the bad word, not just the new placements.
        const coords = coordsForInvalid(invalidWordTiles, placed);
        for (const { r, c } of coords) {
          const cell = $(`#c${r}_${c}`, root);
          if (!cell) continue;
          const target = cell.querySelector?.('.btile') ?? cell;
          flashClass(target, 'is-invalid', 260);
        }
      },
      illegalPulse:       ({ placed, invalidWordTiles } = {}) => {
        // Paint a static strong-red border on the .btile itself (the cell's
        // children fill 100% of the cell, so a cell-level border ends up
        // hidden behind them). The .cell still gets `illegal-tile-host` so
        // CSS can knock back the cell's tile background too. The red is held
        // briefly then released; the shake supplies the motion (Phase 3B —
        // no looping pulse, no second red effect saying the same thing).
        //
        // Highlight the whole illegal word — placed letters AND any existing
        // tiles that formed the bad word — when the engine supplies their
        // coordinates. Falls back to just the placed tiles for old payloads.
        const cells = [];
        const tiles = [];
        const placedCoords = new Set((placed ?? []).map(p => `${p.r},${p.c}`));
        const coords = coordsForInvalid(invalidWordTiles, placed);
        for (const { r, c } of coords) {
          const cell = $(`#c${r}_${c}`, root);
          if (!cell) continue;
          cells.push({ cell, isPlaced: placedCoords.has(`${r},${c}`) });
          cell.classList?.add('illegal-tile-host');
          const tile = cell.querySelector?.('.btile');
          if (tile) {
            tile.classList?.add('illegal-tile');
            tiles.push(tile);
          } else {
            cell.classList?.add('illegal-tile');
          }
        }
        if (!cells.length) return;
        setTimeout(() => {
          for (const tile of tiles) tile.classList?.remove('illegal-tile');
          for (const { cell, isPlaced } of cells) {
            cell.classList?.remove('illegal-tile', 'illegal-tile-host');
            // Only the just-placed tiles rollback-pop (they're about to be
            // recalled). Existing committed tiles stay put.
            if (isPlaced) flashClass(cell, 'rollback-pop', 260);
          }
        }, 500);
      },
      scoringPointsFloat: (payload) => floatScore(root, payload),
      scoreFlyToPanel:    (payload) => flyScoreToPanel(root, payload),
      scorePop:           ({ slot, delayMs = 0 }) => {
        const fire = () => {
          flashClass($(`#sv${slot + 1}`, root), 'score-pop', 500);
          flashClass($(`#is-sv${slot + 1}`, root), 'score-pop', 500);
        };
        if (delayMs > 0) setTimeout(fire, delayMs); else fire();
      },
      scoreMergeSequence: (payload) => {
        const onComplete = beginScorePresentation();
        try { playScoreMergeSequence(root, { ...payload, onComplete }); }
        catch (error) { onComplete(); throw error; }
      },
      bingoLabel:         (payload) => floatBonusLabel(root, payload, 'BINGO +50', 'bingo-label'),
      // multiplierLabel renderer removed — the directive no longer fires (it
      // rendered a misleading bare "×"; see animationController + spec §1.5).
      // bonusExtraLabel is intentionally not wired — every bonus-square
      // activation now opens the modal `bonusAwardOverlay` so the player
      // can't miss it. Leaving the renderer keyed but unused would let a
      // stale caller silently revive the legacy "+BONUS" float.
      bonusAwardOverlay:  (payload) => showBonusAwardOverlay(root, bus, controller, payload),
      turnEffectBanner:   (payload) => showTurnEffectBanner(root, payload),
      bonusActivate:      ({ bonusIdx, slot }) => {
        boostSquareCues.get(bonusIdx)?.clear();
        boostSquareCues.set(bonusIdx, { slot, clear: flashBonusSquare(root, bonusIdx) });
      },
      yourTurnCue:        ({ slot }) => emphasizeYourTurn(root, slot),
      playerGlowPulse: () => {
        // The active-slot glow is driven by `renderScores` against
        // `displayedTurnSlot` (which holds the previous slot until the
        // count-up finishes). On TURN_CHANGED the engine fires this
        // directive with the NEW slot — honoring that here would race
        // renderScores and leave BOTH boxes with `.act`. The pulse-restart
        // is handled inside renderScores via a remove → reflow → add cycle
        // whenever the displayed slot actually flips.
      },
      scorePanelArrive:   ({ winnerSlot } = {}) => {
        if (winnerSlot == null) return;
        flashClass($(`#sb${winnerSlot + 1}`, root), 'score-panel-arrive', 540);
        flashClass($(`#is-sb${winnerSlot + 1}`, root), 'score-panel-arrive', 540);
      },
      overlayCardIn:      () => {/* CSS auto-runs `.ov:not(.hidden) > .ovc`; overlay show handled by endGameScreen */},
      bagBounce:          () => flashClass($('#bag-display', root), 'bag-bounce', 600),
      tileCascadeIn:      () => {
        animateNextRackRender = true;
        renderRack(controller.view);
      },
    });
  }

  function unmount() {
    // Stops an in-flight avatar lookup from painting a torn-down screen.
    disposed = true;
    clearBoostSquareCues();
    clearJokerSubs();
    for (const state of scoreTweens.values()) {
      if (state.raf)   try { cafFn(state.raf); } catch { /* swallow */ }
      if (state.timer) try { clearTimeout(state.timer); } catch { /* swallow */ }
    }
    scoreTweens.clear();
    for (const finish of [...scorePresentationCleanups]) finish();
    // Cancel the screen-lifetime timers so they can't fire a stale render (or
    // re-render the rack) against a torn-down screen after unmount.
    if (countUpPollHandle) { try { clearInterval(countUpPollHandle); } catch { /* swallow */ } countUpPollHandle = null; }
    if (activeSlotTimer) { try { clearTimeout(activeSlotTimer); } catch { /* swallow */ } activeSlotTimer = null; }
    if (recentlyArrivedClearTimer) { try { clearTimeout(recentlyArrivedClearTimer); } catch { /* swallow */ } recentlyArrivedClearTimer = null; }
    tentativeEntryCoords.clear();
    returnedRackIdxs.clear();
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return {
    unmount,
    // Test-only seams (the DOM stub can't parse rack children, so selection
    // state isn't observable via innerHTML). Prefixed `_`, unused in production.
    _getSelectedRackIndex: () => selectedRackIndex,
    _selectRack: (i) => selectRack(i),
  };
}

function makeExchangeTile(root, letter, index, selected) {
  const doc = ownerDocumentOf(root);
  const tile = doc?.createElement?.('button') ?? makeStubButton();
  tile.type = 'button';
  tile.className = `bt2${selected ? ' sel' : ''}${letter === '?' ? ' jok' : ''}`;
  if (tile.dataset) tile.dataset.index = String(index);
  else tile.setAttribute?.('data-index', String(index));
  const isJoker = letter === '?';
  // Joker shows the joker.PNG glyph (same as the rack), not the '?' literal.
  const display = isJoker
    ? `<span class="jok-sym"><img class="jok-img" src="jocker.PNG" alt=""></span>`
    : letter;
  const val = isJoker ? '' : (HV[letter] ?? 0);
  tile.innerHTML = `<span class="bt2-l">${display}</span><span class="bt2-v">${val}</span>`;
  return tile;
}

function makeExchangeConfirmButton(root, count) {
  const doc = ownerDocumentOf(root);
  const btn = doc?.createElement?.('button') ?? makeStubButton();
  btn.type = 'button';
  btn.className = 'ovb p';
  btn.textContent = count ? `🔄 החלף (${count})` : '🔄 החלף';
  btn.style.marginInlineStart = '8px';
  return btn;
}

function makeLockButton(root, duration, index, selected) {
  const doc = ownerDocumentOf(root);
  const btn = doc?.createElement?.('button') ?? makeStubButton();
  btn.type = 'button';
  btn.className = `lock-inv-btn${selected ? ' active' : ''}`;
  btn.textContent = `🔒 ${duration}`;
  btn.title = `Lock a cell for ${duration} turns (costs ${LOCK_POINT_COST} points)`;
  btn.setAttribute?.('data-lock-duration', String(duration));
  btn.setAttribute?.('aria-pressed', selected ? 'true' : 'false');
  btn.setAttribute?.('aria-label', `Lock duration ${duration}, costs ${LOCK_POINT_COST} points`);
  if (btn.dataset) {
    btn.dataset.lockDuration = String(duration);
    btn.dataset.index = String(index);
  }
  return btn;
}

function makeStubButton() {
  const listeners = [];
  return {
    className: '', textContent: '', innerHTML: '', style: {}, dataset: {}, type: 'button',
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

// ─── helpers ──────────────────────────────────────────────

function coordsForInvalid(invalidWordTiles, placed) {
  // Prefer the full per-word tile list (placed + already-committed letters
  // that completed the bad word). Falls back to the just-placed tiles if the
  // engine didn't send invalidWordTiles (older payloads or tests).
  const out = [];
  const seen = new Set();
  const push = (r, c) => {
    if (!Number.isInteger(r) || !Number.isInteger(c)) return;
    const k = `${r},${c}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ r, c });
  };
  if (Array.isArray(invalidWordTiles)) {
    for (const word of invalidWordTiles) {
      for (const t of word ?? []) push(t.r, t.c);
    }
  }
  if (out.length === 0) {
    for (const p of placed ?? []) push(p.r, p.c);
  }
  return out;
}

// A cell holds a REAL tile only if it has a letter (or is a joker, which always
// carries its chosen letter). A truthy-but-letterless object — e.g. `{}` or
// `{ letter: null }` — is malformed: tileHTML renders it as a glyph-less .btile
// (a blank square) and every "occupied?" check below treats it as filled, so
// the cell looks empty yet rejects placement and can't be cleared without an
// app restart (which re-reads the clean authoritative board). This has been
// reported ("empty squares sometimes disabled"); no persisted room carries such
// a cell (audited across prod /rooms), so the corruption is transient and
// in-memory. Treating a malformed cell as EMPTY makes the symptom self-heal,
// and reportMalformedCell() logs it so the source can finally be caught.
function isRealTile(tile) {
  if (!tile || typeof tile !== 'object') return false;
  if (tile.isJoker) return true;
  return tile.letter != null && tile.letter !== '';
}

const _reportedMalformedCells = new Set();
function reportMalformedCell(r, c, tile) {
  const key = `${r},${c}`;
  if (_reportedMalformedCells.has(key)) return;
  _reportedMalformedCells.add(key);
  try {
    console.warn('[gameScreen] malformed board cell treated as empty', { r, c, tile: JSON.stringify(tile) });
  } catch { /* JSON.stringify guard */ }
}

// Real committed tile at (r,c), or null. A malformed (letterless) object is
// reported and treated as empty. On-grid uses _board; perimeter uses _bonusBoard.
function committedTileAt(view, r, c) {
  const raw = (r >= 0 && r < 10 && c >= 0 && c < 10)
    ? (view?._board?.[r]?.[c] ?? null)
    : (view?._bonusBoard?.get?.(`${r},${c}`) ?? null);
  if (raw && !isRealTile(raw)) { reportMalformedCell(r, c, raw); return null; }
  return raw;
}

function isCellBlockedForPlacement(view, r, c) {
  // Locked by an active lock.
  const locked = (view?.lockedCells ?? []).some(l => l.r === r && l.c === c && (l.remainingTurns ?? 0) > 0);
  if (locked) return true;
  // Has a real committed tile (on-grid or perimeter bonus square). Goes through
  // committedTileAt so a malformed cell is treated as empty here too — otherwise
  // the cell would block placement while rendering blank.
  return committedTileAt(view, r, c) != null;
}

function lastMoveCoordSet(view) {
  // Coordinates of the tiles that the previous player ACTUALLY placed this
  // turn. Existing letters that became part of the formed words are NOT
  // included — the goal is to show the opponent only the new tiles.
  const set = new Set();
  for (const p of view?.lastMove?.placed ?? []) {
    if (p && Number.isInteger(p.r) && Number.isInteger(p.c)) set.add(`${p.r},${p.c}`);
  }
  return set;
}

// Real committed tile at (r,c) for the RENDERER. On-grid (0..9 × 0..9) reads
// the 2D array; off-grid perimeter coords (br/bc ∈ {-1, 10}) read _bonusBoard
// (a Map keyed "r,c") — without that fallback tiles on a perimeter bonus vanish
// on commit. Delegates to committedTileAt so a malformed cell renders as empty
// (rather than a glyph-less .btile) and stays consistent with the block check.
function boardTileAt(view, r, c) {
  return committedTileAt(view, r, c);
}

function lockAt(view, r, c) {
  return (view.lockedCells ?? []).find(lock => lock.r === r && lock.c === c && (lock.remainingTurns ?? 0) > 0) ?? null;
}

function previewTileAt(view, r, c) {
  const preview = view?._livePreview;
  if (!preview?.tiles?.length) return null;
  return preview.tiles.find(t => t.r === r && t.c === c) ?? null;
}

function isOpponentPreview(view, r, c) {
  const preview = view?._livePreview;
  if (!preview || preview.slot == null || preview.slot === view.mySlot) return false;
  return !!previewTileAt(view, r, c);
}

function tileHTML(tile, isPlaced, extraClass = '') {
  const isJoker = !!tile.isJoker;
  const cls = `btile${isPlaced ? ' nw' : ''}${isJoker ? ' jk' : ''}${extraClass ? ` ${extraClass}` : ''}`;
  // Pure-joker (no chosen letter) shows the jocker.PNG image; a joker that
  // has been resolved to a real letter shows the picked letter (no image).
  const display = isJoker && !tile.letter
    ? `<span class="jok-sym"><img class="jok-img" src="jocker.PNG" alt=""></span>`
    : (tile.letter ?? '');
  const val = isJoker ? '' : (tile.val ?? '');
  return `<div class="${cls}"><div class="bt-l">${display}</div><div class="bt-v">${val}</div></div>`;
}

function lockHTML(lock) {
  const turns = Math.max(1, Number(lock.remainingTurns ?? 1));
  return `<div class="spine-lock-badge"><span class="spine-lock-icon">🔒</span><span class="spine-lock-turns">${turns}</span></div>`;
}

function lockInventoryForView(view) {
  const slot = view.mySlot != null ? view.mySlot : view.currentTurnSlot;
  return normalizeInventory(view.lockInventory?.[slot]);
}

// What the lock box should show: the acting player's inventory minus the lock
// currently previewed on the board (one instance of its duration). A pending
// lock has not reached the engine yet, so it's still in `lockInventory` — this
// is what makes a lock visibly leave the box when placed and reappear when the
// player sends it back.
function displayLockInventory(view) {
  const inventory = lockInventoryForView(view);
  const pending = view.pendingLock;
  if (!pending) return inventory;
  const i = inventory.indexOf(Number(pending.duration));
  if (i < 0) return inventory;
  return [...inventory.slice(0, i), ...inventory.slice(i + 1)];
}

// The acting player on this client can only spend a lock if their score covers
// the LOCK_POINT_COST charge. Below that the lock picker is disabled
// (the engine enforces the same rule as `lock-insufficient-points`).
function canAffordLock(view) {
  const slot = view.mySlot != null ? view.mySlot : view.currentTurnSlot;
  return (view.scores?.[slot] ?? 0) >= LOCK_POINT_COST;
}

// Coerce a raw lockInventory entry into the positive integers we render.
// (Replaced `lockSummaryText`, which produced the plain-text "🔒3 🔒3 🔒5"
// summary the non-acting player's card used to show — both cards now render
// real bordered chips instead.)
function normalizeInventory(inventory) {
  return [...(inventory ?? [])]
    .filter(n => Number.isInteger(Number(n)) && Number(n) > 0)
    .map(Number);
}

// The shared reflow-restart primitive (this was a byte-identical local copy).
// Same behaviour: remove class → force reflow → re-add → auto-remove after ms.
const flashClass = flashAnimation;

function flashWordTiles(root, { wordTiles, placed } = {}, className, durationMs) {
  const coords = uniqueTileCoords(wordTiles, placed);
  for (const { r, c } of coords) {
    const cell = root?.getElementById?.(`c${r}_${c}`) ?? root?.querySelector?.(`#c${r}_${c}`);
    const target = cell?.querySelector?.('.btile') ?? cell;
    flashClass(target, className, durationMs);
  }
}

function playAcceptedWordSweep(root, payload = {}, reducedMotion = false) {
  const coords = uniqueTileCoords(payload.wordTiles, payload.placed);
  if (!coords.length) return;
  if (reducedMotion || payload.reducedMotion) {
    flashWordTiles(root, payload, 'rm-accept', 420);
    return;
  }
  const plan = acceptedWordSweepPlan(payload.wordTiles, payload.placed);
  plan.forEach(({ r, c, delayMs, axis, secondary }) => {
    const cell = lookup(root, `c${r}_${c}`);
    if (!cell) return;
    // Animate the cell, not its .btile child. .cell has overflow:hidden, which
    // clipped the child's lift, scale, and outer glow almost completely at
    // real board size. Moving the effect one level up keeps the gold plate and
    // travelling front above the tile while allowing the cell itself to lift.
    cell.classList?.remove('accepted-word-sweep--horizontal', 'accepted-word-sweep--vertical', 'accepted-word-sweep--secondary');
    cell.classList?.add(`accepted-word-sweep--${axis === 'V' ? 'vertical' : 'horizontal'}`);
    if (secondary) cell.classList?.add('accepted-word-sweep--secondary');
    cell.style?.setProperty?.('--accept-delay', `${delayMs}ms`);
    flashClass(cell, 'accepted-word-sweep', delayMs + 460);
  });
}

// The scoring engine puts the main word first (getAllWords adds getMainWord
// before cross-words). Keep that representation authoritative: the primary
// word gets the strong front, while cross-words overlap with a lighter front.
// #game-grid inherits RTL direction, so column 0 is physically at the right
// edge and increasing columns move left. Horizontal Hebrew therefore travels
// in ascending column order; vertical words travel in ascending row order.
export function acceptedWordSweepPlan(wordTiles, placed = []) {
  const words = Array.isArray(wordTiles)
    ? wordTiles.filter(word => Array.isArray(word) && word.length)
    : [];
  if (!words.length && placed?.length) words.push(placed);
  if (!words.length) return [];

  const primaryKeys = new Set();
  const plan = [];
  words.forEach((word, wordIndex) => {
    const unique = uniqueTileCoords([word], []);
    if (!unique.length) return;
    const horizontal = unique.length < 2 || unique.every(t => t.r === unique[0].r);
    unique.sort(horizontal ? ((a, b) => a.c - b.c) : ((a, b) => a.r - b.r));

    // 110ms is the normal cadence. Only words longer than four tiles compress,
    // keeping the complete 420ms-per-tile sweep within a 750ms budget.
    const stepMs = unique.length > 1 ? Math.min(110, 330 / (unique.length - 1)) : 0;
    unique.forEach(({ r, c }, index) => {
      const key = `${r},${c}`;
      if (wordIndex === 0) primaryKeys.add(key);
      else if (primaryKeys.has(key)) return;
      plan.push({
        r, c,
        delayMs: Math.round(index * stepMs),
        axis: horizontal ? 'H' : 'V',
        secondary: wordIndex > 0,
      });
    });
  });
  return plan;
}

function uniqueTileCoords(wordTiles, placed) {
  const out = [];
  const seen = new Set();
  const flat = Array.isArray(wordTiles) && wordTiles.length
    ? wordTiles.flat().filter(Boolean)
    : (placed ?? []);
  for (const t of flat) {
    if (t?.r == null || t?.c == null) continue;
    const key = `${t.r},${t.c}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ r: t.r, c: t.c });
  }
  return out;
}

function floatScore(root, { score, wordTiles, placed, delayMs = 0 } = {}) {
  if (!score) return;
  const fire = () => {
    const doc = ownerDocumentOf(root);
    const label = doc?.createElement?.('div');
    if (!label) return;
    label.className = 'scoring-float-label';
    label.textContent = `+${score}`;
    const anchor = firstAnchorElement(root, wordTiles, placed) ?? lookup(root, 'game-grid');
    positionFixedLabel(label, anchor, { yOffset: -8 });
    appendOverlay(root, label);
    setTimeout(() => label.remove?.(), 650);
  };
  if (delayMs > 0) setTimeout(fire, delayMs); else fire();
}

// SUM_CHIP_HOLD_MS comes from ../scoreAnimationTimings.js (shared with
// animationController so per-word floats and the sum chip stay in sync).
// The sum chip pauses for SUM_CHIP_HOLD_MS at the played word's anchor
// before flying to the score panel, so the player has time to read the
// total. The companion timings (count-up delay in renderScores, glow
// duration in animationController's emitScoreSequence, score-pop,
// active-slot glow swap) all add this same hold so the sum chip's landing
// still synchronises with the count-up start and the panel glow flip.
// Per-word floats (`isSum = false`) keep the legacy snappy lifecycle.

function flyScoreToPanel(root, { slot, score, wordTiles, placed, delayMs = 0, isSum = false } = {}) {
  if (!score) return;
  const fire = () => {
    const doc = ownerDocumentOf(root);
    const chip = doc?.createElement?.('div');
    if (!chip) return;
    chip.className = isSum ? 'scoring-float-label is-sum' : 'scoring-float-label';
    chip.textContent = `+${score}`;
    chip.style.transition = 'transform 420ms cubic-bezier(.22,1,.36,1), opacity 420ms ease-out';
    const from = firstAnchorElement(root, wordTiles, placed) ?? lookup(root, 'game-grid');
    const to = scoreTargetForSlot(root, slot);
    positionFixedLabel(chip, from, { yOffset: 4 });
    appendOverlay(root, chip);
    const a = centerOf(from);
    const b = centerOf(to);
    const hold = isSum ? SUM_CHIP_HOLD_MS : 0;
    if (a && b) {
      setTimeout(() => {
        chip.style.transform = `translateX(-50%) translate(${b.x - a.x}px, ${b.y - a.y}px) scale(.72)`;
        chip.style.opacity = '0';
      }, 20 + hold);
    }
    setTimeout(() => {
      flashClass(to, 'score-panel-arrive', 360);
      chip.remove?.();
    }, 480 + hold);
  };
  if (delayMs > 0) setTimeout(fire, delayMs); else fire();
}

// Score-merge animation timings come from ../scoreAnimationTimings.js
// (single source of truth, shared with animationController). The local
// aliases preserve the descriptive `SCORE_MERGE_*` names used throughout
// this file without re-declaring values.

// Bounding rect of the slot's active ×N multiplier banner (mobile info-strip
// `is-` variant first, then desktop side-panel `sc-`), or null when neither is
// visible. Read synchronously at animation start because the boost is consumed
// this turn and the banner is removed on the next render.
function multiplierBannerRect(root, slot) {
  const doc = ownerDocumentOf(root);
  if (!doc?.getElementById) return null;
  for (const suffix of [`is-${slot}`, `sc-${slot}`]) {
    const el = doc.getElementById(`spine-multiplier-banner-${suffix}`);
    const rect = el?.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) return rect;
  }
  return null;
}

// The cohesive scoring animation. A red sum chip is planted above the
// played word(s). Each scoring word's +N chip launches at the word's
// anchor and flies into the sum chip, where it merges and bumps the
// running total + chip scale. If the move earned a bonus extra (the +N
// from a boost), that chip also flies into the sum. After a short hold
// the fully-sized sum chip flies into the player's score panel — same
// final beat as the old sequence, but now visibly the *total* of all the
// per-word + bonus contributions instead of a separate value that
// appears out of nowhere.
function playScoreMergeSequence(root, { slot, placed, words, finalScore, baseScore, bonusExtra, multiplier, onComplete = () => {} } = {}) {
  const total = Number(finalScore) || 0;
  const extra = Number(bonusExtra) || 0;
  const base  = baseScore != null ? Number(baseScore) : total - extra;
  const mult  = Number(multiplier) || 1;
  if (total <= 0 && extra <= 0) { onComplete(); return; }
  const doc = ownerDocumentOf(root);
  if (!doc?.createElement) { onComplete(); return; }

  // 1. Sum chip — planted at the first word's anchor (slightly above the
  // tile centre so the per-word chips can fly *up* to merge).
  const sumChip = doc.createElement('div');
  sumChip.className = 'scoring-float-label is-sum';
  sumChip.textContent = '+0';
  sumChip.style.transition = 'transform .22s cubic-bezier(.22,1,.36,1), opacity .42s ease-out';
  const wordTilesList = (words ?? []).map(w => w.wordTiles).filter(Boolean);
  const anchor = firstAnchorElement(root, wordTilesList, placed) ?? lookup(root, 'game-grid');
  positionFixedLabel(sumChip, anchor, { yOffset: -22 });
  appendOverlay(root, sumChip);

  let runningSum = 0;
  function updateSumDisplay() {
    sumChip.textContent = `+${runningSum}`;
    // Grow with the running total — caps around scale 1.55 at +100.
    const scale = 1 + Math.min(0.55, runningSum / 100 * 0.55);
    sumChip.style.transform = `translateX(-50%) scale(${scale})`;
  }

  // 2. Fly each scoring word's chip into the sum chip and add its score
  // when it lands.
  function flyChipIntoSum({ chip, fromEl, onLand, delayMs }) {
    setTimeout(() => {
      const from = centerOf(fromEl) ?? centerOf(anchor);
      const to   = centerOf(sumChip);
      appendOverlay(root, chip);
      if (from && to) {
        setTimeout(() => {
          chip.style.transform = `translateX(-50%) translate(${to.x - from.x}px, ${to.y - from.y}px) scale(.6)`;
          chip.style.opacity = '0';
        }, 20);
      }
      setTimeout(() => {
        chip.remove?.();
        onLand?.();
      }, SCORE_MERGE_WORD_FLIGHT_MS);
    }, delayMs);
  }

  (words ?? []).forEach((w, i) => {
    const ws = Number(w.wordScore) || 0;
    if (!ws) return;
    const chip = doc.createElement('div');
    chip.className = 'scoring-float-label';
    chip.textContent = `+${ws}`;
    chip.style.transition = `transform ${SCORE_MERGE_WORD_FLIGHT_MS}ms cubic-bezier(.22,1,.36,1), opacity ${SCORE_MERGE_WORD_FLIGHT_MS}ms ease-out`;
    const wordAnchor = firstAnchorElement(root, [w.wordTiles], placed) ?? anchor;
    positionFixedLabel(chip, wordAnchor, { yOffset: -4 });
    flyChipIntoSum({
      chip, fromEl: wordAnchor,
      delayMs: i * SCORE_MERGE_WORD_STAGGER_MS,
      onLand: () => { runningSum += ws; updateSumDisplay(); },
    });
  });

  const wordCount = (words ?? []).filter(w => Number(w.wordScore) > 0).length;
  const rawTileSum = (words ?? []).reduce((a, w) => a + (Number(w.wordScore) || 0), 0);
  const hasMult = mult > 1 && rawTileSum >= 0 && base > rawTileSum;
  // What the ×N chip adds when it lands: the running word sum jumps from the
  // raw tile value to the multiplied word score (`base`). Any bingo folded into
  // `base` rides along in this jump (the bingo has its own +50 label already).
  const multDelta = hasMult ? Math.max(0, base - rawTileSum) : 0;

  const { multStart, boostStart, mergeEnd } =
    mergeSequenceTiming({ wordCount, bonusExtra: extra, multiplier: hasMult ? mult : 1 });

  // 3. Multiplier chip — flies in from the player's ×N banner and multiplies
  //    the running word sum (raw → ×N) the moment it lands. Purple for ×2, red
  //    for ×4 (matching .spine-multiplier-banner). The banner is captured now
  //    because the boost is consumed this turn and its banner may be removed
  //    before the chip flies.
  if (hasMult && multDelta > 0) {
    const bannerRect = multiplierBannerRect(root, slot);
    setTimeout(() => {
      const chip = doc.createElement('div');
      chip.className = 'scoring-float-label mult-merge';
      chip.textContent = `×${mult}`;
      const red = mult >= 4;
      chip.style.background = red
        ? 'linear-gradient(135deg, rgba(186,24,27,.97), rgba(255,91,46,.94))'
        : 'linear-gradient(135deg, rgba(99,54,190,.97), rgba(193,75,255,.92))';
      chip.style.color = '#fff';
      chip.style.padding = '2px 9px';
      chip.style.borderRadius = '11px';
      chip.style.fontWeight = '900';
      chip.style.boxShadow = '0 4px 12px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.25)';
      chip.style.textShadow = red
        ? '0 0 8px rgba(255,224,130,.75), 0 1px 2px rgba(0,0,0,.5)'
        : '0 0 8px rgba(231,202,255,.7), 0 1px 2px rgba(0,0,0,.5)';
      chip.style.transition = `transform ${SCORE_MERGE_WORD_FLIGHT_MS}ms cubic-bezier(.22,1,.36,1), opacity ${SCORE_MERGE_WORD_FLIGHT_MS}ms ease-out`;
      const to = centerOf(sumChip);
      let from = null;
      if (bannerRect) {
        from = { x: bannerRect.left + bannerRect.width / 2, y: bannerRect.top + bannerRect.height / 2 };
      } else {
        const sr = sumChip.getBoundingClientRect?.();
        if (sr) from = { x: sr.left + sr.width / 2, y: sr.top - 64 };
      }
      if (from) {
        chip.style.position = 'fixed';
        chip.style.left = `${from.x}px`;
        chip.style.top  = `${from.y}px`;
        chip.style.transform = 'translateX(-50%)';
      }
      appendOverlay(root, chip);
      setTimeout(() => {
        if (from && to) {
          chip.style.transform = `translateX(-50%) translate(${to.x - from.x}px, ${to.y - from.y}px) scale(.7)`;
        }
        chip.style.opacity = '0';
      }, 20);
      setTimeout(() => {
        chip.remove?.();
        runningSum += multDelta; // sum visibly jumps to the multiplied value
        updateSumDisplay();
      }, SCORE_MERGE_WORD_FLIGHT_MS);
    }, multStart ?? 0);
  }

  // 4. Bonus extra — flies into the sum from above, AFTER the multiplier (the
  //    bonus is never multiplied, so it merges on top of the multiplied word).
  if (extra > 0) {
    setTimeout(() => {
      const chip = doc.createElement('div');
      chip.className = 'scoring-float-label boost-merge';
      chip.textContent = `+${extra}`;
      chip.style.color = '#ffd75e';
      chip.style.textShadow = '0 0 10px rgba(255,210,80,.85), 0 1px 2px rgba(0,0,0,.85)';
      chip.style.transition = `transform ${SCORE_MERGE_WORD_FLIGHT_MS}ms cubic-bezier(.22,1,.36,1), opacity ${SCORE_MERGE_WORD_FLIGHT_MS}ms ease-out`;
      const sumRect = sumChip.getBoundingClientRect?.();
      if (sumRect) {
        chip.style.position = 'fixed';
        chip.style.left = `${sumRect.left + sumRect.width / 2}px`;
        chip.style.top  = `${sumRect.top - 56}px`;
      }
      appendOverlay(root, chip);
      setTimeout(() => {
        chip.style.transform = 'translateX(-50%) translateY(56px) scale(.6)';
        chip.style.opacity = '0';
      }, 20);
      setTimeout(() => {
        chip.remove?.();
        runningSum += extra;
        updateSumDisplay();
      }, SCORE_MERGE_WORD_FLIGHT_MS);
    }, boostStart ?? 0);
  }

  // Defensive top-up: add ONLY the delta the merges (words + multiplier chip +
  // bonus) can't cover — e.g. a bingo/premium on a non-multiplied move. ADD (not
  // overwrite) so it's order-independent against the per-chip onLand callbacks.
  // When a multiplier is present the ×N chip already carries the full jump, so
  // `missing` is 0.
  const expectedFromMerges = rawTileSum + multDelta + extra;
  const missing = total - expectedFromMerges;
  if (missing > 0) {
    setTimeout(() => {
      runningSum += missing;
      updateSumDisplay();
    }, mergeEnd + 20);
  }

  // 4. Hold + fly sum chip into the player's score panel.
  setTimeout(() => {
    const targetEl = scoreTargetForSlot(root, slot);
    if (!targetEl) { sumChip.remove?.(); onComplete(); return; }
    const a = centerOf(sumChip);
    const b = centerOf(targetEl);
    sumChip.style.transition = `transform ${SCORE_MERGE_SUM_FLIGHT_MS}ms cubic-bezier(.22,1,.36,1), opacity ${SCORE_MERGE_SUM_FLIGHT_MS}ms ease-out`;
    if (a && b) {
      setTimeout(() => {
        sumChip.style.transform = `translateX(-50%) translate(${b.x - a.x}px, ${b.y - a.y}px) scale(.6)`;
        sumChip.style.opacity = '0';
      }, 20);
    }
    setTimeout(() => {
      // One clear landing response — the panel pulse — plus the count-up on the
      // number. Phase 3B removed the radial hit-burst and the separate score-pop
      // that used to fire on this same frame (three emphases for one moment).
      flashClass(targetEl, 'score-panel-arrive', 360, onComplete);
      sumChip.remove?.();
    }, SCORE_MERGE_SUM_FLIGHT_MS);
  }, mergeEnd + SCORE_MERGE_HOLD_AFTER_MS);
}

function firstAnchorElement(root, wordTiles, placed) {
  const first = uniqueTileCoords(wordTiles, placed)[0];
  if (!first) return null;
  return lookup(root, `c${first.r}_${first.c}`);
}

function centerOf(el) {
  const rect = el?.getBoundingClientRect?.();
  if (!rect) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function scoreTargetForSlot(root, slot) {
  const ids = [`sv${slot + 1}`, `is-sv${slot + 1}`, `sb${slot + 1}`, `is-sb${slot + 1}`];
  const candidates = ids.map(id => lookup(root, id)).filter(Boolean);
  return candidates.find(hasUsableRect) ?? candidates[0] ?? null;
}

function hasUsableRect(el) {
  const rect = el?.getBoundingClientRect?.();
  if (!rect) return false;
  return rect.width > 0 && rect.height > 0;
}

function positionFixedLabel(el, anchor, { yOffset = 0 } = {}) {
  const p = centerOf(anchor) ?? { x: globalThis.innerWidth / 2 || 0, y: globalThis.innerHeight / 2 || 0 };
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y + yOffset}px`;
}

function appendOverlay(root, el) {
  const doc = ownerDocumentOf(root);
  (doc?.body ?? doc?.documentElement ?? root)?.appendChild?.(el);
}

function floatBonusLabel(root, { wordTiles, placed } = {}, text, extraClass) {
  const doc = ownerDocumentOf(root);
  const label = doc?.createElement?.('div');
  if (!label) return;
  label.className = `scoring-float-label ${extraClass ?? ''}`.trim();
  label.textContent = text;
  const anchor = firstAnchorElement(root, wordTiles, placed) ?? lookup(root, 'game-grid');
  positionFixedLabel(label, anchor, { yOffset: -16 });
  appendOverlay(root, label);
  setTimeout(() => label.remove?.(), 720);
}

export const BONUS_AWARD_ACK = 'bonus/award-acknowledged';

// How long a turn-flow banner stays on screen before fading out.
export const TURN_EFFECT_BANNER_MS = 3400;

// Pure: turn one turn-flow effect into the banner copy for THIS client.
//
// `mySlot` is the local player's seat, or null for a shared-screen 2P game
// (where there is no "me", so the copy names the player instead). Returns
// null when there is nothing worth saying.
export function describeTurnEffect(effect, mySlot = null) {
  if (!effect?.type) return null;
  const shared = mySlot !== 0 && mySlot !== 1;
  const playerName = slot => `שחקן ${(slot ?? 0) + 1}`;

  if (effect.type === 'extra-turn') {
    const mine = !shared && effect.slot === mySlot;
    if (shared) return { tone: 'info', icon: '🎯', text: `${playerName(effect.slot)} משחק תור נוסף` };
    // The player who won it already saw the award card; the banner exists for
    // the one who is about to wait through another turn.
    return mine
      ? { tone: 'good', icon: '🎯', text: 'זכית בתור נוסף — שחק שוב' }
      : { tone: 'warn', icon: '🎯', text: 'היריב זכה בתור נוסף ומשחק שוב' };
  }

  if (effect.type === 'skip-turn') {
    const victim = effect.slot;
    if (shared) return { tone: 'info', icon: '⏭️', text: `${playerName(victim)} מדלג על התור` };
    return victim === mySlot
      ? { tone: 'warn', icon: '⏭️', text: 'הפסדת את התור — היריב הפעיל דילוג תור' }
      : { tone: 'good', icon: '⏭️', text: 'היריב מדלג על התור שלו' };
  }

  return null;
}

// Non-blocking notice pinned above the board. Self-dismisses; never gates
// gameplay or score animation (see animationController's TURN_EFFECTS_APPLIED
// subscription for why this is a banner and not the modal award card).
function showTurnEffectBanner(root, payload) {
  const info = describeTurnEffect(payload, payload?.mySlot ?? null);
  if (!info) return;
  const doc = ownerDocumentOf(root);
  const el = doc?.createElement?.('div');
  if (!el) return;
  el.className = `turn-effect-banner tone-${info.tone}`;
  el.setAttribute?.('role', 'status');
  el.setAttribute?.('data-turn-effect', payload.type);
  el.textContent = `${info.icon} ${info.text}`;
  appendOverlay(root, el);
  // Two-phase so the CSS transition has a frame to run against.
  setTimeout(() => el.classList?.add('is-in'), 20);
  setTimeout(() => {
    el.classList?.remove('is-in');
    setTimeout(() => el.remove?.(), 320);
  }, TURN_EFFECT_BANNER_MS);
}

// One-line Hebrew descriptions of every boost the player can land on. Each
// row drives the modal overlay so the player always sees what they got.
function describeBoost(boostId, payload, extra) {
  const p = payload ?? {};
  switch (boostId) {
    case 'auto_extra_score':
      return {
        title: 'בוסט ניקוד!',
        bigText: `+${extra || p.extra || 0} נק'`,
        sub:   'הנקודות יתווספו עם אישור',
      };
    case 'extra_turn':
      return { title: 'תור נוסף!', image: 'assets/rewards/extra turn.png', sub: 'תקבל תור נוסף ברצף' };
    case 'multiply_next_turns': {
      const mult  = Number(p.multiplier ?? 2);
      const turns = Number(p.turnsRemaining ?? 1);
      return {
        title: `הכפלת ניקוד ×${mult}!`,
        bigText: `×${mult}`,
        sub: turns > 1 ? `הניקוד יוכפל ב-${turns} התורים הבאים` : 'הניקוד יוכפל בתור הבא',
      };
    }
    case 'timer_bonus':
      return {
        title: 'בוסט זמן',
        bigText: `+${Number(p.seconds ?? 0)} שניות`,
        sub: 'יתווסף לזמן התור הבא',
      };
    // The next three used bare emoji, which the overlay painted gold (see
    // showBonusAwardOverlay) — they showed up as meaningless yellow discs.
    // pause.png / rematch.png are already Boost-family art (blue sphere, cyan
    // ring, glossy 3D), so they slot in next to 'extra turn.png' cleanly.
    // Bespoke artwork is still tracked in docs/asset_inventory.md.
    case 'free_tile_swap':
      return {
        title: 'החלפת אות חינם',
        image: 'assets/ui/rematch.png',       // circular swap arrows
        bigEmoji: '🔄',
        sub: 'תוכל להחליף אותיות בלי לוותר על התור',
      };
    case 'skip_opponent_turn':
      return {
        title: 'דילוג על תור היריב',
        image: 'assets/ui/pause.png',         // the opponent's turn is halted
        bigEmoji: '⏭️',
        sub: 'היריב יפסיד את התור הבא',
      };
    case 'cancel_next_opponent_bonus':
      // No usable shield asset (the achievements shield is a multi-object sheet
      // with a baked-in background), so this stays an emoji — but as bigEmoji it
      // renders as a real colour shield instead of a gold blob.
      return { title: 'ביטול בוסט יריב', bigEmoji: '🛡️', sub: 'הבוסט הבא של היריב יבוטל' };
    default:
      return { title: 'בוסט הופעל', bigEmoji: '⚡', sub: '' };
  }
}

function showBonusAwardOverlay(root, bus, controller, { slot, extra, boostId, bonusIdx, boostPayload, isOpponent } = {}) {
  const doc = ownerDocumentOf(root);
  if (!doc?.createElement) return;
  const info = describeBoost(boostId, boostPayload, extra);
  // Modal overlay — same .ov / .ovc / .ovic / .ovt / .ovd skeleton as the
  // bonus intro screen. Stays open with a dim backdrop until the player
  // clicks אישור. While it's up the bot pauses (see attachBotPlayer).
  const positioner = doc.createElement('div');
  positioner.className = 'bonus-award-positioner';
  positioner.style.cssText = [
    'position:fixed','inset:0','z-index:9999',
    'display:flex','align-items:center','justify-content:center',
    'background:rgba(0,0,0,.55)',
    'opacity:0','transition:opacity .25s ease',
  ].join(';');
  const card = doc.createElement('div');
  card.className = 'ovc bonus-award-card';
  card.style.cssText = [
    'transform:scale(.7)',
    'transition:transform .35s cubic-bezier(.22,1.4,.36,1)',
    'min-width:240px','max-width:340px','pointer-events:auto',
  ].join(';');
  // Three ways to render the big icon, in priority order:
  //   image    — real artwork (best; e.g. 'extra turn.png')
  //   bigEmoji — an emoji glyph. Rendered WITHOUT `color`, because glyphs like
  //              🛡/⏱ default to TEXT presentation (monochrome) and a `color`
  //              override paints them as a solid gold disc — the "meaningless
  //              yellow circle". Left untinted they render as real color emoji.
  //   bigText  — actual text (e.g. '×2', "+50 נק'"), which SHOULD be gold.
  const BIG_TEXT_CSS  = 'font-size:32px;font-weight:900;color:var(--by);margin-bottom:4px;';
  const BIG_EMOJI_CSS = 'font-size:56px;line-height:1.1;margin-bottom:4px;';
  const bigFallback = info.bigEmoji
    ? `<div class="ovd" style="${BIG_EMOJI_CSS}">${escapeForOverlay(info.bigEmoji)}</div>`
    : `<div class="ovd" style="${BIG_TEXT_CSS}">${escapeForOverlay(info.bigText ?? '')}</div>`;
  const bigBlock = info.image
    ? `<div class="ovd" style="margin-bottom:4px;"><img data-boost-img src="${escapeForOverlay(info.image)}" alt="${escapeForOverlay(info.title)}" style="width:72px;height:72px;object-fit:contain;"></div>`
    : bigFallback;
  card.innerHTML = `
    <div class="ovic">⚡</div>
    <div class="ovt">${escapeForOverlay(info.title)}</div>
    ${bigBlock}
    ${info.sub ? `<div class="ovd" style="margin-bottom:12px;">${escapeForOverlay(info.sub)}</div>` : ''}
    <div class="ovd" style="margin-bottom:12px;font-size:11px;opacity:.6;">${isOpponent ? 'הבוט' : `שחקן ${(slot ?? 0) + 1}`}</div>
    <div class="ovbtns"><button type="button" class="ovb p" data-bonus-ok>אישור ✓</button></div>
  `;
  positioner.appendChild(card);
  appendOverlay(root, positioner);
  // If a boost's artwork is missing (asset not shipped / cache miss), swap the
  // broken <img> for the text fallback rather than showing a broken-image box.
  const boostImg = card.querySelector?.('[data-boost-img]');
  if (boostImg && (info.bigEmoji || info.bigText)) {
    boostImg.addEventListener?.('error', () => {
      const fallback = doc.createElement('div');
      fallback.className = 'ovd';
      fallback.style.cssText = info.bigEmoji ? BIG_EMOJI_CSS : BIG_TEXT_CSS;
      fallback.textContent = info.bigEmoji ?? info.bigText;
      boostImg.replaceWith?.(fallback);
    });
  }
  requestAnimationFrameSafe(() => {
    positioner.style.opacity = '1';
    card.style.transform = 'scale(1)';
  });
  const okBtn = card.querySelector?.('[data-bonus-ok]');
  let finalized = false;
  function close() {
    if (finalized) return;
    finalized = true;
    // For auto-extra-score the engine deferred the actual points until this
    // moment; everything else (future effects) was already queued in
    // activeBoosts when ACTIVATE_BOOST fired.
    const awardExtra = boostId === 'auto_extra_score' ? (extra || boostPayload?.extra || 0) : 0;
    try { controller?.finalizeBoostAward?.({ slot, extra: awardExtra, bonusIdx }); } catch { /* swallow */ }
    positioner.style.opacity = '0';
    card.style.transform = 'scale(.85)';
    setTimeout(() => {
      positioner.remove?.();
      // Signal that the player has acknowledged the bonus — the bot pauses
      // while the overlay is up and waits for this before resuming.
      try { bus?.emit?.(BONUS_AWARD_ACK, { slot, boostId, extra }); } catch { /* swallow */ }
    }, 320);
  }
  okBtn?.addEventListener?.('click', close);
}

function escapeForOverlay(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function requestAnimationFrameSafe(fn) {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(fn));
  } else {
    setTimeout(fn, 16);
  }
}

function flashBonusSquare(root, bonusIdx) {
  let idx = Number.isInteger(bonusIdx) ? bonusIdx : null;
  if (idx == null) return () => {};
  const el = lookup(root, `bsq-${idx}`);
  if (!el) return () => {};
  el.style?.setProperty?.('--boost-ignition-duration', `${BOOST_IGNITION_DURATION_MS}ms`);
  flashClass(el, 'bonus-activate', 0);
  const clear = () => {
    el.classList?.remove('bonus-activate');
    el.style?.removeProperty?.('--boost-ignition-duration');
  };
  const handle = setTimeout(clear, BOOST_IGNITION_DURATION_MS);
  return () => { clearTimeout(handle); clear(); };
}

function emphasizeYourTurn(root, slot) {
  for (const id of [`sb${slot + 1}`, `is-sb${slot + 1}`]) {
    flashClass(lookup(root, id), 'your-turn-cue', 600);
  }
}

function lookup(root, id) {
  return root?.getElementById?.(id) ?? root?.querySelector?.(`#${id}`) ?? null;
}

function ownerDocumentOf(root) {
  return root?.ownerDocument ?? root;
}

function invalidReasonText(reason) {
  switch (reason) {
    case 'empty-move':              return g('placeOneTile');
    case 'not-collinear':           return 'האותיות חייבות להיות בכיוון אחד בלבד!';
    case 'has-gaps':                return 'אין להשאיר פערים בין האותיות!';
    case 'first-move-on-bonus':     return 'המילה הראשונה לא יכולה להניח אות על משבצת בוסט!';
    case 'not-connected':           return 'המילה חייבת להתחבר לאות קיימת!';
    case 'word-too-short':          return 'המילה חייבת להיות לפחות 2 אותיות!';
    case 'word-not-in-dictionary':  return 'מילה לא חוקית — התור עובר';
    case 'cell-locked':             return 'המשבצת נעולה כרגע';
    case 'cell-occupied':           return 'המשבצת כבר תפוסה';
    case 'lock-cell-occupied':      return 'אי אפשר לנעול משבצת תפוסה';
    case 'lock-cell-already-locked': return 'המשבצת כבר נעולה';
    case 'lock-not-owned':          return 'הנעילה הזו כבר נוצלה';
    case 'lock-out-of-bounds':      return g('chooseSquare');
    case 'lock-invalid-duration':
    case 'lock-invalid':            return 'אי אפשר להציב נעילה כרגע';
    case 'exchange-bag-empty':      return 'אין מספיק אותיות בשק להחלפה';
    case 'free-swap-unavailable':   return 'החלפה חינם לא זמינה כרגע';
    case 'exchange-invalid':        return 'החלפה לא תקינה';
    case 'swap-needs-placement':    return g('noSwapWithoutPlace');
    case 'swap-on-locked':          return 'אי אפשר להחליף אות במשבצת נעולה';
    case 'swap-no-tile':            return 'במשבצת אין אות להחלפה';
    case 'turn-already-passed':     return g('turnPassedDuringPlace');
    case 'turn-expired':            return 'הזמן שלך נגמר — התור עובר ליריב';
    default:                        return reason;
  }
}
