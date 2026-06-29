// Drive the scripted DEMO game (src/game/debug/demoTimeline.js) through the
// replay overlay and capture one PNG per frame into images/guide/debug/demo/.
// This is the "run it to see what the recorder looks like" artifact, and a
// visual companion to demoTimeline.test.js (which pins the same fixture's logic).
const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.resolve(__dirname, '../../images/guide/debug/demo');
fs.mkdirSync(OUT_DIR, { recursive: true });

test.use({ viewport: { width: 412, height: 1480 } }); // tall: fit 3 panels + their step lists

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true
    && typeof window.__spine.debug?.openDemoReplay === 'function');
}

test('demo game replay — frame by frame', async ({ page }) => {
  await bootSpine(page);

  // Open the demo via the same console hook a developer would use.
  await page.evaluate(() => window.__spine.debug.openDemoReplay());

  // The test env can't reach Firebase, so the boot "מתחבר…" splash and the
  // onboarding/boost-intro overlays keep popping up. Remove any overlay that
  // isn't the replay before each shot.
  const clearStrayOverlays = () => page.evaluate(() => {
    document.getElementById('app-loading')?.remove();
    for (const ov of document.querySelectorAll('.ov')) {
      if (ov.id !== 'ov-replay') ov.remove();
    }
  });
  await clearStrayOverlays();

  const overlay = page.locator('#ov-replay');
  await overlay.waitFor({ state: 'visible' });

  const frameCount = await page.evaluate(() => {
    const scrub = document.getElementById('replay-scrub');
    return scrub ? Number(scrub.max) + 1 : 1;
  });

  for (let i = 0; i < frameCount; i++) {
    // Jump straight to frame i via the scrubber (deterministic).
    await page.evaluate((idx) => {
      const scrub = document.getElementById('replay-scrub');
      if (scrub) { scrub.value = String(idx); scrub.dispatchEvent(new Event('input', { bubbles: true })); }
    }, i);
    await clearStrayOverlays();
    await page.waitForTimeout(120);
    await overlay.screenshot({ path: path.join(OUT_DIR, `frame-${String(i + 1).padStart(2, '0')}.png`) });
  }

  // Also capture just the time-aligned timeline grid (it sits below the stacked
  // boards in this narrow viewport), at a mid-game frame.
  await page.evaluate(() => {
    const scrub = document.getElementById('replay-scrub');
    if (scrub) { scrub.value = '4'; scrub.dispatchEvent(new Event('input', { bubbles: true })); }
    // The replay-wrap caps at 94vh with internal scroll, which clips an
    // element-screenshot of the timeline. Lift the cap so it lays out fully.
    const wrap = document.querySelector('.replay-wrap');
    if (wrap) { wrap.style.maxHeight = 'none'; wrap.style.overflow = 'visible'; }
    const ov = document.getElementById('ov-replay');
    if (ov) ov.style.alignItems = 'flex-start';
  });
  await clearStrayOverlays();
  await page.waitForTimeout(150);
  await page.locator('#replay-timeline').screenshot({ path: path.join(OUT_DIR, 'timeline-grid.png') });
});
