// helpDropdown — anchored menu under the top-bar `?` button.
//
// Listens for MENU_INTENT.OPEN_HELP_MENU, shows #em-help-dropdown positioned
// under the `?` button, and emits MENU_INTENT.OPEN_TUTORIAL / OPEN_GUIDE /
// OPEN_FAQ on item activation. Dismissed by outside-click, Escape, or another
// route change.
//
// Mount semantics:
//   const dd = mountHelpDropdown({ root, bus });
//   ...
//   dd.unmount();

import { $, on } from '../domHelpers.js';
import { MENU_INTENT } from './menuScreen.js';

const ACTION_TO_INTENT = Object.freeze({
  tutorial: MENU_INTENT.OPEN_TUTORIAL,
  guide:    MENU_INTENT.OPEN_GUIDE,
  faq:      MENU_INTENT.OPEN_FAQ,
});

export function mountHelpDropdown({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountHelpDropdown: bus required');

  const dropdown = $('#em-help-dropdown', root);
  if (!dropdown) {
    console.warn('[helpDropdown] #em-help-dropdown not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];
  let outsideHandler = null;
  let escHandler = null;

  function isOpen() {
    return !dropdown.classList?.contains('hidden');
  }

  function position() {
    // Anchor under the `?` button. Use the stable #topbar-help-btn id rather
    // than `button[onclick="..."]` — menuScreen.js strips the inline onclick
    // at mount, which would make the legacy selector match nothing.
    const anchor = root?.getElementById?.('topbar-help-btn')
      ?? $('#topbar-help-btn', root)
      ?? $('button[onclick="showTutorialIntro()"]', root);
    if (!anchor || !anchor.getBoundingClientRect) return;
    const rect = anchor.getBoundingClientRect();
    const viewportW = root?.documentElement?.clientWidth ?? globalThis.innerWidth ?? 0;
    dropdown.style.position = 'fixed';
    dropdown.style.top = `${Math.round(rect.bottom + 6)}px`;
    // Align the dropdown's right edge with the button's right edge (so it
    // drops directly below the `?` in the RTL topbar).
    dropdown.style.right = `${Math.round(viewportW - rect.right)}px`;
    dropdown.style.left = 'auto';
  }

  function open() {
    if (isOpen()) return;
    position();
    dropdown.classList?.remove('hidden');
    // Defer the document-level listeners by one frame so the opening click
    // doesn't immediately count as an "outside click".
    queueMicrotask(() => {
      outsideHandler = (e) => {
        if (!dropdown.contains?.(e.target)) close();
      };
      escHandler = (e) => { if (e.key === 'Escape') close(); };
      root?.addEventListener?.('click', outsideHandler, true);
      root?.addEventListener?.('keydown', escHandler);
    });
  }

  function close() {
    if (!isOpen()) return;
    dropdown.classList?.add('hidden');
    if (outsideHandler) root?.removeEventListener?.('click', outsideHandler, true);
    if (escHandler)     root?.removeEventListener?.('keydown', escHandler);
    outsideHandler = null;
    escHandler = null;
  }

  cleanups.push(bus.on(MENU_INTENT.OPEN_HELP_MENU, () => {
    if (isOpen()) close();
    else open();
  }));

  // Item activation
  const items = dropdown.querySelectorAll?.('.em-help-dropdown-item') ?? [];
  for (const item of items) {
    cleanups.push(on(item, 'click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = item.getAttribute?.('data-action');
      const intent = ACTION_TO_INTENT[action];
      close();
      if (intent) bus.emit(intent, { source: 'helpDropdown' });
    }));
  }

  return {
    isOpen,
    close,
    unmount() {
      close();
      for (const off of cleanups) try { off(); } catch { /* swallow */ }
      cleanups.length = 0;
    },
  };
}
