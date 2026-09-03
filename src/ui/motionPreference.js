// motionPreference — the single source of truth for whether the current
// viewer should get reduced motion. Resolves the *effective* preference from,
// in priority order (spec §8.1):
//
//   1. explicit user preference  (uiPreferences.reducedMotion === 'on' | 'off')
//   2. otherwise the OS setting   (matchMedia('(prefers-reduced-motion: reduce)'))
//   3. otherwise normal motion
//
// The OS preference is read live each session; it is NEVER written back into
// stored settings as if the user chose it (spec §8.1). Only an explicit toggle
// persists.
//
// This lives in the UI/application layer. The game engine must not depend on
// it — reduced motion changes only how state is presented, never the state.
//
// Nothing else in the app should call matchMedia('(prefers-reduced-motion...')
// directly; go through this module so the resolution logic lives in one place.

import { loadUiPreferences } from '../game/settings/settingsCompat.js';

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

export function createMotionPreference(opts = {}) {
  // Injected values (tests) are used as-is; when a key is omitted we read the
  // global live on each access, so a swapped-out localStorage / late-available
  // document is always seen — matching how the rest of the app reads storage.
  const getStorage = ('storage' in opts)
    ? () => opts.storage
    : () => globalThis.localStorage ?? null;
  const getRoot = ('root' in opts)
    ? () => opts.root
    : () => globalThis.document?.documentElement ?? null;
  const matchMediaFn = ('matchMediaFn' in opts)
    ? opts.matchMediaFn
    : (globalThis.matchMedia?.bind(globalThis) ?? null);

  const listeners = new Set();

  let mql = null;
  try { mql = matchMediaFn ? matchMediaFn(REDUCE_QUERY) : null; }
  catch { mql = null; }

  function osPrefersReduced() {
    return !!mql?.matches;
  }

  function prefs() {
    try { return loadUiPreferences(getStorage()); }
    catch { return { reducedMotion: 'auto', animationsEnabled: true }; }
  }

  // 'auto' | 'on' | 'off'
  function explicit() {
    return prefs().reducedMotion;
  }

  // Precedence (spec §8.1): explicit tri-state → legacy animations-off flag →
  // OS setting → normal. The legacy boolean rung honours users/tests that set
  // animationsEnabled:false via the old `skipAnimations` path (which stores the
  // boolean but leaves reducedMotion at its 'auto' default).
  function isReduced() {
    const p = prefs();
    if (p.reducedMotion === 'on') return true;
    if (p.reducedMotion === 'off') return false;
    if (p.animationsEnabled === false) return true;
    return osPrefersReduced(); // 'auto' with no legacy override → follow the OS
  }

  // Convenience for the directive layer, which is gated by an
  // "animations enabled" boolean (animationController.setEnabled).
  function animationsEnabled() {
    return !isReduced();
  }

  // Mirror the effective state onto the document root so CSS can honour an
  // EXPLICIT reduced-motion choice even when the OS setting is "no preference"
  // (the plain @media rule can't see the app-level toggle). The @media rule in
  // styles.css still covers the OS-driven case on its own.
  function applyToRoot() {
    const root = getRoot();
    if (!root?.setAttribute) return;
    if (isReduced()) root.setAttribute('data-reduced-motion', '1');
    else root.removeAttribute?.('data-reduced-motion');
  }

  function notify() {
    applyToRoot();
    const reduced = isReduced();
    for (const fn of listeners) {
      try { fn(reduced); } catch { /* swallow */ }
    }
  }

  // Call after the stored preference changes (e.g. the settings toggle) so
  // consumers re-read and the root attribute updates.
  function refresh() { notify(); }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // React to live OS changes (some users toggle it mid-session).
  let offOs = () => {};
  if (mql?.addEventListener) {
    const handler = () => notify();
    mql.addEventListener('change', handler);
    offOs = () => { try { mql.removeEventListener('change', handler); } catch { /* swallow */ } };
  } else if (mql?.addListener) {
    // Older Safari / jsdom shims.
    const handler = () => notify();
    mql.addListener(handler);
    offOs = () => { try { mql.removeListener(handler); } catch { /* swallow */ } };
  }

  applyToRoot(); // initial paint of the root attribute

  function dispose() {
    offOs();
    listeners.clear();
  }

  return {
    isReduced,
    animationsEnabled,
    osPrefersReduced,
    explicit,
    onChange,
    refresh,
    applyToRoot,
    dispose,
  };
}

// Process-wide singleton for the running app. Tests should use
// createMotionPreference(...) with injected storage/matchMedia/root instead.
let _singleton = null;
export function getMotionPreference() {
  if (!_singleton) _singleton = createMotionPreference();
  return _singleton;
}

// Test seam: reset the singleton between test files if one was created.
export function _resetMotionPreferenceForTests() {
  try { _singleton?.dispose(); } catch { /* swallow */ }
  _singleton = null;
}
