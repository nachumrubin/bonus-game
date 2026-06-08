// Screenshot capture for the redesigned "המשחקים שלי" (#smygames) screen.
//
// Seeds MG_RENDER with a mix of session types so the captured PNG shows
// all four visual states the card UI is designed to handle:
//   1. Local saved game (isLocal=true, gold pill, 💾 badge)
//   2. My-turn online game (green "🟢 תורך" pill, gold-glowing score)
//   3. Opponent-turn online game (neutral pill, time-ago line)
//   4. Expired game (muted look, dismiss-only, no Resume button)
//
// Output → images/guide/my-games-screen.png.

const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.resolve(__dirname, '../../images/guide');
fs.mkdirSync(OUT_DIR, { recursive: true });

test.use({ viewport: { width: 414, height: 896 } });

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true
    && typeof window.__spine.ui?.mountMenuScreen === 'function');
}

test('my-games screen: card layout with all four row states', async ({ page }) => {
  await bootSpine(page);

  // Hide everything else and reveal #smygames via the spine's screen router.
  // We don't go through the home button because the showSc transition would
  // briefly animate the home screen on top of #smygames.
  await page.evaluate(() => {
    for (const id of ['sh', 'tut-intro', 'ov-champs', 'ov-settings', 'ov-guide', 'ov-faq']) {
      document.getElementById(id)?.classList.add('hidden');
    }
    window.showSc?.('smygames');
  });

  // Seed deterministic timestamps so the time-ago labels render the same
  // every time the spec runs. `nowFixed` is the "current time" reference;
  // each session is back-dated relative to it.
  const nowFixed = Date.UTC(2026, 5, 7, 14, 0, 0); // 2026-06-07T14:00:00Z
  const HOUR = 3_600_000;
  const DAY  = 24 * HOUR;

  await page.evaluate(({ now, sessions }) => {
    // MG_RENDER is a stable string constant; hard-coding it keeps the
    // spec independent of internal exports.
    window.__spine?.bus?.emit?.('myGames/render', { sessions });
    // Force the "now" used by the time-ago helper to be deterministic.
    // (The screen reads now() lazily on each render, so re-emit after
    // installing the freezer.)
    const origDate = Date.now;
    Date.now = () => now;
    window.__spine?.bus?.emit?.('myGames/render', { sessions });
    // Restore Date.now so the rest of the page behaves normally; the
    // captured DOM already has the seeded "ago" strings.
    Date.now = origDate;
  }, {
    now: nowFixed,
    sessions: [
      // 1) Local saved offline game (gold pill + 💾 badge)
      {
        roomId: '__local__', isLocal: true, isMyTurn: true, isExpired: false,
        opponentName: 'המחשב', opponentAvatar: '🤖',
        myScore: 124, opponentScore: 98,
        lastUpdated: nowFixed - 1.5 * HOUR,
      },
      // 2) My-turn online game (green pill, gold-glowing score)
      {
        roomId: 'r-mine', isLocal: false, isMyTurn: true, isExpired: false,
        opponentName: 'בודק12', opponentAvatar: 'crown',
        myScore: 208, opponentScore: 260,
        lastUpdated: nowFixed - 9 * HOUR,
      },
      // 3) Opponent-turn online game (neutral pill + time-ago)
      {
        roomId: 'r-theirs', isLocal: false, isMyTurn: false, isExpired: false,
        opponentName: 'דני', opponentAvatar: 'dragon',
        myScore: 31, opponentScore: 6,
        lastUpdated: nowFixed - 2 * DAY,
      },
      // 4) Expired game (muted look, no Resume button)
      {
        roomId: 'r-expired', isLocal: false, isMyTurn: false, isExpired: true,
        opponentName: 'רותי', opponentAvatar: 'star',
        myScore: 175, opponentScore: 182,
        lastUpdated: nowFixed - 8 * DAY,
      },
    ],
  });

  // Let the browser settle on the new layout/paint.
  await page.waitForTimeout(150);

  const out = path.join(OUT_DIR, 'my-games-screen.png');
  await page.screenshot({ path: out, fullPage: false });
  // eslint-disable-next-line no-console
  console.log(`[capture] wrote ${out}`);
});
