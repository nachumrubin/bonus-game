// guideScreen — shows/hides the #ov-guide overlay.
//
// The overlay's content is fully static (native <details> accordions handle
// open/close). This module only listens for MENU_INTENT.OPEN_GUIDE and
// reveals the overlay; the close button uses the legacy `ovClose` global.

import { $ } from '../domHelpers.js';
import { MENU_INTENT } from './menuScreen.js';

export function mountGuideScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountGuideScreen: bus required');

  const overlay = $('#ov-guide', root);
  if (!overlay) {
    console.warn('[guideScreen] #ov-guide not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];

  cleanups.push(bus.on(MENU_INTENT.OPEN_GUIDE, () => {
    overlay.classList?.remove('hidden');
  }));

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch { /* swallow */ }
      cleanups.length = 0;
    },
  };
}
