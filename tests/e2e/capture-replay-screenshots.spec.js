// Capture the admin game-replay overlay (#ov-replay) with seeded frames that
// exercise the boost-square rendering + outcome-based divergence. Not an
// assertion — writes a PNG to images/guide/debug/.
const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.resolve(__dirname, '../../images/guide/debug');
fs.mkdirSync(OUT_DIR, { recursive: true });

test.use({ viewport: { width: 412, height: 820 } });

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true
    && typeof window.__spine.ui?.mountGameScreen === 'function');
}

test('replay overlay with boost squares', async ({ page }) => {
  await bootSpine(page);

  await page.evaluate(() => {
    const flat = (occ) => {
      const f = new Array(100).fill(null);
      for (const [i, l] of Object.entries(occ)) f[i] = { letter: l };
      return f;
    };
    // Two crossing words plus a couple of singles.
    const tilesEarly = { 33: 'ש', 34: 'ל', 35: 'ו', 36: 'ם', 44: 'ת', 54: 'ו', 64: 'ר' };
    const tilesLate = { ...tilesEarly, 43: 'ג', 45: 'ן', 22: 'ק', 23: 'ר', 24: 'ב' };

    const assignment = Array.from({ length: 12 }, (_, i) => ({
      type: `B${i + 1}`, pts: [100, 40, 25, 50, 0, 30, 0, 40, 1, 50, 0, 25][i], ic: '⚡',
    }));
    const players = { 0: { displayName: 'נחום רובין' }, 1: { displayName: 'הודיה' } };

    const mk = (tiles, { host, guest, turn, used, drop }) => ({
      board: flat(tiles),
      compact: { hostScore: host, guestScore: guest, turnNumber: turn, status: 'playing' },
      players,
      version: turn,
      believedVersion: turn,
      appVersion: '20260628',
      bonusAssignment: assignment,
      bonusBoard: drop ? { '-1,1': { letter: 'ז', val: 7 } } : null,
      bonusSqUsed: used,
    });

    // Three frames. All panels agree on the visible outcome → no false "לא תואם".
    const frames = [
      {
        t: 1, diverged: false,
        server: mk(tilesEarly, { host: 60, guest: 19, turn: 10, used: { 0: true } }),
        p0:     mk(tilesEarly, { host: 60, guest: 19, turn: 10, used: { 0: true } }),
        p1:     mk(tilesEarly, { host: 60, guest: 19, turn: 11, used: { 0: true } }), // turn drift only
      },
      {
        t: 2, diverged: false,
        server: mk(tilesLate, { host: 102, guest: 33, turn: 14, used: { 0: true, 2: true }, drop: true }),
        p0:     mk(tilesLate, { host: 102, guest: 33, turn: 14, used: { 0: true, 2: true }, drop: true }),
        p1:     mk(tilesLate, { host: 102, guest: 33, turn: 15, used: { 0: true, 2: true }, drop: true }),
        bonuses: [
          { slot: 0, boostId: 'auto_extra_score', bonusIdx: 0, bonusType: 'B1', extra: 100 },
          { slot: 1, boostId: 'extra_turn', bonusIdx: 2, bonusType: 'B11', extra: 0 },
        ],
      },
    ];

    window.__spine.bus.emit('replay/open', { gameId: 'mm_demo_8dnzj4', frames });
  });

  // The test env can't reach Firebase, so the boot "מתחבר…" splash stays on top.
  // Hide it (and any stray intro overlays) so the replay overlay is unobstructed.
  await page.evaluate(() => {
    document.getElementById('app-loading')?.remove();
    for (const id of ['tut-intro', 'ov-onboarding', 'ov-bonus-intro', 'ov-champs', 'ov-settings', 'ov-guide', 'ov-faq']) {
      document.getElementById(id)?.classList.add('hidden');
    }
  });

  // Land on the richer second frame.
  await page.evaluate(() => {
    document.getElementById('replay-next')?.click();
  });

  const overlay = page.locator('#ov-replay');
  await overlay.waitFor({ state: 'visible' });
  await page.waitForTimeout(150);
  await overlay.screenshot({ path: path.join(OUT_DIR, 'replay-boost-squares.png') });
});
