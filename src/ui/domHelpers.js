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

export function flashAnimation(el, className, removeAfterMs = 600) {
  if (!el) return;
  el.classList?.remove(className);
  // Force reflow so the animation re-runs
  void el.offsetWidth;
  el.classList?.add(className);
  if (removeAfterMs > 0) {
    setTimeout(() => el.classList?.remove(className), removeAfterMs);
  }
}
