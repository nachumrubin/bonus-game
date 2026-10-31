const { test, expect } = require('@playwright/test');

// Home routing for the current home layout: three mode cards (online / vs
// bot / two players) and the top bar (profile, settings gear, `?` help menu).
// The bottom nav only shows for signed-in players, so it isn't covered here.

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true && !!document.querySelector('#btn-online-lobby'));
  // The static test server never finishes Firebase connect, so the boot
  // splash stays up over the home screen.
  await page.addStyleTag({ content: '#ov-onboarding,#app-loading{display:none!important}' });
  await expect(page.locator('#sh')).toBeVisible();
}

async function resetHome(page) {
  await page.evaluate(() => {
    for (const id of ['ov-settings', 'tut-intro', 'em-help-dropdown', 'ov-guest-upgrade']) {
      window.document.getElementById(id)?.classList.add('hidden');
    }
    window.showSc?.('sh');
  });
  await expect(page.locator('#sh')).toBeVisible();
}

test.describe('home menu routing', () => {
  test('home cards and top-bar buttons open the expected screens and overlays', async ({ page }) => {
    await bootSpine(page);

    // Online play needs an account: guests get the sign-up prompt, not the lobby.
    await page.locator('#btn-online-lobby').click();
    await expect(page.locator('#ov-guest-upgrade')).toBeVisible();
    await expect(page.locator('#so')).toBeHidden();
    await resetHome(page);

    await page.locator('.hm-card--bot').click();
    await expect(page.locator('#ss')).toBeVisible();
    await expect(page.locator('#stitle-icon-bot')).toBeVisible();
    await expect(page.locator('#ss-racks-row')).toBeHidden();
    await resetHome(page);

    await page.locator('.hm-card--2p').click();
    await expect(page.locator('#ss')).toBeVisible();
    await expect(page.locator('#stitle-icon-vs')).toBeVisible();
    await expect(page.locator('#ss-racks-row')).toBeVisible();
    await resetHome(page);

    // Guests land on the login screen from the profile button.
    await page.locator('#btn-profile-home').click();
    await expect(page.locator('#sauth-login')).toBeVisible();
    await resetHome(page);

    await page.locator('#topbar-help-btn').click();
    await expect(page.locator('#em-help-dropdown')).toBeVisible();
    await page.locator('.em-help-dropdown-item[data-action="tutorial"]').click();
    await expect(page.locator('#tut-intro')).toBeVisible();
    await resetHome(page);

    await page.locator('.em-icon-btn:has(svg[aria-label="הגדרות"])').click();
    await expect(page.locator('#ov-settings')).toBeVisible();
  });
});
