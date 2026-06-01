// Guide screenshot capture spec.
//
// This is a Playwright spec but its "tests" are screenshot generators, not
// assertions. Each test boots the app, drives it to an informative state,
// and saves a PNG to images/guide/.
//
// Run:
//   npm run guide:screenshots
//
// The screenshot files are committed under images/guide/ and referenced by
// partials/screens/guide-screen.html. Filenames are stable per-test so the
// guide HTML doesn't need to change when captures are re-run.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.resolve(__dirname, '../../images/guide');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Mobile-ish viewport — the app is portrait-only per manifest.json, so the
// guide screenshots should match that aspect ratio.
test.use({ viewport: { width: 412, height: 820 } });

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true &&
    typeof window.__spine.bootOfflineBot === 'function' &&
    !!window.document.querySelector('#sh .em-circle-btn'));
}

async function hideOverlays(page) {
  await page.evaluate(() => {
    for (const id of ['tut-intro', 'ov-champs', 'ov-settings', 'ov-guide', 'ov-faq']) {
      document.getElementById(id)?.classList.add('hidden');
    }
  });
}

async function shot(page, name, opts = {}) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, ...opts });
  return file;
}

// ─────────────────────────────────────────────────────────────────────
// 1. Home — signed-in user, gold ELO badge, bottom nav visible
// ─────────────────────────────────────────────────────────────────────
test('home — signed-in user with rating + bottom nav', async ({ page }) => {
  await bootSpine(page);
  await hideOverlays(page);

  // The topbar only shows the bell + ELO + bottom nav when `isAuthed: true`.
  // MENU_REFRESH is the supported entry point — same path the profile
  // watcher uses in production.
  await page.evaluate(() => {
    window.__spine.bus.emit(window.__spine.ui.MENU_REFRESH, {
      isAuthed: true,
      displayName: 'אריאל כהן',
      avatar: '👑',
      rating: 1240,
      hasOnlineUnread: false,
      unreadCount: 0,
    });
    // Make sure the global topbar is visible (it's hidden on first paint
    // before screenTransitions decides which screen owns it).
    const tb = document.getElementById('global-topbar');
    if (tb) tb.style.display = '';
  });
  await expect(page.locator('#sh')).toBeVisible();
  await page.waitForTimeout(400); // let globe paint a couple frames
  await shot(page, 'home');
});

// ─────────────────────────────────────────────────────────────────────
// 2. Game screen — board has multiple interlocked words AND a lock,
//    showing what "real" gameplay looks like a few moves in.
// ─────────────────────────────────────────────────────────────────────
test('game screen — interlocked words + a pending lock on the board', async ({ page }) => {
  await bootSpine(page);
  await hideOverlays(page);
  await page.evaluate(() => window.__spine.bootOfflineBot({ difficulty: 1 }));
  await expect(page.locator('#sg')).toBeVisible();
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    const session = window.__spine?.activeGame?.session;
    if (!session) return;
    const state = session.state;
    const tile = (letter, val) => ({ letter, val, isJoker: false });

    // Build a small interlocking crossword in the centre of the board:
    //
    //   row 3  .  ת  .          (ת=1)        — extends "תו" downward
    //   row 4  ש  ל  ו  ם       (שלום=2+1+1+2)
    //   row 5  .  ב  .  .       (ב=3)        — extends "לב" downward
    //
    // Coordinates use the 0..9 grid; firstMove=false so the empty side is
    // legal to play onto.
    state.board[3][5] = tile('ת', 1);
    state.board[4][4] = tile('ש', 2);
    state.board[4][5] = tile('ל', 1);
    state.board[4][6] = tile('ו', 1);
    state.board[4][7] = tile('ם', 2);
    state.board[5][5] = tile('ב', 3);
    state.firstMove = false;

    // Give P1 a respectable score so the chips have content.
    state.scores[0] = 23;
    state.scores[1] = 11;

    // Place a 3-turn lock at (6, 6) belonging to slot 0 — visible distinct
    // lock badge with the duration number.
    state.lockedCells = [
      { id: 'lock-demo', r: 6, c: 6, ownerSlot: 0, remainingTurns: 3, duration: 3 },
    ];
    state.lockInventory[0] = [3, 5];

    // Trigger a UI re-sync. LOCKS_CHANGED re-runs syncFromState in the
    // controller, which copies the mutated board + locks into the view.
    window.__spine.bus.emit(window.__spine.EV.LOCKS_CHANGED, {
      lockedCells: [...state.lockedCells],
      lockInventory: { 0: [...state.lockInventory[0]], 1: [...state.lockInventory[1]] },
    });

    // Skip the count-up animation — animateScore tweens take 460ms+ to
    // settle and may still show stale values when we screenshot. Snap the
    // score chips to their final values directly.
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

// ─────────────────────────────────────────────────────────────────────
// 3. Exchange overlay — overlay open with the rack visible.
// ─────────────────────────────────────────────────────────────────────
test('exchange overlay', async ({ page }) => {
  await bootSpine(page);
  await hideOverlays(page);
  await page.evaluate(() => window.__spine.bootOfflineBot({ difficulty: 1 }));
  await expect(page.locator('#sg')).toBeVisible();
  await page.waitForTimeout(300);
  await page.locator('#btn-exchange').click();
  await expect(page.locator('#ov-exch')).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(300);
  await shot(page, 'exchange-overlay');
});

// ─────────────────────────────────────────────────────────────────────
// 4. שאילתה overlay — open, type a real Hebrew word, press בדוק, and
//    capture the "מילה חוקית ✓" result so players see the outcome.
// ─────────────────────────────────────────────────────────────────────
test('שאילתה overlay — word checked with a green result', async ({ page }) => {
  await bootSpine(page);
  await hideOverlays(page);
  await page.evaluate(() => window.__spine.bootOfflineBot({ difficulty: 1 }));
  await expect(page.locator('#sg')).toBeVisible();
  await page.waitForTimeout(300);

  // Wait for the dictionary to actually load — otherwise the check returns
  // "המילון עדיין נטען..." instead of a real verdict.
  await page.waitForFunction(() =>
    window.__spine?.hebrewDictionary?.dictReady === true, { timeout: 8000 });

  await page.locator('#btn-shailta').click();
  await expect(page.locator('#ov-shailta')).toBeVisible({ timeout: 3000 });
  await page.locator('#shin').fill('שלום');
  // The "בדוק ✓" button inside the overlay.
  await page.locator('#ov-shailta button:has-text("בדוק")').click();
  // Wait for the result span to populate with "חוקית" (the success word).
  await expect(page.locator('#shres')).toContainText(/חוקית|לא נמצאה/);
  await page.waitForTimeout(300);
  await shot(page, 'shailta-overlay');
});

// ─────────────────────────────────────────────────────────────────────
// 4. Sign-up screen — form pre-filled with a made-up user so the
//    layout reads as "this is what a real submission looks like".
// ─────────────────────────────────────────────────────────────────────
test('sign-up screen — pre-filled form', async ({ page }) => {
  await bootSpine(page);
  await hideOverlays(page);
  await page.evaluate(() => window.showSc?.('sauth-signup'));
  await expect(page.locator('#sauth-signup')).toBeVisible();

  await page.locator('#su-name').fill('אריאל כהן');
  await page.locator('#su-email').fill('ariel@example.com');
  await page.locator('#su-pass').fill('Bonus2026');
  await page.locator('#su-pass-confirm').fill('Bonus2026');
  // notifications checkbox is checked by default; leave it on.

  // Blur the last field so no input cursor is captured.
  await page.locator('#su-name').focus();
  await page.locator('#su-name').blur();
  await page.waitForTimeout(200);
  await shot(page, 'signup');
});

// ─────────────────────────────────────────────────────────────────────
// 5. Stats screen — populated with a realistic profile so all cards
//    have meaningful numbers, not the 0/0/0/0 default.
// ─────────────────────────────────────────────────────────────────────
test('stats screen — populated with realistic numbers', async ({ page }) => {
  await bootSpine(page);
  await hideOverlays(page);
  await page.evaluate(() => window.showSc?.('sstats'));
  await expect(page.locator('#sstats')).toBeVisible({ timeout: 3000 });

  await page.evaluate(() => {
    // PROFILE_RENDER drives the stats screen's paint(). deriveStatsView
    // computes tier, win rate, recent sparkline, etc. from `profile.stats`.
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
          totalScore: 19_350,
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
            { result: 'win',  score: 245, opponentScore: 180, ts: Date.now() - 1*86400000 },
            { result: 'win',  score: 298, opponentScore: 210, ts: Date.now() - 2*86400000 },
            { result: 'loss', score: 175, opponentScore: 220, ts: Date.now() - 3*86400000 },
            { result: 'win',  score: 312, opponentScore: 195, ts: Date.now() - 4*86400000 },
            { result: 'win',  score: 256, opponentScore: 198, ts: Date.now() - 5*86400000 },
            { result: 'draw', score: 200, opponentScore: 200, ts: Date.now() - 6*86400000 },
            { result: 'win',  score: 287, opponentScore: 240, ts: Date.now() - 7*86400000 },
            { result: 'loss', score: 165, opponentScore: 230, ts: Date.now() - 8*86400000 },
            { result: 'win',  score: 412, opponentScore: 275, ts: Date.now() - 9*86400000 },
            { result: 'win',  score: 305, opponentScore: 244, ts: Date.now() - 10*86400000 },
          ],
          boostUsage:  { B1: 8, B3: 12, B9: 5, B12: 4 },
          wordCounts:  { שלום: 7, אהבה: 5, ילד: 4, ים: 3, ספר: 2 },
          weekdayStats:{ 0: { won: 6 }, 1: { won: 9 }, 2: { won: 5 }, 3: { won: 7 }, 4: { won: 8 }, 5: { won: 11 }, 6: { won: 6 } },
          moveSpeedStats: { 20: { played: 12, won: 6 }, 40: { played: 50, won: 35 }, 60: { played: 25, won: 11 } },
          rivalStats:  {},
          fastestWinMs: 245_000,
        },
      },
      isAnonymous: false,
      email: 'ariel@example.com',
    });
  });
  await page.waitForTimeout(400);
  await shot(page, 'stats');
});
