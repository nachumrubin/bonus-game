import { $, $$, on, setText } from '../domHelpers.js';

export const TUTORIAL_INTENT = Object.freeze({
  START: 'tutorial/start',
  BACK: 'tutorial/back',
  NEXT: 'tutorial/next',
  SKIP: 'tutorial/skip',
});

export const TUTORIAL_OPEN = 'tutorial/open';
export const TUTORIAL_CLOSE = 'tutorial/close';
export const TUTORIAL_TIP = 'tutorial/tip';
export const TUTORIAL_CLEAR = 'tutorial/clear';

export function mountTutorialScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountTutorialScreen: bus required');

  const intro = $('#tut-intro', root);
  const dim = $('#tut-dim', root);
  const tip = $('#tut-tip', root);
  const tipLabel = $('#tut-tip-lbl', root);
  const tipText = $('#tut-tip-txt', root);
  const start = $('#tut-intro-go', root);
  const back = $('#tut-intro-back', root);
  const next = $('#tut-tip-next', root);
  const skip = $('#tut-tip-skip', root);
  const cleanups = [];
  const lit = new Set();

  takeOver(start, () => {
    intro?.classList?.add('hidden');
    bus.emit(TUTORIAL_INTENT.START, {});
  });
  takeOver(back, () => {
    intro?.classList?.add('hidden');
    bus.emit(TUTORIAL_INTENT.BACK, {});
  });
  takeOver(next, () => bus.emit(TUTORIAL_INTENT.NEXT, {}));
  takeOver(skip, () => bus.emit(TUTORIAL_INTENT.SKIP, {}));

  cleanups.push(bus.on(TUTORIAL_OPEN, () => intro?.classList?.remove('hidden')));
  cleanups.push(bus.on(TUTORIAL_CLOSE, () => intro?.classList?.add('hidden')));
  cleanups.push(bus.on(TUTORIAL_CLEAR, clearTip));
  cleanups.push(bus.on(TUTORIAL_TIP, (payload = {}) => showTip(payload)));

  function takeOver(el, handler) {
    if (!el) return;
    el.removeAttribute?.('onclick');
    cleanups.push(on(el, 'click', (e) => {
      e.preventDefault?.();
      handler(e);
    }));
  }

  function showTip({ label = '', text = '', selectors = [], selector = null, dim: useDim = true } = {}) {
    clearHighlights();
    setText(tipLabel, label);
    setText(tipText, text);
    const list = Array.isArray(selectors) ? selectors : [];
    if (selector) list.push(selector);
    for (const sel of list) {
      for (const el of $$(sel, root)) {
        el.classList?.add('tut-lit');
        lit.add(el);
      }
    }
    if (useDim) dim?.classList?.remove('hidden');
    else dim?.classList?.add('hidden');
    tip?.classList?.remove('hidden');
  }

  function clearTip() {
    clearHighlights();
    dim?.classList?.add('hidden');
    tip?.classList?.add('hidden');
  }

  function clearHighlights() {
    for (const el of lit) el.classList?.remove('tut-lit');
    lit.clear();
  }

  function unmount() {
    clearTip();
    for (const off of cleanups.splice(0)) {
      try { off(); } catch {}
    }
  }

  return { unmount, clear: clearTip };
}
