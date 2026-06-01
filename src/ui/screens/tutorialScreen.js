import { $, $$, on, setText } from '../domHelpers.js';

export const TUTORIAL_INTENT = Object.freeze({
  START:     'tutorial/start',
  BACK:      'tutorial/back',
  NEXT:      'tutorial/next',
  SKIP:      'tutorial/skip',
  // Emitted when the player taps the per-step "דלג על שלב זה" link inside a
  // tip. Advances the linear tutorial to the next demo step without forcing
  // the player to perform the current step's action.
  SKIP_STEP: 'tutorial/skipStep',
});

export const TUTORIAL_OPEN = 'tutorial/open';
export const TUTORIAL_CLOSE = 'tutorial/close';
export const TUTORIAL_TIP = 'tutorial/tip';
export const TUTORIAL_CLEAR = 'tutorial/clear';

// Selector substrings for targets that should pulse IN PLACE rather than
// being mirrored by a body-level spotlight clone. These elements (rack
// tiles, action buttons, top-bar buttons) are visually small, live outside
// any z-index trap, and look better with a brightness + scale pulse than
// with a halo outline. `tb` covers the שאילתה/החלפת אות/הגדרות top-bar
// buttons whose parent toolbar clips the .tut-lit box-shadow halo.
const INPLACE_PULSE_CLASSES = ['bt2', 'bplay', 'tb'];

export function mountTutorialScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountTutorialScreen: bus required');

  const intro = $('#tut-intro', root);
  const tip = $('#tut-tip', root);
  const tipLabel = $('#tut-tip-lbl', root);
  const tipText = $('#tut-tip-txt', root);
  const tipSkip = $('#tut-tip-skip', root);
  const start = $('#tut-intro-go', root);
  const back = $('#tut-intro-back', root);
  const cleanups = [];
  const lit = new Set();        // .tut-lit  (spotlight-mirrored targets)
  const pulseLit = new Set();   // .tut-pulse (in-place pulsing targets)
  const spotlights = new Set();
  let currentSelectors = [];
  let currentTargets = [];
  let allHighlightedTargets = [];
  let resizeAttached = false;
  let repaintTimers = [];
  let repaintRafs = [];
  let autoCloseTimer = null;
  let rackObserver = null;
  let lastForcedPosition = null;

  takeOver(start, () => {
    intro?.classList?.add('hidden');
    bus.emit(TUTORIAL_INTENT.START, {});
  });
  takeOver(back, () => {
    intro?.classList?.add('hidden');
    bus.emit(TUTORIAL_INTENT.BACK, {});
  });
  if (tipSkip) {
    cleanups.push(on(tipSkip, 'click', (e) => {
      e?.preventDefault?.();
      bus.emit(TUTORIAL_INTENT.SKIP_STEP, {});
    }));
  }

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

  function showTip({ label = '', text = '', selectors = [], selector = null, autoCloseMs = 0, showSkip = false, position = null } = {}) {
    clearHighlights();
    cancelAutoClose();
    setText(tipLabel, label);
    setText(tipText, text);
    if (tipSkip) tipSkip.classList?.[showSkip ? 'remove' : 'add']?.('hidden');
    const list = Array.isArray(selectors) ? selectors.slice() : [];
    if (selector) list.push(selector);
    currentSelectors = list;
    lastForcedPosition = position;
    applyHighlights();
    tip?.classList?.remove('hidden');
    repositionTip(position);
    // Board cells, rack tiles, and bonus squares may not exist in the DOM
    // at the moment the tip fires (rack is re-rendered as a side effect of
    // selection/placement, not from GAME_STARTED directly). Re-resolve
    // selectors and re-paint over ~400ms so late-rendered elements get
    // picked up; also re-align spotlights on window resize and re-apply
    // rack highlights on every #brack re-render via a MutationObserver.
    schedulePaints();
    attachResize();
    attachRackObserver();
    if (autoCloseMs > 0) {
      autoCloseTimer = setTimeout(() => {
        autoCloseTimer = null;
        clearTip();
      }, autoCloseMs);
    }
  }

  // Place the tip in the viewport quadrant farthest from the first
  // highlighted target so it doesn't obscure what it's pointing at. If
  // `forced` is supplied (e.g. 'bottom-center'), use it verbatim instead.
  function repositionTip(forced) {
    if (!tip) return;
    for (const cls of ['tut-anchor-top-right','tut-anchor-top-left','tut-anchor-bottom-right','tut-anchor-bottom-left','tut-anchor-top-center','tut-anchor-bottom-center']) {
      tip.classList?.remove(cls);
    }
    const anchor = forced || pickAnchorForTargets(allHighlightedTargets);
    tip.classList?.add(`tut-anchor-${anchor}`);
  }

  function pickAnchorForTargets(targets) {
    const win = root.defaultView ?? globalThis.window;
    const vw = win?.innerWidth ?? 1024;
    const vh = win?.innerHeight ?? 768;
    // No anchor target → default to top-right (the original behavior).
    const first = targets?.find?.((el) => el?.getBoundingClientRect);
    if (!first) return 'top-right';
    const rect = first.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return 'top-right';
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    const onLeftHalf = cx < vw / 2;
    // Vertical bands: top third / middle / bottom third. Centered horizontal
    // anchors work better for the middle band so the tip doesn't slam against
    // a side panel.
    if (cy < vh / 3)        return onLeftHalf ? 'bottom-right' : 'bottom-left';
    if (cy > (2 * vh) / 3)  return onLeftHalf ? 'top-right'    : 'top-left';
    return onLeftHalf ? 'top-right' : 'top-left';
  }

  function isInPlaceTarget(el) {
    const cl = el?.classList;
    if (!cl) return false;
    for (const c of INPLACE_PULSE_CLASSES) if (cl.contains?.(c)) return true;
    return false;
  }

  function applyHighlights() {
    const spotlightTargets = [];
    const allTargets = [];
    for (const sel of currentSelectors) {
      for (const el of resolveSelector(sel)) {
        if (isInPlaceTarget(el)) {
          if (!pulseLit.has(el)) {
            el.classList.add('tut-pulse');
            pulseLit.add(el);
          }
          if (!allTargets.includes(el)) allTargets.push(el);
          continue;
        }
        if (!lit.has(el)) {
          el.classList?.add('tut-lit');
          lit.add(el);
        }
        if (!spotlightTargets.includes(el)) spotlightTargets.push(el);
        if (!allTargets.includes(el)) allTargets.push(el);
      }
    }
    // currentTargets feeds the spotlight overlay (non-pulse only — pulse
    // targets paint themselves via .tut-pulse). allHighlightedTargets feeds
    // pickAnchorForTargets so the tip can position itself relative to a
    // pulsing toolbar button even when no spotlight clone is drawn.
    currentTargets = spotlightTargets;
    allHighlightedTargets = allTargets;
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
    // Re-resolve highlights AND re-pick the tip anchor on each pass — the
    // target element may not exist on the first paint (rack tiles render
    // after GAME_STARTED), and its final position decides the anchor.
    const refresh = () => { applyHighlights(); paintSpotlights(currentTargets); repositionTip(lastForcedPosition); };
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
    if (currentTargets.length) paintSpotlights(currentTargets);
    repositionTip(lastForcedPosition);
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

  function clearTip() {
    cancelAutoClose();
    clearHighlights();
    tip?.classList?.add('hidden');
    lastForcedPosition = null;
    detachResize();
    detachRackObserver();
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
    allHighlightedTargets = [];
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
