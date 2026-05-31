// faqScreen — shows/hides the #ov-faq overlay.
//
// Mirrors guideScreen: static content, native <details> accordions. The close
// button uses the legacy `ovClose` global.

import { $ } from '../domHelpers.js';
import { MENU_INTENT } from './menuScreen.js';

export function mountFaqScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountFaqScreen: bus required');

  const overlay = $('#ov-faq', root);
  if (!overlay) {
    console.warn('[faqScreen] #ov-faq not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];

  cleanups.push(bus.on(MENU_INTENT.OPEN_FAQ, () => {
    overlay.classList?.remove('hidden');
  }));

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch { /* swallow */ }
      cleanups.length = 0;
    },
  };
}
