const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

test.use({ viewport: { width: 430, height: 932 }, video: { mode: 'on', size: { width: 430, height: 932 } } });

const cases = [
  { name: 'points', type: 'B2', os: 'no-preference', setting: 'auto' },
  { name: 'badge', type: 'B6', os: 'no-preference', setting: 'auto' },
  { name: 'mini-game', type: 'B1', os: 'no-preference', setting: 'auto' },
  { name: 'wheel', type: 'B13', os: 'no-preference', setting: 'auto' },
  { name: 'reduced-badge', type: 'B6', os: 'reduce', setting: 'auto', reduced: true },
  { name: 'reduced-intro', type: 'B1', os: 'no-preference', setting: 'on', reduced: true },
  { name: 'explicit-full', type: 'B2', os: 'reduce', setting: 'off' },
  { name: 'bot-points', type: 'B2', os: 'no-preference', setting: 'auto', botMove: true },
];

for (const scenario of cases) {
  test(`Boost electric square precedes ${scenario.name} in a bot game`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.emulateMedia({ reducedMotion: scenario.os });
    await page.addInitScript(setting => {
      localStorage.setItem('spine.uiPreferences', JSON.stringify({ reducedMotion: setting, soundFx: false }));
    }, scenario.setting);
    await page.goto('/');
    await page.waitForFunction(() => window.__spine?.enabled);
    await page.addStyleTag({ content: '#ov-onboarding,#app-loading{display:none!important}' });
    await page.evaluate(async ({ type, botMove }) => {
      const s = window.__spine;
      await s.ensureDictionaryLoaded();
      // Hard mode chooses the best move deterministically; medium deliberately
      // samples alternatives, so it need not choose the prepared Boost square.
      s.bootOfflineBot({ difficulty: botMove ? 2 : 0 });
      const state = s.activeGame.session.state;
      // A reproducible late-board fixture; placement and confirmation below
      // use real UI, dictionary validation, engine events and required UI.
      state.firstMove = false;
      state.board[4][0] = { letter: 'ל', val: 1 };
      state.board[4][1] = { letter: 'ו', val: 1 };
      state.board[4][2] = { letter: 'ם', val: 2 };
      state.racks[0] = ['ש', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז'];
      if (botMove) state.racks[1] = ['ש'];
      state.bonusAssignment[7] = { type, pts: 40, ic: '⚡' };
      s.bus.emit(s.EV.GAME_STARTED, {});
      window.boostTrace = { events: [], frames: [] };
      for (const name of [s.EV.MOVE_CONFIRMED, s.EV.BOOST_ACTIVATED, s.EV.BONUS_PENDING, 'boost/result-ready']) {
        s.bus.on(name, payload => boostTrace.events.push({ name, at: performance.now(), payload }));
      }
      window.boostSampler = setInterval(() => {
        const square = document.querySelector('#bsq-7');
        const core = getComputedStyle(square, '::before');
        const sparks = getComputedStyle(square, '::after');
        const result = document.querySelector('.bonus-award-positioner') || document.querySelector('#ov-bonus-intro:not(.hidden)');
        boostTrace.frames.push({ at: performance.now(), active: square.classList.contains('bonus-activate'),
          letter: square.querySelector('.bt-l')?.textContent,
          core: core.animationName, opacity: Number(core.opacity), glow: core.boxShadow,
          sparks: sparks.animationName, transform: sparks.transform, filter: core.filter,
          result: !!result, resultOpacity: result ? getComputedStyle(result).opacity : null,
          badge: !!document.querySelector('[data-badge="multiplier"]'),
          banner: !!document.querySelector('.spine-multiplier-banner'),
          squareOpacity: getComputedStyle(square).opacity,
        });
      }, 16);
    }, scenario);
    if (scenario.botMove) {
      await page.waitForTimeout(650);
      await page.evaluate(() => window.__spine.activeGame.session.dispatch({ type: 'cmd/PASS_TURN' }));
    } else {
      await page.locator('#brack .bt2').first().click();
      await page.locator('#bsq-7').click();
      await expect(page.locator('#bsq-7 .bt-l')).toHaveText('ש');
      await page.waitForTimeout(650);
      await page.locator('#btn-play').click();
    }
    const result = scenario.type === 'B1' || scenario.type === 'B13'
      ? page.locator('#ov-bonus-intro') : page.locator('.bonus-award-positioner');
    await expect(result).toBeVisible({ timeout: scenario.botMove ? 15000 : 5000 });
    await page.waitForTimeout(750);
    const trace = await page.evaluate(() => {
      clearInterval(boostSampler);
      const square = document.querySelector('#bsq-7');
      return { ...boostTrace, rect: square.getBoundingClientRect().toJSON(),
        committed: window.__spine.activeGame.session.state.bonusSqUsed[7],
        ancestors: [square, square.parentElement, square.parentElement.parentElement].map(el => ({
          id: el.id, overflow: getComputedStyle(el).overflow, zIndex: getComputedStyle(el).zIndex,
        })),
      };
    });
    fs.writeFileSync(testInfo.outputPath('trace.json'), JSON.stringify(trace, null, 2));
    const activation = trace.events.find(e => e.name === 'evt/BOOST_ACTIVATED' || e.name === 'bonus/pending');
    const ready = trace.events.find(e => e.name === 'boost/result-ready');
    expect(activation).toBeTruthy();
    expect(activation.payload.slot).toBe(scenario.botMove ? 1 : 0);
    expect(trace.committed).toBe(true);
    expect(ready).toBeTruthy();
    const lit = trace.frames.filter(f => f.active);
    expect(lit.length).toBeGreaterThan(5);
    expect(lit.every(f => f.letter === 'ש' && f.squareOpacity === '1' && f.glow !== 'none' && f.filter === 'none')).toBe(true);
    if (scenario.reduced) {
      expect(ready.at - activation.at).toBeLessThan(40);
      expect(lit.every(f => f.core === 'none' && f.sparks === 'none' && f.transform === 'none')).toBe(true);
    } else {
      expect(ready.at - activation.at).toBeGreaterThanOrEqual(400);
      expect(ready.at - activation.at).toBeLessThan(520);
      const lead = lit.filter(f => f.at < ready.at);
      expect(lead.length).toBeGreaterThan(12);
      expect(lead.every(f => !f.result && !f.badge && !f.banner && f.opacity >= .8)).toBe(true);
      expect(new Set(lead.map(f => f.transform)).size).toBeGreaterThan(2);
      expect(lead.every(f => f.core === 'boostElectricCore')).toBe(true);
    }
    if (scenario.type === 'B6') expect(trace.frames.some(f => f.result && f.badge && f.banner)).toBe(true);
    expect(trace.frames.at(-1).active).toBe(false);
    // Required result remains usable and finalizes the genuine award.
    if (scenario.type !== 'B1' && scenario.type !== 'B13') {
      await page.locator('[data-bonus-ok]').click();
      await expect(result).toHaveCount(0);
      expect(await page.evaluate(() => window.__spine.activeGame.session.state.pendingScoreCommit)).toBeFalsy();
    } else {
      await page.locator('#ov-bonus-intro button').click();
      await expect(result).toHaveClass(/hidden/);
      await expect(result).toHaveCSS('opacity', '0');
      await page.waitForTimeout(500);
    }
  });
}
