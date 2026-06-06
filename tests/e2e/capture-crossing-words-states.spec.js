// Crossing-words mini-game (B10 "שתי מילים חוצות") — capture the three
// UX states after the in-tile-input rework:
//   1. initial   → input embedded in the gold "?" crossing cell
//   2. success   → both completed words shown in the result panel
//   3. wrong     → user's invalid pair + the correct pair below it
//
// Uses the static FALLBACK_CROSSING_PAIR (תפוח / חגים, shared='ח') by
// passing words:[] so every state shows the same recognizable pair. The
// wrong-letter case types 'ב' which produces 'תפוב' / 'בגים' — both
// clearly invalid Hebrew.
//
// Output → images/guide/minigames/crossing-*.png.

const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.resolve(__dirname, '../../images/guide/minigames');
fs.mkdirSync(OUT_DIR, { recursive: true });

test.use({ viewport: { width: 412, height: 820 } });

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true
    && typeof window.__spine.ui?.mountCrossingWordsMiniGame === 'function');
}

async function showBonusOverlay(page) {
  await page.evaluate(() => {
    for (const id of ['sh', 'tut-intro', 'ov-champs', 'ov-settings', 'ov-guide', 'ov-faq']) {
      document.getElementById(id)?.classList.add('hidden');
    }
    const ov = document.getElementById('ov-bonus');
    if (ov) ov.classList.remove('hidden');
  });
}

async function resetOverlay(page) {
  await page.evaluate(() => {
    try { window.__activeMiniGame?.unmount?.(); } catch {}
    window.__activeMiniGame = null;
    const bchal = document.getElementById('bchal');
    if (bchal) bchal.innerHTML = '';
  });
}

async function mountCrossing(page) {
  await page.evaluate(`(function(){
    window.__activeMiniGame = window.__spine.ui.mountCrossingWordsMiniGame({
      bus: window.__spine.bus,
      words: [],          // force the static fallback pair (תפוח / חגים)
      durationMs: 45_000,
    });
    const t = document.getElementById('bovt');
    if (t) t.textContent = 'שתי מילים חוצות!';
    const d = document.getElementById('bovd');
    if (d) d.textContent = 'מצא את האות המשותפת לשתי המילים (+40 נקודות)';
  })()`);
}

async function shotOverlay(page, name) {
  const ov = page.locator('#ov-bonus');
  const file = path.join(OUT_DIR, `${name}.png`);
  await ov.screenshot({ path: file });
  return file;
}

test('crossing-words — initial state (input lives in the ? cell)', async ({ page }) => {
  await bootSpine(page);
  await resetOverlay(page);
  await showBonusOverlay(page);
  await mountCrossing(page);
  await page.waitForTimeout(250);
  await shotOverlay(page, 'crossing-initial');
});

test('crossing-words — success state (both completed words shown)', async ({ page }) => {
  await bootSpine(page);
  await resetOverlay(page);
  await showBonusOverlay(page);
  await mountCrossing(page);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const inp = document.querySelector('#bchal input');
    if (inp) inp.value = window.__activeMiniGame._puzzle.shared;  // 'ח'
    document.getElementById('bok')?.click();
  });
  await page.waitForTimeout(250);
  await shotOverlay(page, 'crossing-success');
});

test('crossing-words — wrong-letter state (invalid pair + correct answer)', async ({ page }) => {
  await bootSpine(page);
  await resetOverlay(page);
  await showBonusOverlay(page);
  await mountCrossing(page);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const inp = document.querySelector('#bchal input');
    // 'ב' → תפוב / בגים: both gibberish, guaranteed dictionary miss.
    if (inp) inp.value = 'ב';
    document.getElementById('bok')?.click();
  });
  await page.waitForTimeout(250);
  await shotOverlay(page, 'crossing-wrong');
});
