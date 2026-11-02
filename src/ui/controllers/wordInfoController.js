// wordInfoController — drives the מילון "word origin" panel.
//
// Listens to the dictionary check result (DICT_RENDER.QUERY_RESULT) and, when the
// player has the toggle on (uiPreferences.wordInfoEnabled) and the word is valid,
// looks the word up in wordInfoService and emits DICT_RENDER.WORD_INFO for the
// screen to paint. The toggle itself arrives as DICT_INTENT.TOGGLE_WORD_INFO.
//
// WORD_INFO payload: { target: 'main' | 'settings', status, word?, info? }
//   status 'hidden'  — nothing to show (toggle off, word invalid / empty)
//          'loading' — lookup in flight
//          'ready'   — info = { word, source, sourceText, readings, more }
//          'missing' — the word is valid but has no entry (e.g. admin-approved word)
//          'error'   — the data could not be loaded (offline, old browser)
//
// The panel never affects validation; isValid() decides playability.

import { DICT_INTENT, DICT_RENDER } from '../screens/dictionaryScreen.js';

const TARGETS = ['main', 'settings'];

export function mountWordInfoController({ bus, service, getEnabled = () => false, setEnabled = () => {} } = {}) {
  if (!bus) throw new Error('mountWordInfoController: bus required');
  if (!service) throw new Error('mountWordInfoController: service required');

  const lastValid = { main: null, settings: null };   // last word shown as valid, per target
  const seq = { main: 0, settings: 0 };               // drops stale lookups
  const cleanups = [];

  function hide(target) {
    seq[target] += 1;
    bus.emit(DICT_RENDER.WORD_INFO, { target, status: 'hidden' });
  }

  async function show(target, word) {
    const token = ++seq[target];
    bus.emit(DICT_RENDER.WORD_INFO, { target, word, status: 'loading' });
    let payload;
    try {
      const info = await service.lookup(word);
      payload = info ? { target, word, status: 'ready', info } : { target, word, status: 'missing' };
    } catch {
      payload = { target, word, status: 'error' };
    }
    if (token !== seq[target] || !getEnabled()) return;
    bus.emit(DICT_RENDER.WORD_INFO, payload);
  }

  cleanups.push(bus.on(DICT_RENDER.QUERY_RESULT, ({ target = 'main', word, valid } = {}) => {
    if (!TARGETS.includes(target)) return;
    lastValid[target] = valid && word ? word : null;
    if (lastValid[target] && getEnabled()) show(target, lastValid[target]);
    else hide(target);
  }));

  cleanups.push(bus.on(DICT_INTENT.TOGGLE_WORD_INFO, ({ enabled = false } = {}) => {
    setEnabled(!!enabled);
    for (const target of TARGETS) {
      if (enabled && lastValid[target]) show(target, lastValid[target]);
      else hide(target);
    }
  }));

  // A freshly opened מילון starts with an empty result, so nothing to show yet.
  cleanups.push(bus.on(DICT_INTENT.OPEN_QUERY, () => {
    lastValid.main = null;
    hide('main');
  }));

  function unmount() {
    for (const off of cleanups.splice(0)) try { off(); } catch {}
  }

  return { unmount };
}
