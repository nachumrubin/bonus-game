const { test, expect } = require('@playwright/test');

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true &&
    typeof window.__spine.bootOffline2P === 'function' &&
    typeof window.__spine.startOnlineGameViaSpine === 'function'
  );
}

async function waitForMountedScreens(page) {
  await page.waitForFunction(() =>
    window.__spine?.menu &&
    window.__spine.setup &&
    window.__spine.settingsScreen &&
    window.__spine.gameFlowController
  );
}

async function bootOffline2P(page) {
  await bootSpine(page);
  await page.evaluate(async () => {
    window.__spine.bootOffline2P();
    await Promise.resolve();
  });
  await expectActiveGame(page, { mode: 'offline-2p', rack0: 8, rack1: 8 });
}

async function enterCoinToss(page) {
  await expect(page.locator('#scoin')).toBeVisible();
  await expect(page.locator('#coin-enter')).toBeEnabled({ timeout: 3000 });
  await page.locator('#coin-enter').click();
}

async function readActiveGame(page) {
  return page.evaluate(() => {
    const ag = window.__spine?.activeGame;
    const state = ag?.session?.state;
    return {
      enabled: window.__spine?.enabled === true,
      hasActiveGame: !!ag,
      online: !!ag?.online,
      isAsync: !!ag?.isAsync,
      mode: state?.mode,
      roomId: ag?.session?.roomId ?? null,
      mySlot: ag?.session?.mySlot ?? null,
      currentTurnSlot: state?.currentTurnSlot,
      turnNumber: state?.turnNumber,
      rack0: state?.racks?.[0]?.length,
      rack1: state?.racks?.[1]?.length,
      bagRemaining: state?.bag?.length,
      settings: state?.settings ? { ...state.settings } : null,
    };
  });
}

async function expectActiveGame(page, expected) {
  await expect.poll(() => readActiveGame(page)).toMatchObject({
    enabled: true,
    hasActiveGame: true,
    ...expected,
  });
}

test.describe('spine boot smoke', () => {
  test('boots the module spine and can start an offline 2P session', async ({ page }) => {
    await bootOffline2P(page);
  });

  test('starts an offline 2P game through spine-owned menu and setup controls', async ({ page }) => {
    await bootSpine(page);
    await waitForMountedScreens(page);

    await page.locator('#sh button').filter({ hasText: 'שני שחקנים' }).click();
    await expect(page.locator('#ss')).toBeVisible();

    await page.locator('#ss button').filter({ hasText: 'שחק' }).click();

    await enterCoinToss(page);
    await expect(page.locator('#sg')).toBeVisible();
    await expectActiveGame(page, {
      mode: 'offline-2p',
      rack0: 8,
      rack1: 8,
    });
  });

  test('exchanges rack tiles through the spine exchange overlay', async ({ page }) => {
    await bootOffline2P(page);

    const before = await readActiveGame(page);

    await page.locator('#btn-exchange').dispatchEvent('click');
    await expect(page.locator('#ov-exch')).not.toHaveClass(/hidden/);
    await expect(page.locator('#exch-rack .bt2')).toHaveCount(8);

    await page.locator('#exch-rack .bt2').first().click();
    await page.locator('#ov-exch [data-exch="confirm"]').click();

    await expect(page.locator('#ov-exch')).toHaveClass(/hidden/);
    await expect.poll(() => readActiveGame(page)).toMatchObject({
      currentTurnSlot: 1,
      turnNumber: before.turnNumber + 1,
      rack0: 8,
      rack1: 8,
      bagRemaining: before.bagRemaining,
    });
  });

  test('updates and persists settings through the spine settings overlay', async ({ page }) => {
    await bootOffline2P(page);

    await page.evaluate(() => {
      window.__spine.bus.emit(window.__spine.ui.SETTINGS_OPEN, {});
    });

    await expect(page.locator('#ov-settings')).not.toHaveClass(/hidden/);
    await page.locator('#sett-music-no').click();

    await expect(page.locator('#sett-music-no')).toHaveClass(/active-no/);

    await expect.poll(() => page.evaluate(() => ({
      globals: { music: window.gameSettings?.music },
      session: { music: window.__spine.activeGame.session.state.settings?.music },
    }))).toMatchObject({
      globals: { music: false },
      session: { music: false },
    });

    await page.reload();
    await page.waitForFunction(() => window.__spine?.enabled === true);
    await waitForMountedScreens(page);
    await page.evaluate(() => {
      window.__spine.bus.emit(window.__spine.ui.SETTINGS_OPEN, {});
    });

    await expect(page.locator('#sett-music-no')).toHaveClass(/active-no/);
  });

  test('starts a deterministic online room against mock Firebase and receives remote settings', async ({ page }) => {
    await bootSpine(page);

    const started = await page.evaluate(async () => {
      const { makeMockDb } = await import('/src/game/online/mockFirebase.js');
      const db = makeMockDb();
      const roomId = 'e2e-online-room';
      const players = {
        0: { uid: 'e2e-a', displayName: 'Alice', avatar: null, joinedAt: 1 },
        1: { uid: 'e2e-b', displayName: 'Bob', avatar: null, joinedAt: 2 },
      };
      const engineState = window.__spine.createInitialState({
        mode: 'friend-live',
        tileBagSeed: 'e2e-online-seed',
        players,
        startingSlot: 0,
        settings: { timelimit: true, botTime: 20 },
      });
      const room = await window.__spine.online.roomService.createRoom(db, {
        roomId,
        mode: 'friend-live',
        players,
        settings: { timelimit: true, botTime: 20 },
        engineState,
        serverTimestamp: 1234,
      });
      await window.__spine.online.roomService.markReadyAndMaybeStart(db, roomId, 0, 2234);
      await window.__spine.online.roomService.markReadyAndMaybeStart(db, roomId, 1, 3234);
      const readyRoom = await window.__spine.online.roomService.readRoom(db, roomId);
      const session = await window.__spine.startOnlineGameViaSpine({
        db,
        room: readyRoom,
        mySlot: 0,
        skipCoin: true,
      });
      window.__spineE2E = { db, roomId };
      return {
        hasSession: !!session,
        roomStatus: db._data.rooms[roomId].status,
        roomMode: db._data.rooms[roomId].mode,
      };
    });

    expect(started).toMatchObject({
      hasSession: true,
      roomStatus: 'playing',
      roomMode: 'friend-live',
    });
    await expect(page.locator('#sg')).toBeVisible();
    await expectActiveGame(page, {
      online: true,
      mode: 'friend-live',
      roomId: 'e2e-online-room',
      mySlot: 0,
      rack0: 8,
      rack1: 8,
    });

    await page.evaluate(async () => {
      await window.__spineE2E.db
        .ref(`rooms/${window.__spineE2E.roomId}/settings`)
        .set({ timelimit: false, botTime: 35 });
    });

    await expect.poll(() => readActiveGame(page)).toMatchObject({
      settings: {
        timelimit: false,
        botTime: 35,
      },
    });
  });
});
