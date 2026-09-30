// The ONLY module that touches `document` directly. Other UI code goes
// through this surface so tests can stub it with no jsdom overhead and so
// the DOM coupling is easy to audit (one file).

export function $(selector, root = globalThis.document) {
  return root?.querySelector?.(selector) ?? null;
}

export function $$(selector, root = globalThis.document) {
  return Array.from(root?.querySelectorAll?.(selector) ?? []);
}

export function on(target, event, handler, opts) {
  target?.addEventListener?.(event, handler, opts);
  return () => target?.removeEventListener?.(event, handler, opts);
}

export function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

export function setClass(el, className, on = true) {
  if (!el) return;
  el.classList?.[on ? 'add' : 'remove'](className);
}

export function flashAnimation(el, className, removeAfterMs = 600, onComplete = null) {
  if (!el) { onComplete?.(); return; }
  el.classList?.remove(className);
  // Force reflow so the animation re-runs
  void el.offsetWidth;
  el.classList?.add(className);
  if (removeAfterMs > 0) {
    setTimeout(() => {
      el.classList?.remove(className);
      onComplete?.();
    }, removeAfterMs);
  }
}

// True while a bonus overlay that should hold the score-commit / count-up
// animation is on screen: the mini-game intro, the mini-game UI, or the bonus
// award modal. Single shared predicate so animationController (score-commit
// gate) and gameScreen (count-up gate) can't drift apart — the two used to keep
// byte-identical private copies (see ANIMATION_AUDIT §D, BOOST_MOTION_SPEC §5.4).
export function bonusOverlayOpen(doc = globalThis.document) {
  if (!doc) return false;
  for (const id of ['ov-bonus', 'ov-bonus-intro']) {
    const el = doc.getElementById?.(id);
    if (el && !el.classList?.contains?.('hidden')) return true;
  }
  if (doc.querySelector?.('.bonus-award-positioner')) return true;
  return false;
}
