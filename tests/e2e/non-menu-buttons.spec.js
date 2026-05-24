const { test, expect } = require('@playwright/test');

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true &&
    typeof window.__spine.bootOffline2P === 'function' &&
    !!window.document.querySelector('#sh .hbtns')
  );
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
    await page.locator('#sauth-signup button').nth(1).click();
    await expect(page.locator('#sauth-login')).toBeVisible();
    await page.locator('#sauth-login button').nth(2).click();
    await expect(page.locator('#sauth-signup')).toBeVisible();
    await page.locator('#sauth-signup button').nth(2).click();
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
    await page.locator('#profile-name-edit button').nth(1).click();
    await expect(page.locator('#profile-name-edit')).toBeHidden();

    await page.locator('#profile-avatar-display').click();
    await expect(page.locator('#sav-gallery')).toBeVisible();
    await page.locator('#sav-gallery button').first().click();
    await expect(page.locator('#sprofile')).toBeVisible();

    const profileButtons = () => page.locator('#sprofile > .sbox > button:visible');
    await profileButtons().nth(0).click();
    await expect(page.locator('#sfriends')).toBeVisible();
    await emit(page, 'FRIENDS_RENDER', { myUserId: 'ABC123', friends: [], requests: [] });
    await page.locator('#fr-my-id').click();
    await page.locator('#add-friend-input').fill('ZZ9999');
    await page.locator('#sfriends button:visible').first().click();
    await page.locator('#sfriends > .sbox > button:visible').last().click();
    await expect(page.locator('#sprofile')).toBeVisible();

    await profileButtons().nth(1).click();
    await expect(page.locator('#sav-gallery')).toBeVisible();
    await page.locator('#sav-gallery button').first().click();
    await expect(page.locator('#sprofile')).toBeVisible();

    await profileButtons().nth(2).click();
    await expect(page.locator('#sstats')).toBeVisible();
    await expect(page.locator('#st-played')).toHaveText('35');
    await expect(page.locator('#st-highscore')).toHaveText('564');
    await page.locator('.stats-tfseg').nth(0).click();
    await expect(page.locator('.stats-tfseg').nth(0)).toHaveClass(/active/);
    await page.locator('.stats-tab').nth(1).click();
    await expect(page.locator('#st-panel-performance')).toHaveClass(/active/);
    await page.locator('#sstats .stats-topbar button').nth(1).click();
    await page.locator('.stats-tab').nth(4).click();
    await expect(page.locator('#st-panel-fun')).toHaveClass(/active/);
    await page.locator('.stats-share-btn').click();
    await page.locator('#sstats .stats-topbar button').nth(0).click();
    await expect(page.locator('#sprofile')).toBeVisible();

    await profileButtons().nth(4).click();
    await expect(page.locator('#sh')).toBeVisible();

    // Setup screen buttons: difficulty, back, and play.
    await showScreen(page, 'ss');
    await emit(page, 'SETUP_OPEN', { mode: 'bot', initialDifficulty: 1 });
    await expect(page.locator('#dff')).toBeVisible();
    await page.locator('#dff button').nth(2).click();
    await expect(page.locator('#dff button').nth(2)).toHaveClass(/a/);
    await page.locator('#ss button').filter({ hasText: 'חזרה' }).click();
    await expect(page.locator('#sh')).toBeVisible();

    await showScreen(page, 'ss');
    await emit(page, 'SETUP_OPEN', { mode: 'vs', initialDifficulty: 1 });
    await page.locator('#ss button').filter({ hasText: 'שחק' }).click();
    await enterCoinToss(page);
    await expect(page.locator('#sg')).toBeVisible();

    // In-game toolbar and overlay controls.
    await page.locator('#sg .tbar button:visible').nth(0).click();
    await expect(page.locator('#ov-settings')).toBeVisible();
    await page.locator('#ov-settings button').filter({ hasText: 'אישור' }).click();
    await expect(page.locator('#ov-settings')).toHaveClass(/hidden/);

    await page.locator('#btn-exchange').click();
    await expect(page.locator('#ov-exch')).toBeVisible();
    await page.locator('#ov-exch button').filter({ hasText: 'ביטול' }).click();
    await expect(page.locator('#ov-exch')).toHaveClass(/hidden/);

    await page.locator('#sg .tbar button:visible').nth(2).click();
    await expect(page.locator('#ov-shailta')).toBeVisible();
    await page.locator('#ov-shailta button').filter({ hasText: 'סגור' }).click();
    await expect(page.locator('#ov-shailta')).toHaveClass(/hidden/);

    await page.locator('#sg .tbar button:visible').nth(3).click();
    await expect(page.locator('#ov-back-confirm')).toBeVisible();
    await page.locator('#ov-back-confirm button').filter({ hasText: 'המשך' }).click();
    await expect(page.locator('#ov-back-confirm')).toHaveClass(/hidden/);

    // Online lobby sub-buttons and their overlays.
    await showScreen(page, 'so');
    await page.locator('#so .omode-btn').nth(0).click();
    await expect(page.locator('#ov-create-room')).toBeVisible();
    await page.locator('#cr-mode-async').click();
    await expect(page.locator('#cr-mode-async')).toHaveClass(/active/);
    await page.locator('#ov-create-room button').filter({ hasText: 'ביטול' }).click();
    await expect(page.locator('#ov-create-room')).toHaveClass(/hidden/);

    await page.locator('#so .omode-btn').nth(1).click();
    await expect(page.locator('#ov-join-code')).toBeVisible();
    await page.locator('#ov-join-code button').filter({ hasText: 'הצטרף' }).click();
    await expect(page.locator('#jc-error')).not.toBeEmpty();
    await page.locator('#ov-join-code button').filter({ hasText: 'ביטול' }).click();
    await expect(page.locator('#ov-join-code')).toHaveClass(/hidden/);

    await page.locator('#so .omode-btn').nth(2).click();
    await expect(page.locator('#ov-matchmaking')).toBeVisible();
    await page.locator('#mm-mode-async').click();
    await expect(page.locator('#mm-mode-async')).toHaveClass(/active/);
    await page.locator('#mm-rr-200').click();
    await expect(page.locator('#mm-rr-200')).toHaveClass(/active/);
    await page.locator('#ov-matchmaking button').filter({ hasText: 'ביטול' }).click();
    await expect(page.locator('#ov-matchmaking')).toHaveClass(/hidden/);

    await page.locator('#so button').filter({ hasText: 'חזרה' }).click();
    await expect(page.locator('#sh')).toBeVisible();

    // Tutorial intro buttons.
    await emit(page, 'TUTORIAL_OPEN');
    await expect(page.locator('#tut-intro')).toBeVisible();
    await page.locator('#tut-intro-back').click();
    await expect(page.locator('#tut-intro')).toHaveClass(/hidden/);

    await expectNoPageErrors(pageErrors);
  });
});
