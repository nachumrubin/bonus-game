// Screenshot the new app-boot loading overlay at the moment all four
// tiles have landed (just before the lightning sweep). The loader is
// inlined in index.html so it's visible at first paint — we just freeze
// the page near the natural sync point and snap.

const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.resolve(__dirname, '../../images/guide');
fs.mkdirSync(OUT_DIR, { recursive: true });

test.use({ viewport: { width: 414, height: 896 } });

test('app loading overlay: tiles + lightning', async ({ page }) => {
  await page.goto('/');
  // The loader is visible at first paint; wait for the tiles to land.
  // 700 ms = just after tile 4 finishes its bounce, before the bolt sweep.
  await page.waitForSelector('#app-loading .app-loading-tile', { timeout: 5_000 });
  await page.waitForTimeout(700);

  // Force the loader to stay visible — main.js may try to hide it once
  // auth resolves. We don't care about that here; we just want the art.
  await page.evaluate(() => {
    const el = document.getElementById('app-loading');
    if (el) { el.classList.remove('is-hidden'); el.style.opacity = '1'; el.style.visibility = ''; }
  });

  const out = path.join(OUT_DIR, 'app-loading.png');
  await page.screenshot({ path: out, fullPage: false });
  console.log(`[capture] wrote ${out}`);
});
