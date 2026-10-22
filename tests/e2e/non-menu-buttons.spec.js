const { test, expect } = require('@playwright/test');

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true &&
    typeof window.__spine.bootOffline2P === 'function' &&
    !!window.document.querySelector('#btn-online-lobby')
  );
  // The static test server never finishes Firebase connect, so the boot
  // splash stays up over the home screen.
  await page.addStyleTag({ content: '#ov-onboarding,#app-loading{display:none!important}' });
}

async function emit(page, eventKey, payload = {}) {
  await page.evaluate(({ eventKey, payload }) => {
    window.__spine.bus.emit(window.__spine.ui[eventKey], payload);
  }, { eventKey, payload });
}

async function showScreen(page, id) {
  await page.evaluate((screenId) => window.showSc?.(screenId), id);
  await expect(page.locator(`#${id}`)).toBeVisible();
}

async function enterCoinToss(page) {
  await expect(page.locator('#scoin')).toBeVisible();
  await expect(page.locator('#coin-enter')).toBeEnabled({ timeout: 3000 });
  await page.locator('#coin-enter').click();
}

async function expectNoPageErrors(errors) {
  expect(errors).toEqual([]);
}

test.describe('non-menu button wiring', () => {
  test('auth, profile, setup, online, tutorial, settings, and game controls are wired', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await bootSpine(page);

    // Auth screen buttons: submit validation, switch login/signup, guest return.
    await showScreen(page, 'sauth-signup');
    await page.locator('#su-submit-btn').click();
    await expect(page.locator('#su-error')).not.toBeEmpty();
    await page.locator('#sauth-signup button', { hasText: 'יש לי חשבון' }).click();
    await expect(page.locator('#sauth-login')).toBeVisible();
    await page.locator('#sauth-login button', { hasText: 'חשבון חדש' }).click();
    await expect(page.locator('#sauth-signup')).toBeVisible();
    await page.locator('#sauth-signup button', { hasText: 'המשך כאורח' }).click();
    await expect(page.locator('#sh')).toBeVisible();

    // Profile/player buttons and profile-owned legacy sub-screens.
    await showScreen(page, 'sprofile');
    await emit(page, 'PROFILE_RENDER', {
      profile: {
        displayName: 'Tester',
        equippedAvatar: 'star',
        userId: 'ABC123',
        stats: { gamesPlayed: 35, gamesWon: 15, highScore: 564, longestStreak: 3, currentStreak: 1 },
      },
      isAnonymous: false,
      email: 'tester@example.test',
    });
    await page.locator('#profile-name-display').click();
    await expect(page.locator('#profile-name-edit')).toBeVisible();
    await page.locator('#profile-name-edit button', { hasText: 'ביטול' }).click();
    await expect(page.locator('#profile-name-edit')).toBeHidden();

    // Avatar tap → avatar store; a guest is offered the account upgrade first.
    await page.locator('#sprofile .pf-g-av').click();
    await expect(page.locator('#ov-guest-upgrade')).toBeVisible();
    await page.locator('#ov-guest-upgrade button', { hasText: 'לא עכשיו' }).click();
    await expect(page.locator('#ov-guest-upgrade')).toBeHidden();

    await showScreen(page, 'sprofile');
    await page.locator('#sprofile .g-li', { hasText: 'חברים' }).click();
    await expect(page.locator('#sfriends')).toBeVisible();
    await emit(page, 'FRIENDS_RENDER', { myUserId: 'ABC123', friends: [], requests: [] });
    await page.locator('#add-friend-input').fill('ZZ9999');
    await page.locator('#sfriends button[aria-label="הוסף חבר"]').click();
    await page.locator('#sfriends .g-chip[aria-label="חזרה לפרופיל"]').click();
    await expect(page.locator('#sprofile')).toBeVisible();

    await page.locator('#sprofile .g-li', { hasText: 'סטטיסטיקות' }).click();
    await expect(page.locator('#sstats')).toBeVisible();
    // Collapsible sections: the share button lives in the records section.
    await page.locator('.st-section-header[data-section="achievements"]').click();
    await expect(page.locator('#st-sec-achievements')).toHaveClass(/open/);
    await page.locator('.stats-share-btn').click();

    await showScreen(page, 'sprofile');
    await page.locator('#sprofile .g-chip[aria-label="חזרה"]').click();
    await expect(page.locator('#sh')).toBeVisible();

    // Setup screen: difficulty, back, and play.
    await page.locator('.hm-card--bot').click();
    await expect(page.locator('#ss')).toBeVisible();
    const difficulty = page.locator('#ss .mf-opt-card', { hasText: 'קשה' });
    await difficulty.click();
    await expect(difficulty).toHaveClass(/(^|\s)a(\s|$)/);
    await page.locator('#ss .g-chip[aria-label="חזרה"]').click();
    await expect(page.locator('#sh')).toBeVisible();

    await page.locator('.hm-card--2p').click();
    await page.locator('#ss .mf-cta').click();
    await enterCoinToss(page);
    await expect(page.locator('#sg')).toBeVisible();

    // In-game controls and their overlays.
    // ☰ opens the in-game dropdown; settings and finish/pause live in it.
    await page.locator('#btn-game-menu').click();
    await expect(page.locator('#gm-menu')).toHaveClass(/open/);
    await page.locator('#gm-menu button', { hasText: 'הגדרות' }).click();
    await expect(page.locator('#ov-settings')).toBeVisible();
    await page.locator('#sett-close-x').click();
    await expect(page.locator('#ov-settings')).toHaveClass(/hidden/);

    await page.locator('#btn-game-menu').click();
    await page.locator('#gm-menu button', { hasText: 'סיים' }).click();
    await expect(page.locator('#ov-back-confirm')).toBeVisible();
    await page.locator('#ov-back-confirm .pause-action--primary').click();
    await expect(page.locator('#ov-back-confirm')).toHaveClass(/hidden/);

    await page.locator('#btn-exchange').click();
    await expect(page.locator('#ov-exch')).toBeVisible();
    await page.locator('#ov-exch button').filter({ hasText: 'ביטול' }).click();
    await expect(page.locator('#ov-exch')).toHaveClass(/hidden/);

    await page.locator('#btn-shailta').click();
    await expect(page.locator('#ov-shailta')).toBeVisible();
    await page.locator('#ov-shailta button').filter({ hasText: 'סגור' }).click();
    await expect(page.locator('#ov-shailta')).toHaveClass(/hidden/);

    // Online lobby mode cards and their overlays.
    await showScreen(page, 'so');
    const modeCard = (i) => page.locator('#so .g-card.g-mode').nth(i);
    await modeCard(1).click();
    await expect(page.locator('#ov-create-room')).toBeVisible();
    await page.locator('#cr-mode-async').click();
    await expect(page.locator('#cr-mode-async')).toHaveClass(/active/);
    await page.evaluate(() => window.ovClose?.('ov-create-room') ?? document.getElementById('ov-create-room').classList.add('hidden'));

    await modeCard(2).click();
    await expect(page.locator('#ov-join-code')).toBeVisible();
    await page.locator('#ov-join-code button').filter({ hasText: 'הצטרף' }).click();
    await expect(page.locator('#jc-error')).not.toBeEmpty();
    await page.evaluate(() => window.ovClose?.('ov-join-code') ?? document.getElementById('ov-join-code').classList.add('hidden'));

    await modeCard(0).click();
    await expect(page.locator('#ov-matchmaking')).toBeVisible();
    await page.locator('#mm-mode-async').click();
    await expect(page.locator('#mm-mode-async')).toHaveClass(/active/);
    await page.evaluate(() => window.ovClose?.('ov-matchmaking') ?? document.getElementById('ov-matchmaking').classList.add('hidden'));

    await showScreen(page, 'so');
    await page.locator('#so .g-chip[aria-label="חזרה"]').click();
    await expect(page.locator('#sh')).toBeVisible();

    // Tutorial intro buttons.
    await emit(page, 'TUTORIAL_OPEN');
    await expect(page.locator('#tut-intro')).toBeVisible();
    await page.locator('#tut-intro-back').click();
    await expect(page.locator('#tut-intro')).toHaveClass(/hidden/);

    await expectNoPageErrors(pageErrors);
  });
});
