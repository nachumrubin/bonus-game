// Guide screenshot capture spec.
//
// Each test boots the app, drives it to an informative state, and saves a PNG
// to images/guide/. The tests are screenshot generators, not assertions.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.resolve(__dirname, '../../images/guide');
fs.mkdirSync(OUT_DIR, { recursive: true });

test.use({ viewport: { width: 412, height: 820 } });

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true &&
    typeof window.__spine.bootOfflineBot === 'function' &&
    !!window.__spine.bus);
  await hideOverlays(page);
}

async function hideOverlays(page) {
  await page.addStyleTag({ content: '#ov-onboarding,#app-loading{display:none!important}' });
  await page.evaluate(() => {
    for (const id of ['tut-intro', 'ov-champs', 'ov-settings', 'ov-guide', 'ov-faq', 'ov-onboarding']) {
      document.getElementById(id)?.classList.add('hidden');
    }
    const loader = document.getElementById('app-loading');
    if (loader) loader.style.display = 'none';
  });
}

async function shot(page, name, opts = {}) {
  await hideOverlays(page);
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, ...opts });
  return file;
}

test('home — signed-in user with rating + bottom nav', async ({ page }) => {
  await bootSpine(page);
  await page.evaluate(() => {
    window.__spine.bus.emit(window.__spine.ui.MENU_REFRESH, {
      isAuthed: true,
      displayName: 'אריאל כהן',
      avatar: '👑',
      rating: 1240,
      hasOnlineUnread: false,
      unreadCount: 0,
    });
    const tb = document.getElementById('global-topbar');
    if (tb) tb.style.display = '';
  });
  await expect(page.locator('#sh')).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, 'home');
});

test('game screen — interlocked words + a pending lock on the board', async ({ page }) => {
  await bootSpine(page);
  await page.evaluate(() => window.__spine.bootOfflineBot({ difficulty: 1 }));
  await expect(page.locator('#sg')).toBeVisible();
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    const session = window.__spine?.activeGame?.session;
    if (!session) return;
    const state = session.state;
    const tile = (letter, val) => ({ letter, val, isJoker: false });

    state.board[3][5] = tile('ת', 1);
    state.board[4][4] = tile('ש', 2);
    state.board[4][5] = tile('ל', 1);
    state.board[4][6] = tile('ו', 1);
    state.board[4][7] = tile('ם', 2);
    state.board[5][5] = tile('ב', 3);
    state.firstMove = false;
    state.scores[0] = 23;
    state.scores[1] = 11;
    state.lockedCells = [
      { id: 'lock-demo', r: 6, c: 6, ownerSlot: 0, remainingTurns: 3, duration: 3 },
    ];
    state.lockInventory[0] = [3, 5];

    window.__spine.bus.emit(window.__spine.EV.LOCKS_CHANGED, {
      lockedCells: [...state.lockedCells],
      lockInventory: { 0: [...state.lockInventory[0]], 1: [...state.lockInventory[1]] },
    });

    for (const id of ['sv1', 'is-sv1']) {
      const el = document.getElementById(id); if (el) el.textContent = String(state.scores[0]);
    }
    for (const id of ['sv2', 'is-sv2']) {
      const el = document.getElementById(id); if (el) el.textContent = String(state.scores[1]);
    }
  });
  await page.waitForTimeout(400);
  await shot(page, 'game-screen');
});

test('exchange overlay', async ({ page }) => {
  await bootSpine(page);
  await page.evaluate(() => window.__spine.bootOfflineBot({ difficulty: 1 }));
  await expect(page.locator('#sg')).toBeVisible();
  await page.waitForTimeout(300);
  await page.locator('#btn-exchange').click();
  await expect(page.locator('#ov-exch')).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(300);
  await shot(page, 'exchange-overlay');
});

test('שאילתה overlay — word checked with a result', async ({ page }) => {
  await bootSpine(page);
  await page.evaluate(() => window.__spine.bootOfflineBot({ difficulty: 1 }));
  await expect(page.locator('#sg')).toBeVisible();
  await page.waitForTimeout(300);

  await page.waitForFunction(async () => {
    try { await window.__spine.ensureDictionaryLoaded?.(); }
    catch { return false; }
    const d = window.__spine.hebrewDictionary?.DICT;
    return d && typeof d.size === 'number' && d.size > 1000;
  }, null, { timeout: 15_000 });

  await page.locator('#btn-shailta').click();
  await expect(page.locator('#ov-shailta')).toBeVisible({ timeout: 3000 });
  await page.locator('#shin').fill('שלום');
  await page.locator('#ov-shailta button:has-text("בדוק")').click();
  await expect(page.locator('#shres')).toContainText(/חוקית|לא נמצאה/);
  await page.waitForTimeout(300);
  await shot(page, 'shailta-overlay');
});

test('sign-up screen — pre-filled form', async ({ page }) => {
  await bootSpine(page);
  await page.evaluate(() => window.showSc?.('sauth-signup'));
  await expect(page.locator('#sauth-signup')).toBeVisible();

  await page.locator('#su-name').fill('אריאל כהן');
  await page.locator('#su-email').fill('ariel@example.com');
  await page.locator('#su-pass').fill('Bonus2026');
  await page.locator('#su-pass-confirm').fill('Bonus2026');
  await page.locator('#su-name').focus();
  await page.locator('#su-name').blur();
  await page.waitForTimeout(200);
  await shot(page, 'signup');
});

test('stats screen — populated with realistic numbers', async ({ page }) => {
  await bootSpine(page);
  await page.evaluate(() => window.showSc?.('sstats'));
  await expect(page.locator('#sstats')).toBeVisible({ timeout: 3000 });

  await page.evaluate(() => {
    window.__spine.bus.emit(window.__spine.ui.PROFILE_RENDER, {
      profile: {
        displayName: 'אריאל כהן',
        equippedAvatar: 'diamond',
        userId: 'AC1240',
        rating: 1240,
        stats: {
          gamesPlayed: 87,
          gamesWon: 52,
          gamesLost: 32,
          gamesDraw: 3,
          highScore: 412,
          totalScore: 19350,
          totalMoves: 1140,
          currentStreak: 4,
          longestStreak: 9,
          highestMoveScore: 78,
          bonusesTriggered: 41,
          wordsPlayed: 612,
          comebackWins: 6,
          lastMoveWins: 4,
          closeWins: 11,
          longestWord: 'מתמטיקה',
          longestWordLength: 7,
          recentGames: [
            { result: 'win',  score: 245, opponentScore: 180, ts: Date.now() - 1 * 86400000 },
            { result: 'win',  score: 298, opponentScore: 210, ts: Date.now() - 2 * 86400000 },
            { result: 'loss', score: 175, opponentScore: 220, ts: Date.now() - 3 * 86400000 },
            { result: 'win',  score: 312, opponentScore: 195, ts: Date.now() - 4 * 86400000 },
            { result: 'win',  score: 256, opponentScore: 198, ts: Date.now() - 5 * 86400000 },
            { result: 'draw', score: 200, opponentScore: 200, ts: Date.now() - 6 * 86400000 },
            { result: 'win',  score: 287, opponentScore: 240, ts: Date.now() - 7 * 86400000 },
            { result: 'loss', score: 165, opponentScore: 230, ts: Date.now() - 8 * 86400000 },
            { result: 'win',  score: 412, opponentScore: 275, ts: Date.now() - 9 * 86400000 },
            { result: 'win',  score: 305, opponentScore: 244, ts: Date.now() - 10 * 86400000 },
          ],
          boostUsage: { B1: 8, B3: 12, B9: 5, B12: 4 },
          wordCounts: { שלום: 7, אהבה: 5, ילד: 4, ים: 3, ספר: 2 },
          weekdayStats: { 0: { won: 6 }, 1: { won: 9 }, 2: { won: 5 }, 3: { won: 7 }, 4: { won: 8 }, 5: { won: 11 }, 6: { won: 6 } },
          moveSpeedStats: { 20: { played: 12, won: 6 }, 40: { played: 50, won: 35 }, 60: { played: 25, won: 11 } },
          rivalStats: {},
          fastestWinMs: 245000,
        },
      },
      isAnonymous: false,
      email: 'ariel@example.com',
    });
  });
  await page.waitForTimeout(400);
  await shot(page, 'stats');
});
