// Dynamic import so the manifest is fetched with the build-stamp query param,
// matching how `src/main.js` and `styles.css` are versioned in `index.html`.
// Without this, the browser keeps the old module in its module map even after
// a hard reload, and newly added partials never get loaded.
const buildStamp = globalThis.document
  ?.querySelector?.('meta[name="version"]')
  ?.getAttribute?.('content') ?? '';
const manifestUrl = buildStamp
  ? `./screenPartialManifest.js?v=${buildStamp}`
  : './screenPartialManifest.js';

const target = globalThis.document?.getElementById?.('app-shell');

/**
 * Resolves after every static screen partial has been fetched and injected.
 * `src/main.js` awaits this before mounting controllers that query the DOM.
 * @type {Promise<void>}
 */
globalThis.__screenPartialsReady = (async () => {
  if (!target) return;

  const { SCREEN_PARTIALS } = await import(manifestUrl);

  const fragments = await Promise.all(
    SCREEN_PARTIALS.map(async (url) => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`screen partial failed: ${url} (${res.status})`);
      return res.text();
    }),
  );

  target.innerHTML = fragments.join('\n');
})();
