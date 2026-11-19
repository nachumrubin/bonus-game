// Boost 2.0 — a complete local (pass-and-play) match in the browser (Phase 5
// acceptance gate: "human players can complete an entire local Boost 2.0
// match"). Uses the real setup screen, coin toss, board taps and buttons;
// only the racks are seeded so the words are known.
const { test, expect } = require('@playwright/test');
const path = require('node:path');

const SHOTS = process.env.BOOST_V2_SHOTS || null; // folder for review screenshots (optional)
async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: SHOTS ? 2 : 1,
  // Optional: a preinstalled Chromium when the pinned Playwright's own browser is absent.
  ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
});
test.setTimeout(120_000);

// Put `letters` into the current player's rack (rest of the rack goes back to
// the bag; tile conservation is kept).
async function seedRack(page, letters) {
  await page.evaluate((ls) => {
    const st = window.__spine.activeGame.session.state;
    const slot = st.currentTurnSlot;
    st.bag.push(...st.racks[slot]);
    st.racks[slot] = [];
    for (const l of ls) st.racks[slot].push(st.bag.splice(st.bag.lastIndexOf(l), 1)[0]);
    while (st.racks[slot].length < 8) st.racks[slot].push(st.bag.pop());
  }, letters);
}
const state = (page) => page.evaluate(() => {
  const st = window.__spine.activeGame?.session?.state;
  return st && {
    ruleset: st.ruleset, phase: st.boostV2?.phase, turn: st.currentTurnSlot, status: st.status,
    active: st.boostV2?.activeBoosts?.map(b => [b.r, b.c]) ?? [], moves: st.moveHistory.length,
  };
});
async function placeViaController(page, tiles) {
  await page.evaluate((ts) => {
    const c = window.__spine.activeGame.controller;
    for (const t of ts) c.placeTile({ ...t, isJoker: false, rackIndex: null });
  }, tiles);
}
async function settle(page) {
  await expect(page.locator('#brack')).not.toHaveClass(/is-disabled/, { timeout: 10_000 });
}
async function clickPlay(page) {
  await expect(page.locator('#btn-play')).toBeEnabled({ timeout: 10_000 });
  await page.locator('#btn-play').click();
}

test('a full Boost 2.0 pass-and-play match: setup, opening Boosts, a Boost move, end with deductions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__spine?.enabled === true && window.__spine.setup && window.__spine.bus);
  await page.waitForFunction(() => window.__spine.dictReady?.() ?? true);

  // Setup screen: two players, Boost 2.0, no timer.
  await page.evaluate(() => window.__spine.bus.emit('menu/start2P'));
  await expect(page.locator('#ss')).toBeVisible();
  await expect(page.locator('#ss-ruleset-row')).toBeVisible();
  await page.locator('#ss-rules-v2').click();
  await page.locator('#ss-spd-0').click();
  await shot(page, '01-setup');
  await page.locator('#ss .mf-cta').click();
  await expect(page.locator('#coin-enter')).toBeEnabled({ timeout: 8000 });
  await page.locator('#coin-enter').click();

  await expect.poll(() => state(page)).toMatchObject({ ruleset: 'BOOST_V2', phase: 'FIRST_ROUND' });
  await expect(page.locator('#sg')).toHaveClass(/boost-v2/);
  await expect(page.locator('#v2-strip')).toContainText('הבאים בתור');
  await expect(page.locator('#game-grid .bsq')).toHaveCount(0); // no legacy bonus squares
  await expect(page.locator('#is-locks-1')).toBeHidden();      // no locks in Boost 2.0
  await expect(page.locator('#is-locks-2')).toBeHidden();
  await page.waitForFunction(() => window.__spine.isDictReady?.() !== false);
  await shot(page, '02-first-turn');

  // Opening word "לא" across the centre.
  await seedRack(page, ['ל', 'א']);
  await placeViaController(page, [{ r: 4, c: 4, letter: 'ל', val: 2 }, { r: 4, c: 5, letter: 'א', val: 1 }]);
  await clickPlay(page);
  await expect.poll(async () => (await state(page)).moves).toBe(1);
  await page.evaluate(() => window.__spine.activeGame.controller.passTurn());

  // Opening setup: three placements via board taps + "הצב כאן".
  await expect.poll(async () => (await state(page)).phase).toBe('OPENING_SETUP');
  await expect(page.locator('#v2-strip')).toContainText('מציבים בוסטים');
  await expect(page.locator('#btn-play .bplay-l')).toHaveText('הצב כאן');
  await shot(page, '03-setup-step1');
  for (const [r, c] of [[3, 4], [5, 4], [4, 6]]) {
    await expect(page.locator(`#c${r}_${c}`)).toHaveClass(/v2-legal/);
    await page.locator(`#c${r}_${c}`).click();
    await expect(page.locator(`#c${r}_${c} .v2-mk.is-pending`)).toBeVisible();
    await clickPlay(page);
  }
  await expect.poll(async () => (await state(page)).phase).toBe('NORMAL');
  await expect(page.locator('#game-grid .v2-mk')).toHaveCount(3);
  await expect(page.locator('#v2-strip')).toContainText('הבאים בתור');
  await settle(page);
  await shot(page, '04-three-boosts');

  // Tap a Boost (no tile selected) → challenge details sheet.
  await page.locator('#c3_4').click();
  await expect(page.locator('#v2-sheet')).toBeVisible();
  await expect(page.locator('#v2-sheet .v2-sheet-req')).not.toBeEmpty();
  await shot(page, '05-details-sheet');
  await page.locator('#v2-sheet .v2-sheet-ok').click();
  await expect(page.locator('#v2-sheet')).toBeHidden();

  // A move covering the Boost at (5,4): "לא" downwards from ל.
  await seedRack(page, ['א']);
  await placeViaController(page, [{ r: 5, c: 4, letter: 'א', val: 1 }]);
  await expect(page.locator('#v2-strip .v2-tray')).toBeVisible();
  await expect(page.locator('#game-grid .cell.v2-legal').first()).toBeVisible();
  await settle(page);
  await shot(page, '06-replacement-mode');
  await clickPlay(page); // no replacement chosen yet → hint, nothing committed
  await expect(page.locator('#sbar')).toContainText('מקמו את הבוסט החדש');
  expect((await state(page)).moves).toBe(1);
  await page.locator('#game-grid .cell.v2-legal').first().click();
  await expect(page.locator('#v2-strip .v2-ok')).toBeVisible();
  await clickPlay(page);
  await expect.poll(async () => (await state(page)).moves).toBe(2);
  await expect(page.locator('#v2-result')).toBeVisible();
  await expect(page.locator('#v2-result')).toContainText('סה״כ');
  await shot(page, '07-result-card');
  expect((await state(page)).active).toHaveLength(3);

  // Four scoreless turns end the match naturally → both racks deducted.
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__spine.activeGame.controller.passTurn());
  await expect.poll(async () => (await state(page)).status).toBe('completed');
  await expect(page.locator('#ov-end')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#ov-end .end-v2-ded')).toHaveCount(2);
  await shot(page, '08-game-over');

  expect(errors).toEqual([]);
});
