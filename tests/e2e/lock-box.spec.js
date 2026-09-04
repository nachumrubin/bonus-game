const { test, expect } = require('@playwright/test');

// Regression guard for a bug the unit tests structurally cannot catch.
//
// The lock picker (#lock-inv-display) lives inside `.right-panel`, which the
// retired side-panel layout hides with `display:none !important`. The
// stub-DOM unit tests render into a synthetic root with no such CSS, so they
// happily "clicked" a button that is invisible and zero-sized in the real app.
// When locks stopped being auto-placed by tapping an empty cell, that left NO
// reachable way to place a lock. These tests assert the lock box the player
// actually sees — the `is-pclocks` strip in their info-strip score card — is
// on screen and usable.

async function bootGame(page) {
  // Other specs in this suite leave saved games / onboarding flags behind in
  // localStorage, which changes the boot path. Start from a clean slate.
  await page.goto('/');
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true && typeof window.__spine.bootOffline2P === 'function');
  await page.evaluate(async () => { window.__spine.bootOffline2P(); await Promise.resolve(); });
  // Skip the coin-toss splash (its enter button is enabled by an animation timer).
  await page.evaluate(() => {
    const b = document.querySelector('#coin-enter');
    if (b) { b.disabled = false; b.click(); }
  });
  // Boot splash + first-run onboarding overlay are not part of these tests.
  await dismissChrome(page);
  await expect(page.locator('#is-locks-1')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400); // let the screen transition finish
  await dismissChrome(page);
}

function dismissChrome(page) {
  return page.evaluate(() => {
    for (const sel of ['#app-loading', '#ov-onboarding']) {
      const el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    }
  });
}

async function setScore(page, points) {
  await page.evaluate((p) => {
    const ag = window.__spine.activeGame;
    ag.session.state.scores[0] = p;
    window.__spine.bus.emit('evt/SCORE_CHANGED', { slot: 0, score: p });
  }, points);
  // The panel counts UP to the new value on a delay. Wait for it to settle, or
  // a test that reads the displayed score races the in-flight count-up.
  await expect(page.locator('#is-sv1')).toHaveText(String(points));
}

test('lock box is visible and hit-testable in the real layout', async ({ page }) => {
  await bootGame(page);
  await setScore(page, 50);

  const buttons = page.locator('#is-locks-1 button');
  await expect(buttons).toHaveCount(3); // LEGACY_LOCK_INVENTORY = [3, 3, 5]

  // The button must genuinely be the element under its own centre point —
  // a zero-sized or covered button would fail here even though it "exists".
  const hit = await page.evaluate(() => {
    const btn = document.querySelector('#is-locks-1 button');
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { w: r.width, h: r.height, isTop: top === btn };
  });
  expect(hit.w).toBeGreaterThan(0);
  expect(hit.h).toBeGreaterThan(0);
  expect(hit.isTop).toBe(true);
});

test('picking a lock then a square previews it, and it leaves the box', async ({ page }) => {
  await bootGame(page);
  await setScore(page, 50);

  await page.locator('#is-locks-1 button').first().click();
  await expect(page.locator('#is-locks-1 button.active')).toHaveCount(1);

  await page.locator('#c4_4').click();
  const pending = await page.evaluate(() =>
    window.__spine.activeGame?.controller?.view?.pendingLock);
  expect(pending).toMatchObject({ r: 4, c: 4, duration: 3 });

  // The placed lock left the box.
  await expect(page.locator('#is-locks-1 button')).toHaveCount(2);
  await expect(page.locator('#c4_4')).toHaveClass(/spine-pending-lock-cell/);
});

// Both score cards must show real bordered lock chips at all times. The
// non-acting player's used to degrade to a plain "🔒3 🔒3 🔒5" text summary,
// so in hot-seat/bot play a card visibly lost its lock frames the moment the
// turn passed to the other side.
test('both players keep bordered lock chips, including across a turn flip', async ({ page }) => {
  await bootGame(page);
  await setScore(page, 50);

  const borderOf = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { width: cs.borderTopWidth, style: cs.borderTopStyle };
  }, sel);

  // Slot 0 is to move: both cards should hold chips, both bordered.
  await expect(page.locator('#is-locks-1 button')).toHaveCount(3);
  await expect(page.locator('#is-locks-2 button')).toHaveCount(3);
  expect(await borderOf('#is-locks-1 button')).toMatchObject({ style: 'solid' });
  expect(await borderOf('#is-locks-2 button')).toMatchObject({ style: 'solid' });

  // The opponent's chips are inert, not clickable.
  await expect(page.locator('#is-locks-2 button').first()).toBeDisabled();

  // Flip the turn — the previously-acting card must KEEP its borders.
  await page.evaluate(() => {
    const ag = window.__spine.activeGame;
    ag.session.state.currentTurnSlot = 1;
    window.__spine.bus.emit('evt/TURN_CHANGED', { currentTurnSlot: 1, turnNumber: 2 });
  });
  await expect(page.locator('#is-locks-1 button')).toHaveCount(3);
  await expect(page.locator('#is-locks-2 button')).toHaveCount(3);
  expect(await borderOf('#is-locks-1 button')).toMatchObject({ style: 'solid' });
  expect(await borderOf('#is-locks-2 button')).toMatchObject({ style: 'solid' });
});

// The 10-point lock charge must be visible BEFORE the player commits (so it
// can change their mind) and unmissable when it lands.
test('lock cost is previewed while pending, without touching the real score', async ({ page }) => {
  await bootGame(page);
  await setScore(page, 20);

  await page.locator('#is-locks-1 button').first().click();
  await page.locator('#c4_4').click();

  // Price tag rides on the lock itself, and the owner's card previews the cost.
  await expect(page.locator('#c4_4 .spine-lock-cost')).toHaveText('−10');
  await expect(page.locator('#is-cost-1')).toHaveClass(/is-visible/);
  await expect(page.locator('#is-cost-1')).toHaveText('−10');
  // Both render LTR so the sign stays in front of the number in the RTL layout.
  for (const sel of ['#c4_4 .spine-lock-cost', '#is-cost-1']) {
    expect(await page.locator(sel).evaluate(el => getComputedStyle(el).direction)).toBe('ltr');
  }

  // Crucially the engine score is NOT charged yet — the lock is still movable.
  expect(await page.evaluate(() => window.__spine.activeGame.session.state.scores[0])).toBe(20);
  await expect(page.locator('#is-sv1')).toHaveText('20');
});

test('returning a pending lock to the box clears the cost preview and charges nothing', async ({ page }) => {
  await bootGame(page);
  await setScore(page, 20);

  await page.locator('#is-locks-1 button').first().click();
  await page.locator('#c4_4').click();
  await expect(page.locator('#is-cost-1')).toHaveClass(/is-visible/);

  await page.locator('#c4_4').click(); // select
  await page.locator('#c4_4').click(); // return to box

  await expect(page.locator('#is-cost-1')).not.toHaveClass(/is-visible/);
  expect(await page.evaluate(() => window.__spine.activeGame.session.state.scores[0])).toBe(20);
});

test('committing a lock flies a −10 into the score and counts it down', async ({ page }) => {
  await bootGame(page);
  await setScore(page, 20);

  await page.locator('#is-locks-1 button').first().click();
  await page.locator('#c4_4').click();
  await page.locator('#btn-play').click();

  // Mid-flight snapshot. Taken as ONE synchronous read rather than an
  // auto-retrying matcher: those poll until after the ~520ms flight has landed,
  // by which point the count-down has already run and the held value is gone.
  const midFlight = await page.evaluate(() => ({
    chip: document.querySelector('.lock-cost-chip')?.textContent ?? null,
    shown: document.querySelector('#is-sv1')?.textContent,
    charged: window.__spine.activeGame.session.state.scores[0],
  }));
  expect(midFlight.chip).toBe('−10');
  // The engine has already charged, but the panel holds the old number until
  // the chip arrives, so the number and the chip land together.
  expect(midFlight.charged).toBe(10);
  expect(midFlight.shown).toBe('20');

  // Settled: chip gone, score counted down to the real charged value.
  await expect(page.locator('.lock-cost-chip')).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('#is-sv1')).toHaveText('10');
  expect(await page.evaluate(() => window.__spine.activeGame.session.state.scores[0])).toBe(10);
  await expect(page.locator('#is-cost-1')).not.toHaveClass(/is-visible/);
});

test('locks are greyed out and inert when the player cannot afford one', async ({ page }) => {
  await bootGame(page);
  await setScore(page, 4); // fewer than the 10-point cost

  const box = page.locator('#is-locks-1');
  await expect(box).toHaveClass(/is-disabled/);
  const buttons = box.locator('button');
  await expect(buttons.first()).toBeDisabled();

  // Greyed means visually greyed, not just non-functional.
  const opacity = await box.evaluate(el => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBeLessThan(1);
});
