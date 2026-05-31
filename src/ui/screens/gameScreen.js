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

import { $, on, setText, setClass } from '../domHelpers.js';
import { HV } from '../../game/core/letterDistribution.js';
import { BDEFS } from '../../game/boosts/data.js';
import { EV } from '../../events/eventTypes.js';
import {
  WORD_MERGE_STAGGER_MS as SCORE_MERGE_WORD_STAGGER_MS,
  WORD_MERGE_FLIGHT_MS  as SCORE_MERGE_WORD_FLIGHT_MS,
  BOOST_MERGE_DELAY_MS  as SCORE_MERGE_BOOST_DELAY_MS,
  HOLD_AFTER_MERGE_MS   as SCORE_MERGE_HOLD_AFTER_MS,
  SUM_FLIGHT_MS         as SCORE_MERGE_SUM_FLIGHT_MS,
  SUM_CHIP_HOLD_MS,
} from '../scoreAnimationTimings.js';

export const GAME_SCREEN_INTENT = Object.freeze({
  LIVE_PREVIEW_CHANGED: 'gameScreen/livePreviewChanged',
  OPEN_EXCHANGE: 'gameScreen/openExchange',
});

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

export function mountGameScreen({ controller, animationController, jokerPicker = null, bus = null, root = globalThis.document }) {
  if (!controller) throw new Error('mountGameScreen: controller required');

  const cleanups = [];
  let selectedRackIndex = null;
  let pendingJokerPlacement = null;        // { r, c } awaiting letter pick
  let jokerPickedSub = null;
  let jokerCancelledSub = null;
  let lastRackSignature = '';
  let animateNextRackRender = false;
  let lastOwnPreviewSignature = '';
  let selectedLockDuration = null;
  // (r, c) of a pending tile currently highlighted on the board. Click-to-
  // select / click-again-to-recall semantics. Cleared on confirm, recall-all,
  // exchange, or any other action that empties view.placed.
  let selectedPlacedCoord = null;

  // Per-score-element tween state. Keyed by the score <span>; tracks the
  // currently-shown integer plus any in-flight rAF/timeout so we can cancel
  // overlapping animations when MOVE_CONFIRMED fires in quick succession.
  const scoreTweens = new Map();
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
  const glowingTiles = new Map();

  // The `.last-move` green tile-fill highlights the tiles the previous
  // player just placed. We expire it at count-up completion so the
  // highlight matches the rest of the scoring animation lifecycle (the
  // user explicitly asked for parity — without this, the green stayed
  // visible until the next move was committed).
  let lastMoveSignature = null;
  let lastMoveExpireAt = 0;
  function noteLastMoveForHighlight(v) {
    const placed = v?.lastMove?.placed ?? [];
    const sig = `${v?.lastMove?.slot ?? ''}|` +
      placed.map(p => `${p.r},${p.c}`).sort().join(',');
    if (sig === lastMoveSignature) return;
    lastMoveSignature = sig;
    if (!placed.length) { lastMoveExpireAt = 0; return; }
    const wordCount  = Array.isArray(v?.lastMove?.wordTiles) ? v.lastMove.wordTiles.length : 0;
    const bonusExtra = Number(v?.lastMove?.bonusExtra) || 0;
    // chip-arrives-at-panel + count-up peak
    const total = scoreAnimationLandingMs(wordCount, bonusExtra) + 900;
    lastMoveExpireAt = Date.now() + total;
    // Re-render once the highlight expires so the green tiles revert.
    setTimeout(() => { try { renderBoard(controller.view); } catch { /* swallow */ } }, total + 50);
  }

  // Shared score-merge-sequence landing time (when the red sum chip lands
  // on the player's score box). Mirrors the constants in
  // animationController.scoreMergeTiming and gameScreen.playScoreMergeSequence.
  function scoreAnimationLandingMs(wordCount, bonusExtra) {
    if (!wordCount && !bonusExtra) return 460;
    const lastWordStart = wordCount > 0 ? (wordCount - 1) * SCORE_MERGE_WORD_STAGGER_MS : 0;
    const boostStart    = bonusExtra > 0 ? lastWordStart + SCORE_MERGE_BOOST_DELAY_MS : lastWordStart;
    const mergeEnd      = boostStart + SCORE_MERGE_WORD_FLIGHT_MS;
    return mergeEnd + SCORE_MERGE_HOLD_AFTER_MS + SCORE_MERGE_SUM_FLIGHT_MS;
  }
  function lastMoveHighlightActive() {
    return lastMoveExpireAt > 0 && Date.now() < lastMoveExpireAt;
  }
  function registerWordGlow(payload, durationMs) {
    const coords = uniqueTileCoords(payload?.wordTiles, payload?.placed);
    const expireAt = Date.now() + durationMs;
    for (const { r, c } of coords) {
      glowingTiles.set(`${r},${c}`, expireAt);
    }
    setTimeout(() => {
      for (const { r, c } of coords) {
        const key = `${r},${c}`;
        if (glowingTiles.get(key) === expireAt) glowingTiles.delete(key);
      }
    }, durationMs + 10);
  }

  // Detect any bonus overlay (mini-game intro, mini-game UI, the bonus
  // award modal, or legacy `#ov-bonus` results screen). Score animations
  // hold while any of these are open so the count-up doesn't fire under
  // a still-visible overlay.
  function bonusOverlayPresent() {
    const doc = ownerDocumentOf(root) ?? globalThis.document;
    if (!doc) return false;
    for (const id of ['ov-bonus', 'ov-bonus-intro']) {
      const el = doc.getElementById?.(id);
      if (el && !el.classList?.contains?.('hidden')) return true;
    }
    if (doc.querySelector?.('.bonus-award-positioner')) return true;
    return false;
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
      const delay = scoreAnimationLandingMs(wordCount, bonusExtra);
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
      const durationMs = Math.min(900, 350 + Math.abs(delta) * 12);
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
  const exchangeCancel = $('button[onclick="ovClose(\'ov-exch\')"]', root);
  const lockInvDisplay = $('#lock-inv-display', root);
  btnPlay?.removeAttribute('onclick');
  btnRecall?.removeAttribute('onclick');
  btnExchange?.removeAttribute('onclick');
  exchangeCancel?.removeAttribute('onclick');
  btnDirH?.removeAttribute('onclick');
  btnDirV?.removeAttribute('onclick');
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
  }
  cleanups.push(on(exchangeCancel, 'click', (e) => { e.preventDefault?.(); closeExchangeOverlay(); }));
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
    selectedLockDuration = null;
    selectedPlacedCoord = null;
    selectedRackIndex = (selectedRackIndex === i) ? null : i;
    renderRack(controller.view);
    renderBoard(controller.view);
    renderLockInventory(controller.view);
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
        controller.recallTile(r, c);
        return;
      }
      selectedRackIndex = null;
      selectedLockDuration = null;
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
      controller.placeTile({
        r, c,
        letter: src.letter, val: src.val,
        isJoker: !!src.isJoker, rackIndex: src.rackIndex ?? null,
      });
      return;
    }
    if (selectedLockDuration != null) {
      controller.placeLock?.({ r, c, duration: selectedLockDuration });
      selectedLockDuration = null;
      renderLockInventory(controller.view);
      return;
    }
    if (selectedRackIndex == null) {
      // Empty on-grid cell + nothing selected → quick-place a lock using the
      // smallest available duration from the player's inventory. This makes
      // locks accessible without first tapping the lock-inventory picker.
      // Perimeter bonus squares (off-grid) are skipped — the engine's
      // PLACE_LOCK only accepts 0..9 × 0..9 coordinates.
      if (r < 0 || r > 9 || c < 0 || c > 9) return;
      if (isCellBlockedForPlacement(controller.view, r, c)) return;
      const inventory = lockInventoryForView(controller.view);
      if (!inventory.length) return;
      const duration = Math.min(...inventory);
      controller.placeLock?.({ r, c, duration });
      renderLockInventory(controller.view);
      return;
    }
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
        const placed = controller.placeTile({ r: pr, c: pc, letter: picked, val: 0, isJoker: true, rackIndex: ri });
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

    const placed = controller.placeTile({ r, c, letter, val: rackTile.val ?? 0, isJoker: false, rackIndex: selectedRackIndex });
    if (placed !== false) selectedRackIndex = null;
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
      setText($('#sbar', root), 'בטל את האותיות שעל הלוח לפני החלפה');
      return;
    }
    exchangeIsFreeSwap = !!freeSwap;
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
        setText($('#sbar', root), 'בחר לפחות אות אחת להחלפה');
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
    const countUpDelay = scoreAnimationLandingMs(wordCount, bonusExtra);
    animateScore($('#sv1', root), v.scores[0] ?? 0, countUpDelay);
    animateScore($('#sv2', root), v.scores[1] ?? 0, countUpDelay);
    animateScore($('#is-sv1', root), v.scores[0] ?? 0, countUpDelay);
    animateScore($('#is-sv2', root), v.scores[1] ?? 0, countUpDelay);
    // Player names + avatars (mobile info-strip and desktop labels).
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
    if (p0?.avatar) setText($('#is-av1', root), p0.avatar);
    if (p1?.avatar) setText($('#is-av2', root), p1.avatar);
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
    // count-up finishes ~900ms after it starts; align swap with that
    // (and include the score-merge sequence so the swap doesn't beat the
    // count-up).
    const bonusExtra = Number(v?.lastMove?.bonusExtra) || 0;
    const total = scoreAnimationLandingMs(wordCount, bonusExtra) + 900;
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
      setText($('#sbar', root), 'לחץ "שבץ ✓" לאישור או "בטל ↩" לחזרה');
    } else {
      setText($('#sbar', root), 'בחר אות מהמגש ולחץ על משבצת');
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
        cell.classList?.remove('np', 'lk', 'ht', 'last-move', 'spine-live-preview', 'spine-lock-cell', 'locked-cell', 'selected-placed', 'swap-pending');
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
          cell.innerHTML = tileHTML(placedHere, /*isPlaced=*/true);
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
        } else {
          cell.innerHTML = '';
        }
        // Re-apply an in-flight scoring-word-glow that would otherwise be
        // wiped by the innerHTML rewrite above.
        const glowExpire = glowingTiles.get(`${r},${c}`);
        if (glowExpire && glowExpire > Date.now()) {
          const btile = cell.querySelector?.('.btile');
          if (btile) btile.classList?.add('scoring-word-glow');
        }
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
      const committed = boardTileAt(v, br, bc);
      const opponentPreviewTile = (!placedHere && !committed && isOpponentPreview(v, br, bc))
        ? previewTileAt(v, br, bc)
        : null;
      bsq.classList?.remove('bsq-tile-host', 'np', 'selected-placed', 'spine-live-preview');
      const iconEl = bsq.querySelector?.('.bsq-ic, .bsq-tile-wrap');
      const tileTarget = bsq.querySelector?.('.bsq-tile-wrap');
      if (committed) {
        bsq.classList?.add('bsq-tile-host');
        ensureBsqTileWrap(bsq).innerHTML = tileHTML(committed, /*isPlaced=*/false);
      } else if (placedHere) {
        bsq.classList?.add('bsq-tile-host', 'np');
        ensureBsqTileWrap(bsq).innerHTML = tileHTML(placedHere, /*isPlaced=*/true);
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

  function renderRack(v) {
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
      const display = isJoker
        ? `<span class="jok-sym"><img class="jok-img" src="jocker.PNG" alt=""></span>`
        : letter;
      const valDisplay = isJoker ? '' : val;
      const anim = shouldAnimate ? ` anim-in" style="animation:tileDropIn .35s cubic-bezier(.22,.68,0,1.2) both;animation-delay:${i * 35}ms"` : '"';
      const dataLetter = isJoker ? '?' : letter;
      html += `<div class="bt2${sel}${jok}${anim} data-rack-letter="${dataLetter}" data-rack-idx="${i}"><span class="bt2-l">${display}</span><span class="bt2-v">${valDisplay}</span></div>`;
    }
    brack.innerHTML = html;
  }

  function renderLockInventory(v) {
    const inventory = lockInventoryForView(v);
    setText($('#is-locks-1', root), lockSummaryText(v.lockInventory?.[0]));
    setText($('#is-locks-2', root), lockSummaryText(v.lockInventory?.[1]));
    if (!lockInvDisplay) return;
    lockInvDisplay.innerHTML = '';
    if (!inventory.length) {
      lockInvDisplay.textContent = 'אין';
      selectedLockDuration = null;
      return;
    }
    inventory.forEach((duration, i) => {
      const btn = makeLockButton(root, duration, i, selectedLockDuration === duration);
      cleanups.push(on(btn, 'click', (e) => {
        e.preventDefault?.();
        selectedRackIndex = null;
        selectedLockDuration = selectedLockDuration === duration ? null : duration;
        renderRack(controller.view);
        renderLockInventory(controller.view);
        renderStatus(controller.view);
      }));
      lockInvDisplay.appendChild?.(btn);
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
      validFlash:         (payload) => flashWordTiles(root, payload, 'is-valid', 520),
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
          flashClass(target, 'is-invalid', 300);
        }
      },
      illegalPulse:       ({ placed, invalidWordTiles } = {}) => {
        // Paint the red pulsing border on the .btile itself (the cell's
        // children fill 100% of the cell, so a cell-level border ends up
        // hidden behind them). The .cell still gets `illegal-tile-host` so
        // CSS can knock back the cell's tile background too.
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
        }, 700);
      },
      scoringWordGlow:    (payload) => {
        const { delayMs = 0, durationMs = 420 } = payload ?? {};
        const fire = () => {
          // Register in `glowingTiles` so the next renderBoard re-applies
          // .scoring-word-glow to the regenerated .btile (cell innerHTML is
          // rewritten on every _onChange, which would otherwise wipe the
          // glow on word 0 the moment SCORE_CHANGED / LOCKS_CHANGED /
          // TURN_CHANGED fire right after MOVE_CONFIRMED).
          registerWordGlow(payload, durationMs);
          flashWordTiles(root, payload, 'scoring-word-glow', durationMs);
        };
        if (delayMs > 0) setTimeout(fire, delayMs); else fire();
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
      scoreMergeSequence: (payload) => playScoreMergeSequence(root, payload),
      bingoLabel:         (payload) => floatBonusLabel(root, payload, 'BINGO +50', 'bingo-label'),
      multiplierLabel:    (payload) => floatBonusLabel(root, payload, '×', 'multiplier-label'),
      // bonusExtraLabel is intentionally not wired — every bonus-square
      // activation now opens the modal `bonusAwardOverlay` so the player
      // can't miss it. Leaving the renderer keyed but unused would let a
      // stale caller silently revive the legacy "+BONUS" float.
      bonusAwardOverlay:  (payload) => showBonusAwardOverlay(root, bus, controller, payload),
      bonusActivate:      ({ bonusIdx }) => flashBonusSquare(root, bonusIdx),
      boostPulse:         ({ slot }) => flashBoostBadges(root, slot),
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
    clearJokerSubs();
    for (const state of scoreTweens.values()) {
      if (state.raf)   try { cafFn(state.raf); } catch { /* swallow */ }
      if (state.timer) try { clearTimeout(state.timer); } catch { /* swallow */ }
    }
    scoreTweens.clear();
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
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
  btn.textContent = count ? `החלף (${count})` : 'החלף';
  btn.style.marginInlineStart = '8px';
  return btn;
}

function makeLockButton(root, duration, index, selected) {
  const doc = ownerDocumentOf(root);
  const btn = doc?.createElement?.('button') ?? makeStubButton();
  btn.type = 'button';
  btn.className = `lock-inv-btn${selected ? ' active' : ''}`;
  btn.textContent = `🔒 ${duration}`;
  btn.title = `Lock a cell for ${duration} turns`;
  btn.setAttribute?.('data-lock-duration', String(duration));
  btn.setAttribute?.('aria-pressed', selected ? 'true' : 'false');
  btn.setAttribute?.('aria-label', `Lock duration ${duration}`);
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

function committedTileAt(view, r, c) {
  if (r >= 0 && r < 10 && c >= 0 && c < 10) {
    return view?._board?.[r]?.[c] ?? null;
  }
  return view?._bonusBoard?.get?.(`${r},${c}`) ?? null;
}

function isCellBlockedForPlacement(view, r, c) {
  // Locked by an active lock.
  const locked = (view?.lockedCells ?? []).some(l => l.r === r && l.c === c && (l.remainingTurns ?? 0) > 0);
  if (locked) return true;
  // Has a committed tile (on-grid or perimeter bonus square).
  if (r >= 0 && r < 10 && c >= 0 && c < 10) {
    if (view?._board?.[r]?.[c]) return true;
  } else if (view?._bonusBoard?.get?.(`${r},${c}`)) {
    return true;
  }
  return false;
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

function boardTileAt(view, r, c) {
  // On-grid (0..9 × 0..9): regular 2D array. Off-grid perimeter coords
  // (br/bc ∈ {-1, 10}) — tiles committed there live in view._bonusBoard,
  // a Map keyed "r,c". Without this fallback the bonus-square renderer
  // can't see tiles placed on a perimeter bonus, so they vanish on commit.
  if (r >= 0 && r < 10 && c >= 0 && c < 10) {
    return view._board?.[r]?.[c] ?? null;
  }
  return view._bonusBoard?.get?.(`${r},${c}`) ?? null;
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

function tileHTML(tile, isPlaced) {
  const isJoker = !!tile.isJoker;
  const cls = `btile${isPlaced ? ' nw' : ''}${isJoker ? ' jk' : ''}`;
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
  return [...(view.lockInventory?.[slot] ?? [])].filter(n => Number.isInteger(Number(n)) && Number(n) > 0).map(Number);
}

function lockSummaryText(inventory) {
  const locks = [...(inventory ?? [])].filter(n => Number.isInteger(Number(n)) && Number(n) > 0);
  return locks.length ? locks.map(n => `🔒${n}`).join(' ') : '';
}

function flashClass(el, cls, durationMs) {
  if (!el) return;
  el.classList?.remove(cls);
  void el.offsetWidth;
  el.classList?.add(cls);
  if (durationMs > 0) setTimeout(() => el.classList?.remove(cls), durationMs);
}

function flashWordTiles(root, { wordTiles, placed } = {}, className, durationMs) {
  const coords = uniqueTileCoords(wordTiles, placed);
  for (const { r, c } of coords) {
    const cell = root?.getElementById?.(`c${r}_${c}`) ?? root?.querySelector?.(`#c${r}_${c}`);
    const target = cell?.querySelector?.('.btile') ?? cell;
    flashClass(target, className, durationMs);
  }
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
      flashClass(to, 'score-panel-arrive', 620);
      if (isSum) spawnScoreHitBurst(root, to);
      chip.remove?.();
    }, 480 + hold);
  };
  if (delayMs > 0) setTimeout(fire, delayMs); else fire();
}

// Score-merge animation timings come from ../scoreAnimationTimings.js
// (single source of truth, shared with animationController). The local
// aliases preserve the descriptive `SCORE_MERGE_*` names used throughout
// this file without re-declaring values.

// The cohesive scoring animation. A red sum chip is planted above the
// played word(s). Each scoring word's +N chip launches at the word's
// anchor and flies into the sum chip, where it merges and bumps the
// running total + chip scale. If the move earned a bonus extra (the +N
// from a boost), that chip also flies into the sum. After a short hold
// the fully-sized sum chip flies into the player's score panel — same
// final beat as the old sequence, but now visibly the *total* of all the
// per-word + bonus contributions instead of a separate value that
// appears out of nowhere.
function playScoreMergeSequence(root, { slot, placed, words, finalScore, baseScore, bonusExtra } = {}) {
  const total = Number(finalScore) || 0;
  const extra = Number(bonusExtra) || 0;
  const base  = baseScore != null ? Number(baseScore) : total - extra;
  if (total <= 0 && extra <= 0) return;
  const doc = ownerDocumentOf(root);
  if (!doc?.createElement) return;

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
  const lastWordStart = wordCount > 0 ? (wordCount - 1) * SCORE_MERGE_WORD_STAGGER_MS : 0;
  let mergeEnd = lastWordStart + SCORE_MERGE_WORD_FLIGHT_MS;

  // 3. Bonus extra — flies into the sum from above.
  if (extra > 0) {
    const boostStart = lastWordStart + SCORE_MERGE_BOOST_DELAY_MS;
    mergeEnd = boostStart + SCORE_MERGE_WORD_FLIGHT_MS;
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
    }, boostStart);
  }

  // Defensive: if rounding / per-word filter dropped some points (e.g. a
  // bonus that doesn't come from a word's tile values), top up the sum to
  // the final score so the chip lands with the real total instead of an
  // undercount.
  //
  // Two correctness rules learned the hard way (May 2026):
  //   1. Only schedule the snap if the per-word renders + bonus extra
  //      would NOT naturally reach `total`. Otherwise the snap races
  //      against the per-word onLand callbacks (both fire ~380ms in) and
  //      can run first, after which onLand adds its `ws` on top — the
  //      chip ends up showing 2× the real score.
  //   2. When the snap does run, ADD the missing delta rather than
  //      overwriting `runningSum`. Overwriting also races with onLand and
  //      double-counts.
  const expectedFromMerges = (words ?? []).reduce(
    (a, w) => a + (Number(w.wordScore) || 0),
    0,
  ) + extra;
  if (expectedFromMerges < total) {
    setTimeout(() => {
      if (runningSum < total) {
        runningSum = total;
        updateSumDisplay();
      }
    }, mergeEnd + 20);
  }

  // 4. Hold + fly sum chip into the player's score panel.
  setTimeout(() => {
    const targetEl = scoreTargetForSlot(root, slot);
    if (!targetEl) { sumChip.remove?.(); return; }
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
      flashClass(targetEl, 'score-panel-arrive', 620);
      spawnScoreHitBurst(root, targetEl);
      flashClass($(`#sv${slot + 1}`, root), 'score-pop', 500);
      flashClass($(`#is-sv${slot + 1}`, root), 'score-pop', 500);
      sumChip.remove?.();
    }, SCORE_MERGE_SUM_FLIGHT_MS);
  }, mergeEnd + SCORE_MERGE_HOLD_AFTER_MS);
}

// Spawned at the score-panel center when the sum chip lands. A short-lived
// radial ring + glow that punches the moment the points "hit" the box.
function spawnScoreHitBurst(root, target) {
  if (!target) return;
  const doc = ownerDocumentOf(root);
  const center = centerOf(target);
  if (!center || !doc?.createElement) return;
  const burst = doc.createElement('div');
  burst.className = 'score-hit-burst';
  burst.style.left = `${center.x}px`;
  burst.style.top  = `${center.y}px`;
  appendOverlay(root, burst);
  setTimeout(() => burst.remove?.(), 720);
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
      return { title: 'תור נוסף!', bigText: '🎯', sub: 'תקבל תור נוסף ברצף' };
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
        title: 'בונוס זמן ⏱',
        bigText: `+${Number(p.seconds ?? 0)} שניות`,
        sub: 'יתווסף לזמן התור הבא',
      };
    case 'free_tile_swap':
      return { title: 'החלפת אות חינם 🔄', bigText: '🔄', sub: 'תוכל להחליף אותיות בלי לוותר על התור' };
    case 'skip_opponent_turn':
      return { title: 'דילוג על תור היריב 🚫', bigText: '🚫', sub: 'היריב יפסיד את התור הבא' };
    case 'cancel_next_opponent_bonus':
      return { title: 'ביטול בוסט יריב 🛡', bigText: '🛡', sub: 'הבוסט הבא של היריב יבוטל' };
    default:
      return { title: 'בוסט הופעל', bigText: '⚡', sub: '' };
  }
}

function showBonusAwardOverlay(root, bus, controller, { slot, extra, boostId, bonusIdx, boostPayload } = {}) {
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
  card.innerHTML = `
    <div class="ovic">⚡</div>
    <div class="ovt">${escapeForOverlay(info.title)}</div>
    <div class="ovd" style="font-size:32px;font-weight:900;color:var(--by);margin-bottom:4px;">${escapeForOverlay(info.bigText)}</div>
    ${info.sub ? `<div class="ovd" style="margin-bottom:12px;">${escapeForOverlay(info.sub)}</div>` : ''}
    <div class="ovd" style="margin-bottom:12px;font-size:11px;opacity:.6;">שחקן ${(slot ?? 0) + 1}</div>
    <div class="ovbtns"><button type="button" class="ovb p" data-bonus-ok>אישור ✓</button></div>
  `;
  positioner.appendChild(card);
  appendOverlay(root, positioner);
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
  if (idx == null) return;
  const el = lookup(root, `bsq-${idx}`);
  flashClass(el, 'bonus-activate', 460);
}

function flashBoostBadges(root, slot) {
  const panel = lookup(root, `scn${slot + 1}`) ?? lookup(root, `sb${slot + 1}`);
  const badges = panel?.querySelectorAll?.('.spine-boost-badges [data-badge]');
  if (badges?.length) {
    badges.forEach((el) => flashClass(el, 'boost-pulse', 2200));
    return;
  }
  flashClass(panel, 'boost-pulse', 2200);
}

function lookup(root, id) {
  return root?.getElementById?.(id) ?? root?.querySelector?.(`#${id}`) ?? null;
}

function ownerDocumentOf(root) {
  return root?.ownerDocument ?? root;
}

function invalidReasonText(reason) {
  switch (reason) {
    case 'empty-move':              return 'שבץ לפחות אות אחת!';
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
    case 'lock-out-of-bounds':      return 'בחר משבצת על הלוח';
    case 'lock-invalid-duration':
    case 'lock-invalid':            return 'אי אפשר להציב נעילה כרגע';
    case 'exchange-bag-empty':      return 'אין מספיק אותיות בשק להחלפה';
    case 'free-swap-unavailable':   return 'החלפה חינם לא זמינה כרגע';
    case 'exchange-invalid':        return 'החלפה לא תקינה';
    case 'swap-needs-placement':    return 'אי אפשר להחליף אות בלי לשבץ אותיות חדשות';
    case 'swap-on-locked':          return 'אי אפשר להחליף אות במשבצת נעולה';
    case 'swap-no-tile':            return 'במשבצת אין אות להחלפה';
    case 'turn-already-passed':     return 'התור עבר בזמן שניסית לשבץ — האותיות הוחזרו';
    default:                        return reason;
  }
}
