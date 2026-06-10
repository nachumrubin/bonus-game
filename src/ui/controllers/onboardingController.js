import { $, on } from '../domHelpers.js';

// Fired by showLegacyScreen() whenever a named screen becomes active.
export const ONBOARDING_SCREEN_ENTER = 'onboarding/screenEnter';

const STORAGE_KEY = 'spine.onboarding.dismissed';

// Registry populated by each screen's module via registerOnboardingContent().
// Keeping the copy next to the screen that owns it means a developer updating
// a screen's features will find the onboarding text in the same file.
const _registry = new Map();

/**
 * Register onboarding tooltip content for a screen.
 * Call at module level in the screen's own JS file so content stays
 * co-located and is registered at import time.
 *
 * @param {string} screenId   DOM id of the screen container (e.g. 'sh')
 * @param {{ icon: string, title: string, bullets: string[] }} content
 */
export function registerOnboardingContent(screenId, content) {
  _registry.set(screenId, content);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Mount the screen-by-screen onboarding system.
 *
 * Behaviour:
 * - Shows each screen's popup once per session.
 * - If the user dismisses with the "אל תציג שוב" checkbox checked, the screen
 *   is permanently suppressed (saved to localStorage).
 * - If dismissed without the checkbox, the popup reappears next session.
 *
 * @param {{ bus: object, storage?: Storage, triggerInitialScreen?: string }} opts
 *   triggerInitialScreen — screen ID shown at app start before showLegacyScreen
 *   is ever called (default 'sh'). Triggered at 1 000 ms to clear the loading
 *   animation.
 */
export function mountOnboardingController({
  bus,
  storage = globalThis.localStorage,
  triggerInitialScreen = 'sh',
} = {}) {
  if (!bus) throw new Error('mountOnboardingController: bus required');

  const dismissed = new Set(
    JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]'),
  );
  // Per-session guard: once shown this session, don't repeat even if the
  // user navigates back to the screen without having checked "don't show again".
  const shownThisSession = new Set();
  let pendingTimer = null;

  function saveDismissed(screenId) {
    dismissed.add(screenId);
    storage?.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
  }

  function populateAndShow(screenId) {
    const content = _registry.get(screenId);
    if (!content) return;

    const overlay = $(`#ov-onboarding`);
    const iconEl  = $(`#onb-icon`);
    const titleEl = $(`#onb-title`);
    const bodyEl  = $(`#onb-body`);
    const cbEl    = $(`#onb-noshowcb`);

    if (!overlay) return;

    if (iconEl)  iconEl.textContent  = content.icon;
    if (titleEl) titleEl.textContent = content.title;
    if (bodyEl)  bodyEl.innerHTML    = content.bullets
      .map(b => `<li>${escapeHtml(b)}</li>`)
      .join('');
    if (cbEl) cbEl.checked = false;

    overlay.dataset.screenId = screenId;
    overlay.classList.remove('hidden');
  }

  function maybeShow(screenId) {
    if (!_registry.has(screenId)) return;
    if (shownThisSession.has(screenId)) return;
    if (dismissed.has(screenId)) return;
    shownThisSession.add(screenId);
    clearTimeout(pendingTimer);
    // Delay so the screen's entrance animation finishes first.
    pendingTimer = setTimeout(() => populateAndShow(screenId), 380);
  }

  function handleDismiss() {
    const overlay = $(`#ov-onboarding`);
    if (!overlay) return;
    const screenId = overlay.dataset.screenId;
    const cbEl     = $(`#onb-noshowcb`);
    if (cbEl?.checked && screenId) saveDismissed(screenId);
    overlay.classList.add('hidden');
  }

  const unsubEnter = bus.on(ONBOARDING_SCREEN_ENTER, ({ screenId }) => {
    maybeShow(screenId);
  });

  const dismissBtn = $(`#onb-dismiss-btn`);
  const overlay    = $(`#ov-onboarding`);

  const unsubDismissBtn = dismissBtn
    ? on(dismissBtn, 'click', handleDismiss)
    : () => {};

  const unsubBackdrop = overlay
    ? on(overlay, 'click', (e) => { if (e.target === overlay) handleDismiss(); })
    : () => {};

  if (triggerInitialScreen) {
    pendingTimer = setTimeout(() => maybeShow(triggerInitialScreen), 1000);
  }

  return {
    unmount() {
      unsubEnter();
      unsubDismissBtn();
      unsubBackdrop();
      clearTimeout(pendingTimer);
    },
  };
}
