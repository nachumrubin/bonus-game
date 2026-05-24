const { test, expect } = require('@playwright/test');

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true &&
    typeof window.__spine.bootOffline2P === 'function' &&
    !!window.document.querySelector('#sh .hbtns')
  );
  await expect(page.locator('#sh')).toBeVisible();
}

async function resetHome(page) {
  await page.evaluate(() => {
    window.document.getElementById('ov-champs')?.classList.add('hidden');
    window.document.getElementById('ov-settings')?.classList.add('hidden');
    window.document.getElementById('tut-intro')?.classList.add('hidden');
    window.showSc?.('sh');
  });
  await expect(page.locator('#sh')).toBeVisible();
}

function visibleMenuButton(page, index) {
  return page.locator('#sh .hbtns > button:visible').nth(index);
}

test.describe('home menu routing', () => {
  test('visible home menu buttons open the expected screens and overlays', async ({ page }) => {
    await bootSpine(page);

    await expect(page.locator('#sh .hbtns > button:visible')).toHaveCount(7);

    await visibleMenuButton(page, 0).click();
    await expect(page.locator('#sauth-signup')).toBeVisible();
    await page.locator('#su-submit-btn').click();
    await expect(page.locator('#su-error')).not.toBeEmpty();
    await resetHome(page);

    await visibleMenuButton(page, 1).click();
    await expect(page.locator('#ss')).toBeVisible();
    await expect(page.locator('#p2f')).toBeVisible();
    await expect(page.locator('#dff')).toBeHidden();
    await resetHome(page);

    await visibleMenuButton(page, 2).click();
    await expect(page.locator('#ss')).toBeVisible();
    await expect(page.locator('#p2f')).toBeHidden();
    await expect(page.locator('#dff')).toBeVisible();
    await resetHome(page);

    await visibleMenuButton(page, 3).click();
    await expect(page.locator('#so')).toBeVisible();
    await resetHome(page);

    await visibleMenuButton(page, 4).click();
    await expect(page.locator('#tut-intro')).toBeVisible();
    await resetHome(page);

    await visibleMenuButton(page, 5).click();
    await expect(page.locator('#ov-champs')).toBeVisible();
    await expect(page.locator('#ov-champs .ovt')).toContainText('טבלת דירוגים');
    await resetHome(page);

    await visibleMenuButton(page, 6).click();
    await expect(page.locator('#ov-settings')).toBeVisible();
  });
});
