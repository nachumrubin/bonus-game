// Boost 2.0 vs the bot in the browser (Phase 6): the real setup screen, the
// real bot session (opening-setup placements + moves with replacements).
const { test, expect } = require('@playwright/test');
const path = require('node:path');

const SHOTS = process.env.BOOST_V2_SHOTS || null;
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: SHOTS ? 2 : 1,
  ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
});
test.setTimeout(180_000);

const state = (page) => page.evaluate(() => {
  const st = window.__spine.activeGame?.session?.state;
  return st && {
    ruleset: st.ruleset, phase: st.boostV2?.phase, turn: st.currentTurnSlot, status: st.status,
    active: st.boostV2?.activeBoosts?.length ?? 0, moves: st.moveHistory.length,
    setupBy: st.boostV2?.openingSetup?.placements?.map(p => p.placedBySlot) ?? null,
    botMoves: st.moveHistory.filter(m => m.slot === 1).length,
  };
});

test('human vs Boost 2.0 bot: the bot places its opening Boosts and plays moves', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__spine?.enabled === true && window.__spine.setup && window.__spine.bus);
  await page.evaluate(() => window.__spine.bus.emit('menu/startVsBot'));
  await expect(page.locator('#ss')).toBeVisible();
  await expect(page.locator('#ss-ruleset-row')).toBeVisible();
  await page.locator('#ss-rules-v2').click();
  await page.locator('#ss-spd-0').click();
  await page.locator('#ss .mf-cta').click();
  // vs-intro + coin toss
  await expect(page.locator('#coin-enter')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#coin-enter').click();
  await expect.poll(() => state(page), { timeout: 15_000 }).toMatchObject({ ruleset: 'BOOST_V2' });
  await page.waitForFunction(() => window.__spine.isDictReady?.() !== false);

  // Human (slot 0) plays a simple opening whenever it is their turn, until the
  // board has its three Boosts; the bot handles its own turns and setup steps.
  async function humanTurn() {
    const s = await state(page);
    if (s.turn !== 0 || s.status !== 'playing') return;
    if (s.phase === 'OPENING_SETUP') {
      await page.locator('#game-grid .cell.v2-legal').first().click();
      await page.locator('#btn-play').click();
      return;
    }
    await page.evaluate(() => window.__spine.activeGame.controller.passTurn());
  }
  const deadline = Date.now() + 120_000;
  // Seed a known opener for the human if they start.
  const first = await state(page);
  if (first.turn === 0) {
    await page.evaluate(() => {
      const st = window.__spine.activeGame.session.state;
      st.bag.push(...st.racks[0]); st.racks[0] = [];
      for (const l of ['ל', 'א']) st.racks[0].push(st.bag.splice(st.bag.lastIndexOf(l), 1)[0]);
      while (st.racks[0].length < 8) st.racks[0].push(st.bag.pop());
      const c = window.__spine.activeGame.controller;
      c.placeTile({ r: 4, c: 4, letter: 'ל', val: 2, isJoker: false, rackIndex: null });
      c.placeTile({ r: 4, c: 5, letter: 'א', val: 1, isJoker: false, rackIndex: null });
    });
    await expect(page.locator('#btn-play')).toBeEnabled({ timeout: 10_000 });
    await page.locator('#btn-play').click();
  }
  for (;;) {
    const s = await state(page);
    if ((s.phase === 'NORMAL' && s.botMoves >= 2) || s.status !== 'playing') break;
    if (Date.now() > deadline) throw new Error(`stalled: ${JSON.stringify(s)}`);
    await expect(page.locator('#brack')).not.toHaveClass(/is-disabled/, { timeout: 30_000 }).catch(() => {});
    await humanTurn();
    await page.waitForTimeout(300);
  }
  const s = await state(page);
  expect(s.phase).toBe('NORMAL');
  expect(s.active).toBe(3);
  expect(s.botMoves).toBeGreaterThanOrEqual(1);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'bot-01-after-bot-moves.png') });
  expect(errors).toEqual([]);
});
