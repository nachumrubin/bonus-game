// Capture the refreshed crossword-style bonus mini-games after their shared
// premium tile treatment: B10 crossing words and B8 crossword.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.resolve(__dirname, '../../images/guide/minigames');
fs.mkdirSync(OUT_DIR, { recursive: true });

test.use({ viewport: { width: 412, height: 820 } });

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

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true
    && typeof window.__spine.ui?.mountCrossingWordsMiniGame === 'function'
    && typeof window.__spine.ui?.mountCrosswordMiniGame === 'function'
    && typeof window.__spine.hebrewDictionary?.isValid === 'function');
  await page.waitForFunction(async () => {
    try { await window.__spine.ensureDictionaryLoaded?.(); }
    catch { return false; }
    const d = window.__spine.hebrewDictionary?.DICT;
    return d && typeof d.size === 'number' && d.size > 1000;
  }, null, { timeout: 15_000 });
  await page.addStyleTag({
    content: `
      #app-loading,
      #ov-onboarding,
      body > .ov:not(#ov-bonus),
      #sh,
      #global-topbar { display: none !important; }
      #ov-bonus { display: flex !important; }
    `,
  });
}

async function resetBonusOverlay(page) {
  await page.evaluate(() => {
    try { window.__activeMiniGame?.unmount?.(); } catch {}
    window.__activeMiniGame = null;
    document.querySelectorAll('body > .ov').forEach((ov) => {
      if (ov.id === 'ov-bonus') return;
      ov.classList.add('hidden');
      ov.style.display = 'none';
    });
    const bonus = document.getElementById('ov-bonus');
    if (bonus) {
      bonus.classList.remove('hidden');
      bonus.style.display = 'flex';
    }
    const bchal = document.getElementById('bchal');
    if (bchal) bchal.innerHTML = '';
  });
}

async function shotBonus(page, name) {
  await expect(page.locator('#ov-bonus')).toBeVisible();
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.locator('#ov-bonus').screenshot({ path: file });
  return file;
}

test('capture refreshed crossing words screen', async ({ page }) => {
  await bootSpine(page);
  await resetBonusOverlay(page);
  await page.evaluate(`(function(){
    window.__activeMiniGame = window.__spine.ui.mountCrossingWordsMiniGame({
      bus: window.__spine.bus,
      words: [],
      durationMs: 45_000,
    });
    const t = document.getElementById('bovt');
    if (t) t.textContent = 'מילים מצטלבות';
    const d = document.getElementById('bovd');
    if (d) d.textContent = 'מצא את האות המשותפת לשתי המילים';
  })()`);
  await expect(page.locator('#ov-bonus .cw-mini-grid')).toBeVisible();
  await shotBonus(page, 'crossing');
});

test('capture refreshed crossword screen', async ({ page }) => {
  await bootSpine(page);
  await resetBonusOverlay(page);
  await page.evaluate(`(function(){
    const rng = ${SEEDED_RNG}(808);
    const bag = ['א','ב','ג','ד','ה','ו','ז','ח','ט','י','כ','ל','מ','נ','ס','ע','פ','צ','ק','ר','ש','ת'];
    const hv = Object.fromEntries(bag.map((l, i) => [l, (i % 5) + 1]));
    window.__activeMiniGame = window.__spine.ui.mountCrosswordMiniGame({
      bus: window.__spine.bus,
      bag,
      validator: (word) => window.__spine.hebrewDictionary.isValid(word),
      hv,
      rng,
      durationMs: 60_000,
    });
    const t = document.getElementById('bovt');
    if (t) t.textContent = 'תשבץ';
    const d = document.getElementById('bovd');
    if (d) d.textContent = 'הרכב מילים מהאותיות שלך על הלוח';
  })()`);
  await expect(page.locator('#ov-bonus .xw-board')).toBeVisible();
  for (const cell of ['0-1', '0-2', '1-1']) {
    await page.locator('#ov-bonus .xw-pool-tile').first().click();
    await page.locator(`#ov-bonus [data-mb="${cell}"]`).click();
  }
  await page.locator('#ov-bonus .xw-pool-tile').first().click();
  await shotBonus(page, 'crossword');
});
