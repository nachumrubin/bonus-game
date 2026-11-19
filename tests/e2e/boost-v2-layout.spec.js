// Boost 2.0 board layout on a phone browser viewport (Chrome toolbars shown:
// ~411×740 CSS px). The board spans the width, never overlaps the queue strip
// or the rack, and keeps its size when the strip switches to opening setup.
const { test, expect } = require('@playwright/test');

test.use({
  viewport: { width: 411, height: 740 },
  ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
});
test.setTimeout(90_000);

const rect = (page, sel) => page.locator(sel).evaluate(el => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, width: r.width };
});

async function assertLayout(page) {
  const board = await rect(page, '#board-center-inner');
  const strip = await rect(page, '#v2-strip');
  const rack = await rect(page, '#brack');
  expect(board.width).toBeGreaterThan(411 * 0.95);
  expect(board.top).toBeGreaterThanOrEqual(strip.bottom - 1);
  expect(board.bottom).toBeLessThanOrEqual(rack.top + 1);
  return board;
}

test('Boost 2.0 board: full width, no overlap, same size in first round and opening setup; centre squares marked', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__spine?.enabled === true && window.__spine.setup && window.__spine.bus);
  await page.evaluate(() => window.__spine.bus.emit('menu/start2P'));
  await page.locator('#ss-rules-v2').click();
  await page.locator('#ss-spd-0').click();
  await page.locator('#ss .mf-cta').click();
  await expect(page.locator('#coin-enter')).toBeEnabled({ timeout: 8000 });
  await page.locator('#coin-enter').click();
  await expect(page.locator('#game-grid > *')).toHaveCount(100);

  // First move: the four centre squares are marked, nothing else.
  await expect(page.locator('#game-grid .cell.v2-center')).toHaveCount(4);
  for (const id of ['#c4_4', '#c4_5', '#c5_4', '#c5_5']) await expect(page.locator(id)).toHaveClass(/v2-center/);
  await page.waitForTimeout(600);
  const first = await assertLayout(page);

  // Opening word + pass → opening setup (taller content in the strip before).
  await page.waitForFunction(() => window.__spine.isDictReady?.() !== false);
  await page.evaluate(() => {
    const ag = window.__spine.activeGame; const st = ag.session.state; const s = st.currentTurnSlot;
    st.bag.push(...st.racks[s]); st.racks[s] = [];
    for (const l of ['ל', 'א']) st.racks[s].push(st.bag.splice(st.bag.lastIndexOf(l), 1)[0]);
    ag.session.dispatch({ type: 'cmd/CONFIRM_MOVE', payload: { placed: [{ r: 4, c: 4, letter: 'ל' }, { r: 4, c: 5, letter: 'א' }] } });
  });
  await expect(page.locator('#game-grid .cell.v2-center')).toHaveCount(0);
  await page.evaluate(() => window.__spine.activeGame.controller.passTurn());
  await expect(page.locator('#v2-strip')).toContainText('מציבים בוסטים');
  await page.waitForTimeout(600);
  const setup = await assertLayout(page);
  expect(Math.abs(setup.width - first.width)).toBeLessThan(1);
  expect(Math.abs(setup.top - first.top)).toBeLessThan(1);
  expect(errors).toEqual([]);
});
