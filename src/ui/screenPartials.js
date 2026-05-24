import { SCREEN_PARTIALS } from './screenPartialManifest.js';

const target = globalThis.document?.getElementById?.('app-shell');

/**
 * Resolves after every static screen partial has been fetched and injected.
 * `src/main.js` awaits this before mounting controllers that query the DOM.
 * @type {Promise<void>}
 */
globalThis.__screenPartialsReady = (async () => {
  if (!target) return;

  const fragments = await Promise.all(
    SCREEN_PARTIALS.map(async (url) => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`screen partial failed: ${url} (${res.status})`);
      return res.text();
    }),
  );

  target.innerHTML = fragments.join('\n');
})();
