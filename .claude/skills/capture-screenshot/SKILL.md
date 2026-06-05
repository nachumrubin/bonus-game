---
name: capture-screenshot
description: Capture PNG screenshots of any screen, overlay, or mini-game in the bonus-game app by driving it from Playwright via window.__spine.ui.mount* APIs. Use when the user asks to "create a screenshot", "capture an image of", "take a screenshot of", or "show me what X looks like" for any in-app UI — home, game screen, overlays, mini-games, auth screens, stats, etc. Output PNGs land under images/guide/ and can be referenced from the in-app guide screen.
allowed-tools: Bash(npx:*), Bash(npm:*), Bash(ls:*), Bash(mkdir:*), Read, Write, Edit, Grep, Glob
---

# Capture Screenshot

A repeatable Playwright-driven pattern for producing committed, reproducible screenshots of any UI state in this app. Used to populate the in-app guide (`partials/screens/guide-screen.html`) and the Google Play store listing.

## When to use this skill

Trigger when the user asks for screenshots of any in-app UI:

- "create a screenshot of X"
- "capture an image of the X screen / overlay / mini-game"
- "show me what X looks like" (with the expectation of a saved PNG, not just a description)
- "regenerate the guide screenshots"

Skip this skill for one-off visual debugging (just run the dev server and inspect) — only use it when the user wants a **committed PNG file**.

## The pattern

Each screenshot lives in a Playwright spec at `tests/e2e/capture-*.spec.js`. Specs aren't assertions — each test mounts a UI piece in a deterministic state and writes a PNG to `images/guide/` or a subdirectory.

### Required spec skeleton

```js
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.resolve(__dirname, '../../images/guide/<subdir>');
fs.mkdirSync(OUT_DIR, { recursive: true });

// 412×820 = phone-portrait, matches manifest.json orientation lock.
test.use({ viewport: { width: 412, height: 820 } });

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true
    && typeof window.__spine.ui?.mountGameScreen === 'function');
  // If any mini-game / word-needing UI is involved, ALSO wait for the dict:
  await page.waitForFunction(async () => {
    try { await window.__spine.ensureDictionaryLoaded?.(); }
    catch { return false; }
    const d = window.__spine.hebrewDictionary?.DICT;
    return d && typeof d.size === 'number' && d.size > 1000;
  }, null, { timeout: 15_000 });
}

async function shot(page, name, locator = null) {
  const file = path.join(OUT_DIR, `${name}.png`);
  if (locator) await locator.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: false });
  return file;
}
```

### Seeded RNG (always required for mini-games or random content)

Inline this so every run produces visually identical PNGs:

```js
const SEEDED_RNG = `
  (function makeRng(seed) {
    let s = seed >>> 0;
    return function rng() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })
`;

// In a test:
await page.evaluate(`(function(){
  const rng = ${SEEDED_RNG}(42);
  window.__activeMiniGame = window.__spine.ui.mountSomethingMiniGame({
    bus: window.__spine.bus, rng, /* ... */
  });
})()`);
```

### Driving the UI

Everything reachable from the menu/setup/account screens is exposed on `window.__spine`. Key surfaces:

| Need | Reach for |
|---|---|
| Bus (emit intents, listen for renders) | `window.__spine.bus` |
| Mount any screen/overlay/mini-game | `window.__spine.ui.mount*` |
| Render-event constants (MENU_REFRESH, etc.) | `window.__spine.ui.<NAME>` |
| Hebrew dictionary (`isValid`, `norm`, `DICT` Set) | `window.__spine.hebrewDictionary` |
| Spawn an offline bot game (for in-game screenshots) | `window.__spine.bootOfflineBot({ difficulty: 1 })` |
| Spawn offline 2-player game | `window.__spine.bootOffline2P()` |

`DICT` is a `Set`, not an array — spread it before filtering: `[...window.__spine.hebrewDictionary.DICT]`.

### Stable feature-state hooks

To make a screen show "realistic" data without going through the full happy path:

```js
// Signed-in user with a rating
await page.evaluate(() => {
  window.__spine.bus.emit(window.__spine.ui.MENU_REFRESH, {
    isAuthed: true,
    displayName: 'אריאל כהן',
    avatar: '👑',
    rating: 1240,
    hasOnlineUnread: false,
    unreadCount: 0,
  });
});

// Show the global topbar (hidden on first paint)
await page.evaluate(() => {
  const tb = document.getElementById('global-topbar');
  if (tb) tb.style.display = '';
});
```

### Hiding stray overlays

Boot can leave intro/help overlays partly visible. Hide them before shooting:

```js
async function hideOverlays(page) {
  await page.evaluate(() => {
    for (const id of ['tut-intro', 'ov-champs', 'ov-settings', 'ov-guide', 'ov-faq']) {
      document.getElementById(id)?.classList.add('hidden');
    }
  });
}
```

### Mini-game-specific notes

Mini-games render into `#ov-bonus` (with `#bchal` as the dynamic body slot) when present, else self-host. To shoot them:

1. Hide `#sh` (home), un-hide `#ov-bonus`.
2. Mount the mini-game via `window.__spine.ui.mountFooMiniGame({ bus, rng, ... })`.
3. **Override the overlay chrome** if you want a specific title/subtitle:
   ```js
   const t = document.getElementById('bovt'); if (t) t.textContent = 'תפזורת';
   const d = document.getElementById('bovd'); if (d) d.textContent = 'מצא מילים…';
   ```
   Some mini-games (unscramble) override `bovt` themselves on mount — that's fine, just don't fight it.
4. Screenshot `#ov-bonus` as a locator (cleaner edges than the full viewport).
5. Wheel mini-game self-hosts outside `#ov-bonus`; fall back to a full-viewport shot.

### Reset between captures (one spec, many shots)

Each `test()` is isolated by Playwright, so you generally don't need this. If you want to do multiple shots in one test, unmount and clear `#bchal` between:

```js
await page.evaluate(() => {
  try { window.__activeMiniGame?.unmount?.(); } catch {}
  window.__activeMiniGame = null;
  const bchal = document.getElementById('bchal');
  if (bchal) bchal.innerHTML = '';
});
```

## Filename + directory conventions

- One subdirectory per logical group: `images/guide/`, `images/guide/minigames/`, etc.
- One PNG per UI state, **kebab-case** (`exchange-overlay.png`, `fill-middle.png`, `home-signed-in.png`).
- Filenames must be stable across re-runs (no timestamps) — the guide HTML hard-codes them.

## Existing capture specs (read these first as templates)

- [tests/e2e/capture-minigame-screenshots.spec.js](../../../tests/e2e/capture-minigame-screenshots.spec.js) — 6 boost mini-games, current canonical reference.
- (On `online-game-fixes` branch, not on `main` or current: `tests/e2e/capture-guide-screenshots.spec.js` covers home / game / stats / signup / exchange / שאילתה. Pull patterns from `git show 29d6ef03:tests/e2e/capture-guide-screenshots.spec.js` if needed.)

## How to run

```bash
npx playwright test tests/e2e/capture-<name>.spec.js --reporter=list
```

The webServer config in `playwright.config.js` boots `python3 -m http.server 4173` automatically. If the user's machine doesn't have `python3`, suggest changing the command to `python -m http.server 4173` or `npx http-server -p 4173`.

Expected runtime: ~2s per screenshot. A 6-shot spec runs in ~12s.

## After capturing — usual follow-ups

Unless told otherwise, also:

1. **Embed the PNGs** in [partials/screens/guide-screen.html](../../../partials/screens/guide-screen.html) as `<figure class="guide-shot">` blocks with a `<figcaption>` matching the section.
2. **Update [docs-md/CHANGELOG.md](../../../docs-md/CHANGELOG.md)** with a brief entry naming the new spec and PNGs.
3. **Run `npm run test:unit`** to confirm nothing broke (175+ tests must pass).

## Gotchas

- **`mount*MiniGame` not on `__spine.ui`?** It's imported in [src/main.js](../../../src/main.js) but missing from the `globalThis.__spine = { ui: {...} }` block. Add it there — pure addition, no behavior change. (Happened for `mountFillMiddleMiniGame`.)
- **Hebrew text rendering** — Playwright's bundled fonts include Heebo via the page's own link in `index.html`. Don't override `font-family` in screenshot CSS.
- **Tall captures clip** — viewport is 412×820. If a screen is taller, use `fullPage: true` in `page.screenshot()` or shoot a specific locator.
- **DICT vs DICT_BASE_URL** — the Set is populated asynchronously. Always go through `ensureDictionaryLoaded()` (also exposed on `__spine`) before sampling words.
- **Boot timing** — `__spine.enabled === true` fires before the dictionary loads. The `bootSpine` helper above checks both; don't shortcut it.
