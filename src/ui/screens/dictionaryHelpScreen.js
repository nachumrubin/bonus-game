// dictionaryHelpScreen — shows/hides the #ov-dict-help overlay ("המילון" in the `?` dropdown).
//
// Mirrors faqScreen: static content explaining which word forms the dictionary
// accepts, native <details> accordions. The close button uses the legacy
// `ovClose` global.

import { $ } from '../domHelpers.js';
import { MENU_INTENT } from './menuScreen.js';

export function mountDictionaryHelpScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountDictionaryHelpScreen: bus required');

  const overlay = $('#ov-dict-help', root);
  if (!overlay) {
    console.warn('[dictionaryHelpScreen] #ov-dict-help not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];

  cleanups.push(bus.on(MENU_INTENT.OPEN_DICT_HELP, () => {
    overlay.classList?.remove('hidden');
  }));

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch { /* swallow */ }
      cleanups.length = 0;
    },
  };
}
