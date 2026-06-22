// Boost mini-game screenshot capture spec.
//
// Mounts each mini-game directly via window.__spine.ui.mount*MiniGame and
// snaps a PNG of the resulting overlay. Each test seeds a deterministic
// RNG (mulberry32) so re-runs produce visually identical captures.
//
// Output → images/guide/minigames/*.png. Referenced from
// partials/screens/guide-screen.html in the "בוסטים ומיני-משחקים"
// section.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.resolve(__dirname, '../../images/guide/minigames');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Match phone-portrait aspect for consistency with the rest of the guide.
test.use({ viewport: { width: 412, height: 820 } });

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true
    && typeof window.__spine.ui?.mountHiddenWordMiniGame === 'function'
    && typeof window.__spine.hebrewDictionary?.isValid === 'function');
  // Mini-games that need a Hebrew word list pull from hebrewDictionary.DICT.
  // The first paint may finish before the dictionary file is downloaded, so
  // explicitly wait for it.
  await page.waitForFunction(async () => {
    try { await window.__spine.ensureDictionaryLoaded?.(); }
    catch { return false; }
    const d = window.__spine.hebrewDictionary?.DICT;
    return d && typeof d.size === 'number' && d.size > 1000;
  }, null, { timeout: 15_000 });
  // The boot splash + onboarding welcome popup appear on delayed timers and can
  // re-show after being hidden. A persistent !important override keeps them out
  // of every capture regardless of timing.
  await page.addStyleTag({ content: '#ov-onboarding,#app-loading{display:none!important}' });
}

async function showBonusOverlay(page) {
  await page.evaluate(() => {
    // Hide the home screen + the boot splash so neither shows through (the
    // #app-loading "מתחבר..." splash stays painted over #ov-bonus until the
    // Firebase connection settles, which never happens in the test harness).
    for (const id of ['sh', 'tut-intro', 'ov-champs', 'ov-settings', 'ov-guide', 'ov-faq', 'ov-onboarding']) {
      document.getElementById(id)?.classList.add('hidden');
    }
    const loader = document.getElementById('app-loading');
    if (loader) loader.style.display = 'none';
    const ov = document.getElementById('ov-bonus');
    if (ov) ov.classList.remove('hidden');
  });
}

async function shot(page, name) {
  // The onboarding welcome popup (#ov-onboarding) and boot splash appear on
  // delayed timers and can re-show after showBonusOverlay hid them — hide them
  // again right before capturing so they never pollute a mini-game shot.
  await page.evaluate(() => {
    document.getElementById('ov-onboarding')?.classList.add('hidden');
    const loader = document.getElementById('app-loading');
    if (loader) loader.style.display = 'none';
  });
  const ov = page.locator('#ov-bonus');
  // Some mini-games (wheel) build a self-host outside #ov-bonus; fall back
  // to a full-viewport shot if the overlay locator isn't visible.
  const visible = await ov.isVisible().catch(() => false);
  const file = path.join(OUT_DIR, `${name}.png`);
  if (visible) await ov.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: false });
  return file;
}

// Inline a seeded RNG so screenshots are reproducible.
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

// Tear down any previously mounted mini-game and clear the overlay's
// dynamic container so the next mount starts from a clean slate.
async function resetOverlay(page) {
  await page.evaluate(() => {
    try { window.__activeMiniGame?.unmount?.(); } catch {}
    window.__activeMiniGame = null;
    const bchal = document.getElementById('bchal');
    if (bchal) bchal.innerHTML = '';
    // The score-bonus animation host may have leaked nodes; clear them too.
    for (const sel of ['.ws-host', '.cw-host', '.hc-host', '.cx-host', '.uns-host', '.fm-host', '.wheel-host']) {
      document.querySelectorAll(sel).forEach(n => n.remove());
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// 1. מילה נסתרת (hidden word)
// ─────────────────────────────────────────────────────────────────────
test('minigame — מילה נסתרת (hidden word)', async ({ page }) => {
  await bootSpine(page);
  await resetOverlay(page);
  await showBonusOverlay(page);
  await page.evaluate(`(function(){
    const rng = ${SEEDED_RNG}(42);
    const hd = window.__spine.hebrewDictionary;
    // Seed with 3-letter dictionary words so one is hidden in the 4×4 grid.
    const words = [...hd.DICT].filter(w => hd.norm(w).length === 3).slice(0, 200);
    window.__activeMiniGame = window.__spine.ui.mountHiddenWordMiniGame({
      bus: window.__spine.bus,
      words, rng,
      validator: (w) => hd.isValid(w),
      durationMs: 10_000,
    });
    // Headline + subtitle so the overlay chrome reads naturally.
    const t = document.getElementById('bovt'); if (t) t.textContent = 'מילה נסתרת';
    const d = document.getElementById('bovd'); if (d) d.textContent = 'מצא מילה נסתרת ברשת 4×4';
  })()`);
  await page.waitForTimeout(300);
  await shot(page, 'hiddenword');
});

// ─────────────────────────────────────────────────────────────────────
// 1b. אות פותחת (letter spinner)
// ─────────────────────────────────────────────────────────────────────
test('minigame — אות פותחת (letter spinner)', async ({ page }) => {
  await bootSpine(page);
  await resetOverlay(page);
  await showBonusOverlay(page);
  await page.evaluate(`(function(){
    const rng = ${SEEDED_RNG}(9);
    const hd = window.__spine.hebrewDictionary;
    window.__activeMiniGame = window.__spine.ui.mountLetterSpinnerMiniGame({
      bus: window.__spine.bus,
      validator: (w) => hd.isValid(w),
      norm: hd.norm,
      rng,
      letter: 'ב',           // preset so the capture shows the play phase
      durationMs: 20_000,
    });
    // Populate a few found words so the chips list reads naturally.
    const words = [...hd.DICT].filter(w => [...w][0] === 'ב' && hd.norm(w).length >= 2).slice(0, 5);
    for (const w of words) window.__activeMiniGame.submit(w);
    const t = document.getElementById('bovt'); if (t) t.textContent = 'אות פותחת';
  })()`);
  await page.waitForTimeout(300);
  await shot(page, 'letterspinner');
});

// ─────────────────────────────────────────────────────────────────────
// 2. כוורת (honeycomb)
// ─────────────────────────────────────────────────────────────────────
test('minigame — כוורת (honeycomb)', async ({ page }) => {
  await bootSpine(page);
  await resetOverlay(page);
  await showBonusOverlay(page);
  await page.evaluate(`(function(){
    const rng = ${SEEDED_RNG}(7);
    const hd = window.__spine.hebrewDictionary;
    window.__activeMiniGame = window.__spine.ui.mountHoneycombMiniGame({
      bus: window.__spine.bus,
      validator: (w) => hd.isValid(w),
      norm: hd.norm,
      rng,
      durationMs: 60_000,
    });
    const t = document.getElementById('bovt'); if (t) t.textContent = 'כוורת';
    const d = document.getElementById('bovd'); if (d) d.textContent = 'צור מילים סביב אות מרכזית';
  })()`);
  await page.waitForTimeout(300);
  await shot(page, 'honeycomb');
});

// ─────────────────────────────────────────────────────────────────────
// 3. סידור מחדש (unscramble)
// ─────────────────────────────────────────────────────────────────────
test('minigame — סידור מחדש (unscramble)', async ({ page }) => {
  await bootSpine(page);
  await resetOverlay(page);
  await showBonusOverlay(page);
  await page.evaluate(`(function(){
    const rng = ${SEEDED_RNG}(13);
    const dict = [...window.__spine.hebrewDictionary.DICT];
    const words = dict.filter(w => w.length >= 3 && w.length <= 6);
    window.__activeMiniGame = window.__spine.ui.mountUnscrambleMiniGame({
      bus: window.__spine.bus,
      words, tier: 'medium', rng,
      validator: (w) => window.__spine.hebrewDictionary.isValid(w),
    });
    const t = document.getElementById('bovt'); if (t) t.textContent = 'סידור מחדש';
    const d = document.getElementById('bovd'); if (d) d.textContent = 'סדר את האותיות למילה תקינה';
  })()`);
  await page.waitForTimeout(300);
  await shot(page, 'unscramble');
});

// ─────────────────────────────────────────────────────────────────────
// 4. מילים חוצות (crossing words)
// ─────────────────────────────────────────────────────────────────────
test('minigame — מילים חוצות (crossing words)', async ({ page }) => {
  await bootSpine(page);
  await resetOverlay(page);
  await showBonusOverlay(page);
  await page.evaluate(`(function(){
    const rng = ${SEEDED_RNG}(99);
    const dict = [...window.__spine.hebrewDictionary.DICT];
    const words = dict.filter(w => w.length >= 3 && w.length <= 5).slice(0, 800);
    window.__activeMiniGame = window.__spine.ui.mountCrossingWordsMiniGame({
      bus: window.__spine.bus,
      words, rng,
      durationMs: 45_000,
    });
    const t = document.getElementById('bovt'); if (t) t.textContent = 'מילים חוצות';
    const d = document.getElementById('bovd'); if (d) d.textContent = 'מצא שתי מילים שמתחברות';
  })()`);
  await page.waitForTimeout(300);
  await shot(page, 'crossing');
});

// ─────────────────────────────────────────────────────────────────────
// 5. מילה חסרה (fill middle)
// ─────────────────────────────────────────────────────────────────────
test('minigame — מילה חסרה (fill middle)', async ({ page }) => {
  await bootSpine(page);
  await resetOverlay(page);
  await showBonusOverlay(page);
  await page.evaluate(`(function(){
    window.__activeMiniGame = window.__spine.ui.mountFillMiddleMiniGame({
      bus: window.__spine.bus,
      answer: 'מחשב',
      validator: (w) => window.__spine.hebrewDictionary.isValid(w),
      durationMs: 30_000,
    });
    const t = document.getElementById('bovt'); if (t) t.textContent = 'מילה חסרה';
    const d = document.getElementById('bovd'); if (d) d.textContent = 'השלם את האותיות החסרות במילה';
  })()`);
  await page.waitForTimeout(300);
  await shot(page, 'fill-middle');
});

// ─────────────────────────────────────────────────────────────────────
// 6. גלגל המזל (wheel)
// Wheel builds its own self-host outside #ov-bonus, so let the full
// viewport be captured. The wheel renders immediately at rest.
// ─────────────────────────────────────────────────────────────────────
test('minigame — גלגל המזל (wheel)', async ({ page }) => {
  await bootSpine(page);
  await resetOverlay(page);
  await page.evaluate(`(function(){
    const rng = ${SEEDED_RNG}(5);
    window.__activeMiniGame = window.__spine.ui.mountWheelMiniGame({
      bus: window.__spine.bus, rng,
      spinDurationMs: 60_000,   // freeze mid-spin for a clean shot
    });
  })()`);
  await page.waitForTimeout(400);
  await shot(page, 'wheel');
});
