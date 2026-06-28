import { $, $$, on, setText } from '../domHelpers.js';

export const TUTORIAL_INTENT = Object.freeze({
  START: 'tutorial/start',
  BACK: 'tutorial/back',
  NEXT: 'tutorial/next',
  SKIP: 'tutorial/skip',
});

export const TUTORIAL_OPEN = 'tutorial/open';
export const TUTORIAL_CLOSE = 'tutorial/close';
export const TUTORIAL_TIP = 'tutorial/tip';
export const TUTORIAL_CLEAR = 'tutorial/clear';

// Selector substrings for targets that should pulse IN PLACE rather than
// being mirrored by a body-level spotlight clone. These elements (rack
// tiles, action buttons) are visually small, live outside any z-index trap,
// and look better with a brightness + scale pulse than with a halo outline.
const INPLACE_PULSE_CLASSES = ['bt2', 'bplay'];

export function mountTutorialScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountTutorialScreen: bus required');

  const intro = $('#tut-intro', root);
  const tip = $('#tut-tip', root);
  const tipLabel = $('#tut-tip-lbl', root);
  const tipText = $('#tut-tip-txt', root);
  const tipNext = $('#tut-tip-next', root);
  const start = $('#tut-intro-go', root);
  const back = $('#tut-intro-back', root);
  const cleanups = [];
  const lit = new Set();        // .tut-lit  (spotlight-mirrored targets)
  const pulseLit = new Set();   // .tut-pulse (in-place pulsing targets)
  const spotlights = new Set();
  let currentSelectors = [];
  let currentTargets = [];
  let resizeAttached = false;
  let repaintTimers = [];
  let repaintRafs = [];
  let autoCloseTimer = null;
  let rackObserver = null;
  let overlayObserver = null;

  // Overlays whose open/close should re-position the tip (they're centered
  // modals that a top-anchored tip would cover — see positionTip).
  const REPOSITION_OVERLAY_IDS = ['ov-joker', 'ov-exch'];

  takeOver(start, () => {
    intro?.classList?.add('hidden');
    bus.emit(TUTORIAL_INTENT.START, {});
  });
  takeOver(back, () => {
    intro?.classList?.add('hidden');
    bus.emit(TUTORIAL_INTENT.BACK, {});
  });
  takeOver(tipNext, () => bus.emit(TUTORIAL_INTENT.NEXT, {}));

  cleanups.push(bus.on(TUTORIAL_OPEN, () => intro?.classList?.remove('hidden')));
  cleanups.push(bus.on(TUTORIAL_CLOSE, () => intro?.classList?.add('hidden')));
  cleanups.push(bus.on(TUTORIAL_CLEAR, clearTip));
  cleanups.push(bus.on(TUTORIAL_TIP, (payload = {}) => showTip(payload)));

  function takeOver(el, handler) {
    if (!el) return;
    el.removeAttribute?.('onclick');
    cleanups.push(on(el, 'click', (e) => {
      e.preventDefault?.();
      handler(e);
    }));
  }

  function showTip({ label = '', text = '', selectors = [], selector = null, autoCloseMs = 0, showNext = false, nextLabel = 'הבא ›' } = {}) {
    clearHighlights();
    cancelAutoClose();
    setText(tipLabel, label);
    setText(tipText, text);
    const list = Array.isArray(selectors) ? selectors.slice() : [];
    if (selector) list.push(selector);
    currentSelectors = list;
    applyHighlights();
    if (tipNext) setText(tipNext, nextLabel);
    if (showNext) tipNext?.classList?.remove('hidden');
    else tipNext?.classList?.add('hidden');
    tip?.classList?.remove('hidden');
    positionTip();
    // Board cells, rack tiles, and bonus squares may not exist in the DOM
    // at the moment the tip fires (rack is re-rendered as a side effect of
    // selection/placement, not from GAME_STARTED directly). Re-resolve
    // selectors and re-paint over ~400ms so late-rendered elements get
    // picked up; also re-align spotlights on window resize and re-apply
    // rack highlights on every #brack re-render via a MutationObserver.
    schedulePaints();
    attachResize();
    attachRackObserver();
    attachOverlayObserver();
    if (autoCloseMs > 0) {
      autoCloseTimer = setTimeout(() => {
        autoCloseTimer = null;
        clearTip();
      }, autoCloseMs);
    }
  }

  // Place the tip box just below the status bar, above the board, centered
  // in the game grid. Uses getBoundingClientRect so it adapts to any screen
  // size without hard-coded pixel offsets.
  function positionTip() {
    if (!tip) return;
    const win = root.defaultView ?? globalThis.window;
    if (!win?.requestAnimationFrame) return;
    // Defer one frame so the tip is visible (non-hidden) before measuring.
    win.requestAnimationFrame(() => {
      // A centered modal overlay (joker picker, exchange) sits mid-screen and
      // would be covered by the top-anchored tip — pin the tip to the bottom
      // while one is open so it doesn't hide the picker's letters (e.g. the
      // 'י' the bonus step tells the player to choose). attachOverlayObserver
      // re-runs positionTip when these overlays toggle.
      const modalOpen = root.querySelector?.('.ov:not(.hidden)');
      if (modalOpen) {
        tip.style.top = '';
        tip.style.bottom = '14px';
        tip.style.left = '50%';
        tip.style.transform = 'translateX(-50%)';
        tip.style.right = '';
        return;
      }

      const sbar = root.querySelector?.('#sbar') ?? root.querySelector?.('.sbar');
      const grid = root.getElementById?.('game-grid') ?? root.querySelector?.('#game-grid');
      if (!sbar && !grid) return;

      // Anchor below the status bar if available, otherwise below the grid top.
      const anchor = sbar ?? grid;
      const anchorRect = anchor.getBoundingClientRect?.();
      if (!anchorRect || anchorRect.width === 0) return;

      const tipTop = anchorRect.bottom + 8;
      tip.style.top = `${tipTop}px`;
      tip.style.bottom = '';

      // Horizontally center within the game grid.
      if (grid) {
        const gridRect = grid.getBoundingClientRect?.();
        if (gridRect && gridRect.width > 0) {
          const centerX = gridRect.left + gridRect.width / 2;
          tip.style.left = `${centerX}px`;
          tip.style.transform = 'translateX(-50%)';
          tip.style.right = '';
          return;
        }
      }
      // Fallback: center in the viewport.
      tip.style.left = '50%';
      tip.style.transform = 'translateX(-50%)';
      tip.style.right = '';
    });
  }

  function isInPlaceTarget(el) {
    const cl = el?.classList;
    if (!cl) return false;
    for (const c of INPLACE_PULSE_CLASSES) if (cl.contains?.(c)) return true;
    return false;
  }

  function applyHighlights() {
    const targets = [];
    for (const sel of currentSelectors) {
      for (const el of resolveSelector(sel)) {
        if (isInPlaceTarget(el)) {
          if (!pulseLit.has(el)) {
            el.classList.add('tut-pulse');
            pulseLit.add(el);
          }
          continue;
        }
        if (!lit.has(el)) {
          el.classList?.add('tut-lit');
          lit.add(el);
        }
        if (!targets.includes(el)) targets.push(el);
      }
    }
    currentTargets = targets;
  }

  function resolveSelector(sel) {
    if (typeof sel !== 'string') return [];
    // `#brack[letter=ש]` → ONE rack tile currently showing that letter.
    // The player only needs to place one copy of the letter, so even if the
    // rack happens to hold duplicates (a seeded letter plus a random refill)
    // we highlight just the first match — multiple pulsing tiles for the
    // same letter would be misleading.
    const m = sel.match(/^#brack\[letter=(.+)\]$/);
    if (m) {
      const wanted = m[1];
      const all = Array.from($$('#brack [data-rack-letter]', root));
      const first = all.find(el => (el.getAttribute?.('data-rack-letter') ?? '') === wanted);
      return first ? [first] : [];
    }
    return Array.from($$(sel, root));
  }

  function schedulePaints() {
    cancelScheduledPaints();
    const win = root.defaultView ?? globalThis.window;
    const raf = win?.requestAnimationFrame?.bind(win) ?? ((cb) => setTimeout(cb, 16));
    const refresh = () => { applyHighlights(); paintSpotlights(currentTargets); };
    repaintRafs.push(raf(refresh));
    repaintTimers.push(setTimeout(refresh, 150));
    repaintTimers.push(setTimeout(refresh, 400));
  }

  function cancelScheduledPaints() {
    const win = root.defaultView ?? globalThis.window;
    for (const id of repaintRafs) {
      try { win?.cancelAnimationFrame?.(id); } catch {}
    }
    for (const t of repaintTimers) {
      try { clearTimeout(t); } catch {}
    }
    repaintRafs = [];
    repaintTimers = [];
  }

  function paintSpotlights(targets) {
    clearSpotlights();
    if (!targets?.length) return;
    const doc = root.ownerDocument ?? globalThis.document;
    if (!doc?.body || !doc?.createElement) return;
    // Board cells (.cell) merge into one spotlight rectangle (their union
    // bbox) so a multi-cell word reads as ONE glowing slot instead of four
    // separate halos. Everything else gets its own spotlight.
    const cells = [];
    const other = [];
    for (const el of targets) {
      if (el.classList?.contains?.('cell')) cells.push(el);
      else other.push(el);
    }
    if (cells.length) {
      const rect = unionRect(cells);
      if (rect) appendSpotlight(doc, rect);
    }
    for (const el of other) {
      const rect = el.getBoundingClientRect?.();
      if (rect && (rect.width > 0 || rect.height > 0)) appendSpotlight(doc, rect);
    }
  }

  function unionRect(els) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    let found = false;
    for (const el of els) {
      const r = el.getBoundingClientRect?.();
      if (!r || (r.width === 0 && r.height === 0)) continue;
      found = true;
      if (r.left < left) left = r.left;
      if (r.top < top) top = r.top;
      if (r.right > right) right = r.right;
      if (r.bottom > bottom) bottom = r.bottom;
    }
    return found ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
  }

  function appendSpotlight(doc, rect) {
    const spot = doc.createElement('div');
    spot.className = 'tut-spotlight';
    const pad = 3;
    spot.style.cssText = [
      `left:${Math.round(rect.left - pad)}px`,
      `top:${Math.round(rect.top - pad)}px`,
      `width:${Math.round(rect.width + pad * 2)}px`,
      `height:${Math.round(rect.height + pad * 2)}px`,
    ].join(';');
    doc.body.appendChild(spot);
    spotlights.add(spot);
  }

  function onResize() {
    positionTip();
    if (currentTargets.length) paintSpotlights(currentTargets);
  }

  function attachResize() {
    if (resizeAttached) return;
    const win = root.defaultView ?? globalThis.window;
    if (!win?.addEventListener) return;
    win.addEventListener('resize', onResize);
    resizeAttached = true;
  }

  function detachResize() {
    if (!resizeAttached) return;
    const win = root.defaultView ?? globalThis.window;
    win?.removeEventListener?.('resize', onResize);
    resizeAttached = false;
  }

  function attachRackObserver() {
    if (rackObserver) return;
    const win = root.defaultView ?? globalThis.window;
    const MO = win?.MutationObserver ?? globalThis.MutationObserver;
    if (!MO) return;
    const brackEl = root.getElementById?.('brack') ?? $('#brack', root);
    if (!brackEl) return;
    rackObserver = new MO(() => {
      // renderRack wipes innerHTML, so previously-pulsing tiles lose their
      // class. Re-apply highlights so any rack tile that still shows a
      // letter we need keeps pulsing.
      if (currentSelectors.length) applyHighlights();
    });
    rackObserver.observe(brackEl, { childList: true, subtree: false });
  }

  function detachRackObserver() {
    if (!rackObserver) return;
    try { rackObserver.disconnect(); } catch {}
    rackObserver = null;
  }

  function attachOverlayObserver() {
    if (overlayObserver) return;
    const win = root.defaultView ?? globalThis.window;
    const MO = win?.MutationObserver ?? globalThis.MutationObserver;
    if (!MO) return;
    overlayObserver = new MO(() => positionTip());
    for (const id of REPOSITION_OVERLAY_IDS) {
      const el = root.getElementById?.(id) ?? $(`#${id}`, root);
      if (el) overlayObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function detachOverlayObserver() {
    if (!overlayObserver) return;
    try { overlayObserver.disconnect(); } catch {}
    overlayObserver = null;
  }

  function clearTip() {
    cancelAutoClose();
    clearHighlights();
    tipNext?.classList?.add('hidden');
    tip?.classList?.add('hidden');
    detachResize();
    detachRackObserver();
    detachOverlayObserver();
  }

  function cancelAutoClose() {
    if (autoCloseTimer) {
      try { clearTimeout(autoCloseTimer); } catch {}
      autoCloseTimer = null;
    }
  }

  function clearHighlights() {
    cancelScheduledPaints();
    currentSelectors = [];
    currentTargets = [];
    for (const el of lit) el.classList?.remove('tut-lit');
    lit.clear();
    for (const el of pulseLit) el.classList?.remove('tut-pulse');
    pulseLit.clear();
    clearSpotlights();
  }

  function clearSpotlights() {
    for (const spot of spotlights) {
      try { spot.remove(); } catch {}
    }
    spotlights.clear();
  }

  function unmount() {
    clearTip();
    for (const off of cleanups.splice(0)) {
      try { off(); } catch {}
    }
  }

  return { unmount, clear: clearTip };
}
