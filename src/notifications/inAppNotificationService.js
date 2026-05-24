// In-app notification service.
//
// The legacy app has no toast/banner system — only a status bar (#sbar at
// index.html:149) used via setS(msg, cls). This wrapper centralises that
// surface: future Stage 7 UI work can add a toast queue without callers
// needing to know.
//
// Pure interface: callers never touch the DOM; they go through
// inApp.show({ kind, text }). The renderer is injected via setRenderer()
// at boot — production wires it to a DOM-touching impl in src/ui/, tests
// can capture into an array.

let _renderer = null;

export const TOAST_KIND = Object.freeze({
  INFO:    'info',
  OK:      'ok',
  ERROR:   'err',
  BONUS:   'bon',
  WARNING: 'warn',
});

export function setRenderer(fn) {
  _renderer = fn;
}

export function show({ kind = TOAST_KIND.INFO, text, durationMs = 3500 } = {}) {
  if (!text) return;
  if (!_renderer) {
    // No renderer yet — log so test runs and pre-boot calls don't silently drop.
    console.info('[toast]', kind, text);
    return;
  }
  try {
    _renderer({ kind, text, durationMs });
  } catch (e) {
    console.warn('[toast.render]', e);
  }
}

export function _resetForTests() {
  _renderer = null;
}
