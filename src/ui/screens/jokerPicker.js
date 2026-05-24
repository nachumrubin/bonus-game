// jokerPicker — small overlay for picking a target letter for a joker tile.
//
// The legacy DOM at #ov-joker is reused; we only own the dynamic content of
// #jok-grid (22 letter buttons) and the cancel button.
//
// API:
//   const picker = mountJokerPicker({ bus, root });
//   picker.open();           // populates #jok-grid + un-hides #ov-joker
//   picker.close();          // re-hides
//
// Bus events:
//   JOKER_INTENT.PICKED     { letter }   — user picked a letter
//   JOKER_INTENT.CANCELLED                — user clicked cancel or closed

import { $, on } from '../domHelpers.js';
import { ALL_LETTERS, HV } from '../../game/core/letterDistribution.js';

const FINAL_FORM_LETTERS = new Set(['ך', 'ם', 'ן', 'ף', 'ץ']);
export const JOKER_PICKER_LETTERS = Object.freeze(
  ALL_LETTERS.filter(letter => !FINAL_FORM_LETTERS.has(letter)),
);

export const JOKER_INTENT = Object.freeze({
  PICKED:    'joker/picked',
  CANCELLED: 'joker/cancelled',
});

export function mountJokerPicker({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountJokerPicker: bus required');

  const overlay = $('#ov-joker', root);
  const grid    = $('#jok-grid', root);
  const cancel  = $('button[onclick="cancelJoker()"]', overlay ?? root);

  const cleanups = [];

  if (cancel) {
    cancel.removeAttribute('onclick');
    cleanups.push(on(cancel, 'click', (e) => {
      e.preventDefault?.();
      close();
      bus.emit(JOKER_INTENT.CANCELLED);
    }));
  }

  // Populate the grid lazily on first open so we don't fight the legacy
  // openJokerPicker() if it ran before us.
  let populated = false;
  function populate() {
    if (!grid) return;
    if (populated) return;
    populated = true;
    grid.innerHTML = '';
    for (const letter of JOKER_PICKER_LETTERS) {
      const btn = (root.createElement?.('button')) ?? makeStubButton();
      // Render each option as a rack-style tile (.bt2) for visual parity
      // with the user's actual rack. Keeps `jokopt` so legacy CSS that
      // hooked on it still works.
      btn.className = 'jokopt bt2';
      if (btn.dataset) btn.dataset.letter = letter;
      else btn.setAttribute?.('data-letter', letter);
      btn.innerHTML = `<span class="bt2-l">${letter}</span><span class="bt2-v">${HV[letter] ?? 0}</span>`;
      cleanups.push(on(btn, 'click', (e) => {
        e.preventDefault?.();
        bus.emit(JOKER_INTENT.PICKED, { letter });
        close();
      }));
      grid.appendChild?.(btn);
    }
  }

  function open() {
    populate();
    if (overlay?.classList) overlay.classList.remove('hidden');
  }
  function close() {
    if (overlay?.classList) overlay.classList.add('hidden');
  }

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { open, close, unmount, _populate: populate };
}

// Test-only — when there's no real document.createElement to call.
function makeStubButton() {
  const listeners = [];
  return {
    className: '', textContent: '', dataset: {},
    classList: { add() {}, remove() {} },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}
