// Full-game regression: offline bot-vs-bot games played to the end in the real
// app (engine + game screen + bonus/mini-game UI), several in parallel across
// Playwright workers. Each game uses its own tile-bag seed.
//
// The driver taps whatever a human would have to tap (award card, mini-game
// "continue", wheel spin, bonus intro) and runs long page timers 5x faster so
// mini-game clocks and bot thinking don't take real minutes. A game whose turn
// doesn't move for 60 s fails with a dump of the pending bonus + open overlays.
//
// Checks per game: it reaches a terminal status, no page errors, tile
// conservation (board + racks + bag = the full set) and score sanity.
const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 412, height: 820 } });
test.describe.configure({ mode: 'parallel' });

const SEEDS = ['regress-a', 'regress-b', 'regress-c', 'regress-d'];
const MAX_STEPS = 900;   // 500 ms each
const STALL_STEPS = 120; // no turn change for 60 s = stuck

for (const seed of SEEDS) {
  test(`bot vs bot plays a full game to the end (${seed})`, async ({ page }) => {
    test.setTimeout(420_000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e?.stack ?? e)));
    page.on('crash', () => errors.push('page crashed'));
    await page.addInitScript(() => {
      // Off-grid bonus squares live in bonusBoard, not board.
      window.__countTiles = (st) => {
        const bonus = st.bonusBoard instanceof Map ? st.bonusBoard.size : Object.keys(st.bonusBoard ?? {}).length;
        return st.board.flat().filter(Boolean).length + bonus + st.racks[0].length + st.racks[1].length + st.bag.length;
      };
      // Run long timers (mini-game clocks, bot thinking, award holds) 5x
      // faster. A fake clock (page.clock) crashes the page here, and short
      // timers stay real so animations and input behave as usual.
      const SPEED = 5;
      const fast = (ms) => (Number(ms) >= 500 ? Number(ms) / SPEED : ms);
      const st0 = window.setTimeout.bind(window);
      const si0 = window.setInterval.bind(window);
      window.setTimeout = (fn, ms, ...a) => st0(fn, fast(ms), ...a);
      window.setInterval = (fn, ms, ...a) => si0(fn, fast(ms), ...a);
    });
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => window.__spine?.enabled === true && typeof window.__spine.startGameViaSpine === 'function'), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__spine.ensureDictionaryLoaded());
    await expect.poll(() => page.evaluate(() => window.__spine.hebrewDictionary.DICT.size), { timeout: 30_000 }).toBeGreaterThan(1000);

    const total = await page.evaluate(async (tileBagSeed) => {
      const sp = window.__spine;
      const { attachBotPlayer } = sp.sessions;
      const words = [...sp.hebrewDictionary.DICT].filter(w => w.length <= 5).slice(0, 20000);
      await sp.startGameViaSpine({
        mode: 'offline-2p',
        tileBagSeed,
        beforeStart(session) {
          for (const slot of [0, 1]) {
            attachBotPlayer(session, { slot, wordList: words, isWordValid: (w) => sp.hebrewDictionary.isValid(w), difficulty: 1, thinkingMs: 200 });
          }
        },
      });
      const st = sp.activeGame.session.state;
      return window.__countTiles(st);
    }, seed);
    expect(total).toBeGreaterThan(50);

    let snap = null;
    let lastTurn = null;
    let stalledSteps = 0;
    let stallInfo = null;
    for (let step = 0; step < MAX_STEPS; step++) {
      await page.waitForTimeout(500);
      snap = await page.evaluate(() => {
        const visible = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
        for (const sel of ['[data-bonus-ok]', '#bok', '[data-wheel="spin"]:not([disabled])', '#ov-bonus-intro:not(.hidden) button', '[data-uns="continue"]']) {
          for (const el of document.querySelectorAll(sel)) if (visible(el)) el.click();
        }
        const st = window.__spine.activeGame?.session?.state;
        if (!st) return null;
        return {
          status: st.status, turn: st.turnNumber, scores: { ...st.scores },
          tiles: window.__countTiles(st),
        };
      });
      if (snap && snap.turn === lastTurn) stalledSteps++; else { stalledSteps = 0; lastTurn = snap?.turn; }
      if (stalledSteps >= STALL_STEPS) {
        stallInfo = await page.evaluate(() => {
          const g = window.__spine.activeGame;
          const st = g.session.state;
          const shown = [...document.querySelectorAll('[id]')]
            .filter(e => e.offsetParent && /^ov|overlay|bz-|bonus/i.test(e.id) && !e.classList.contains('hidden'))
            .map(e => e.id);
          return JSON.stringify({
            slot: st.currentTurnSlot, turn: st.turnNumber, pendingScoreCommit: !!st.pendingScoreCommit,
            pendingBonuses: st.pendingBonuses, lastMove: st.moveHistory[st.moveHistory.length - 1], shown,
            overlays: [...document.querySelectorAll('.bz-overlay, .bonus-award-positioner')].map(e => e.className),
          });
        });
        await test.info().attach('stall.png', { body: await page.screenshot(), contentType: 'image/png' });
        break;
      }
      if (!snap || snap.status !== 'playing') break;
    }

    expect(stallInfo, `game stalled: ${stallInfo}`).toBeNull();
    expect(errors, errors.join('\n')).toEqual([]);
    expect(snap, 'game state still mounted').not.toBeNull();
    expect(snap.status, `game ended (stopped at turn ${snap.turn})`).not.toBe('playing');
    expect(snap.tiles, 'tile conservation').toBe(total);
    for (const s of [0, 1]) {
      expect(Number.isFinite(snap.scores[s])).toBe(true);
      expect(snap.scores[s]).toBeGreaterThanOrEqual(0);
    }
    expect(snap.turn).toBeGreaterThan(4);
  });
}
