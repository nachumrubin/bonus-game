const { test, expect } = require('@playwright/test');

async function boot(page, reduced = false) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.goto('/');
  await page.waitForFunction(() => window.__spine?.enabled && window.__spine?.bus);
  await page.addStyleTag({ content: '#ov-onboarding,#app-loading{display:none!important}' });
  await page.evaluate(() => window.__spine.bootOffline2P());
  await expect(page.locator('#sg')).toBeVisible();
  await page.evaluate(() => { window.__spine.activeGame.session.mySlot = 0; });
}

const resultPayload = (winnerSlot, scores) => ({
  winnerSlot,
  scores,
  players: { 0: { displayName: 'נועה' }, 1: { displayName: 'דן' } },
});

test('reward motion establishes distinct hierarchy and does not replay', async ({ page }, testInfo) => {
  await boot(page);

  const victory = await page.evaluate((payload) => {
    const { bus } = window.__spine;
    bus.emit('overlay/end/open', payload);
    bus.emit('overlay/end/open', payload);
    const overlay = document.getElementById('ov-end');
    return {
      outcome: overlay.dataset.outcome,
      cardAnimation: getComputedStyle(overlay.querySelector('.end-ovc')).animationName,
      trophyAnimation: getComputedStyle(overlay.querySelector('.end-trophy-img')).animationName,
      confetti: overlay.querySelectorAll('.bz-confetti-piece').length,
    };
  }, resultPayload(0, { 0: 82, 1: 51 }));
  expect(victory).toEqual({
    outcome: 'victory',
    cardAnimation: 'endVictoryCardIn',
    trophyAnimation: 'endVictoryTrophy',
    confetti: 42,
  });
  await page.waitForTimeout(90);
  await page.screenshot({ path: testInfo.outputPath('victory-90ms.png'), fullPage: true });
  await page.waitForTimeout(560);
  await page.screenshot({ path: testInfo.outputPath('victory-650ms.png'), fullPage: true });

  await page.evaluate(() => {
    window.__spine.bus.emit('evt/GAME_STARTED', {});
    window.__spine.bus.emit('overlay/end/open', { winnerSlot: null, scores: { 0: 44, 1: 44 } });
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: testInfo.outputPath('draw-120ms.png'), fullPage: true });
  await page.evaluate(() => {
    window.__spine.bus.emit('evt/GAME_STARTED', {});
    window.__spine.bus.emit('overlay/end/open', { winnerSlot: 1, scores: { 0: 32, 1: 61 } });
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: testInfo.outputPath('defeat-120ms.png'), fullPage: true });

  const outcomes = await page.evaluate(async () => {
    const { bus } = window.__spine;
    const overlay = document.getElementById('ov-end');
    const result = {};
    bus.emit('evt/GAME_STARTED', {});
    bus.emit('overlay/end/open', { winnerSlot: null, scores: { 0: 44, 1: 44 } });
    result.draw = {
      outcome: overlay.dataset.outcome,
      animation: getComputedStyle(overlay.querySelector('.end-ovc')).animationName,
      confetti: overlay.querySelectorAll('.bz-confetti').length,
    };
    bus.emit('evt/GAME_STARTED', {});
    bus.emit('overlay/end/open', { winnerSlot: 1, scores: { 0: 32, 1: 61 } });
    result.defeat = {
      outcome: overlay.dataset.outcome,
      animation: getComputedStyle(overlay.querySelector('.end-ovc')).animationName,
      confetti: overlay.querySelectorAll('.bz-confetti').length,
    };
    bus.emit('rating/changed', { myBefore: 1000, myAfter: 1012, oppBefore: 1000, oppAfter: 988 });
    await new Promise(resolve => setTimeout(resolve, 460));
    result.eloGain = document.getElementById('elo-delta-1').textContent;
    result.eloLoss = document.getElementById('elo-delta-2').textContent;
    result.eloGainAnimation = getComputedStyle(document.getElementById('elo-delta-1')).animationName;
    result.eloLossAnimation = getComputedStyle(document.getElementById('elo-delta-2')).animationName;
    return result;
  });
  expect(outcomes.draw).toEqual({ outcome: 'draw', animation: 'endDrawIn', confetti: 0 });
  expect(outcomes.defeat).toEqual({ outcome: 'defeat', animation: 'endDefeatIn', confetti: 0 });
  expect(outcomes.eloGain).toMatch(/1012.*\+12/);
  expect(outcomes.eloLoss).toMatch(/988.*-12/);
  expect(outcomes.eloGainAnimation).toBe('eloGainReveal');
  expect(outcomes.eloLossAnimation).toBe('eloLossReveal');

  const achievement = await page.evaluate(() => {
    const { bus } = window.__spine;
    const payload = { achievement: { id: 'runtime-win', titleHe: 'אלוף', descHe: 'ניצחת משחק', emoji: '🏆' }, coins: 250 };
    bus.emit('avatar/unlockOpen', payload);
    const overlay = document.getElementById('ov-avatar-unlocked');
    const first = getComputedStyle(document.getElementById('av-unlock-ic')).animationName;
    bus.emit('avatar/unlockOpen', payload);
    return {
      visible: !overlay.classList.contains('hidden'),
      state: overlay.classList.contains('achievement-unlock-state'),
      first,
      afterDuplicate: getComputedStyle(document.getElementById('av-unlock-ic')).animationName,
      name: document.getElementById('av-unlock-name').textContent,
    };
  });
  expect(achievement).toMatchObject({ visible: true, state: true, first: 'achievementIconUnlock', afterDuplicate: 'achievementIconUnlock', name: 'אלוף' });
  await page.waitForTimeout(380);
  await page.screenshot({ path: testInfo.outputPath('achievement-380ms.png'), fullPage: true });
});

test('reduced motion preserves every reward result as a static state', async ({ page }) => {
  await boot(page, true);
  const reduced = await page.evaluate(() => {
    const { bus } = window.__spine;
    bus.emit('overlay/end/open', { winnerSlot: 0, scores: { 0: 70, 1: 40 }, players: { 0: { displayName: 'נועה' }, 1: { displayName: 'דן' } } });
    bus.emit('rating/changed', { myBefore: 1000, myAfter: 1014, oppBefore: 1000, oppAfter: 986 });
    bus.emit('avatar/unlockOpen', { achievement: { id: 'rm-ach', titleHe: 'אלוף', descHe: 'הושלם', emoji: '🏆' }, coins: 100 });
    const end = document.getElementById('ov-end');
    const unlock = document.getElementById('ov-avatar-unlocked');
    return {
      outcome: end.dataset.outcome,
      resultVisible: !end.classList.contains('hidden') && document.getElementById('wn').textContent.length > 0,
      confetti: end.querySelectorAll('.bz-confetti').length,
      trophyAnimation: getComputedStyle(end.querySelector('.end-trophy-img')).animationName,
      elo: document.getElementById('elo-delta-1').textContent,
      achievementVisible: !unlock.classList.contains('hidden'),
      achievementAnimation: getComputedStyle(document.getElementById('av-unlock-ic')).animationName,
      achievementOutline: getComputedStyle(document.getElementById('av-unlock-ic')).outlineStyle,
    };
  });
  expect(reduced).toMatchObject({
    outcome: 'victory', resultVisible: true, confetti: 0, trophyAnimation: 'none',
    achievementVisible: true, achievementAnimation: 'none', achievementOutline: 'solid',
  });
  expect(reduced.elo).toMatch(/1014.*\+14/);
});
