// Repro attempt: offline lock that ticks out of engine state but leaves a
// stale "locked" cell in the DOM (phantom lock). Drives the offline-2p engine
// directly via __spine and inspects the cell DOM after the lock expires.
const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 412, height: 820 } });

async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true
    && typeof window.__spine.ui?.mountGameScreen === 'function'
    && typeof window.__spine.bootOffline2P === 'function');
  await page.waitForFunction(async () => {
    try { await window.__spine.ensureDictionaryLoaded?.(); } catch { return false; }
    const d = window.__spine.hebrewDictionary?.DICT;
    return d && typeof d.size === 'number' && d.size > 1000;
  }, null, { timeout: 15_000 });
}

function cellState() {
  // Runs in the browser. Returns the DOM + engine state for cell (0,0).
  const cell = document.getElementById('c0_0');
  const st = window.__spine.activeGame?.session?.state;
  return {
    classes: cell ? [...cell.classList] : null,
    innerHTML: cell ? cell.innerHTML : null,
    lockedCells: st ? JSON.parse(JSON.stringify(st.lockedCells ?? [])) : null,
    currentTurnSlot: st ? st.currentTurnSlot : null,
  };
}

test('offline lock that expires clears its cell in the DOM', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__spine.bootOffline2P());
  await page.waitForTimeout(300);

  const steps = await page.evaluate(async () => {
    const { bus, CMD } = window.__spine;
    const session = window.__spine.activeGame.session;
    const st = session.state;
    const log = [];
    const snap = (label) => {
      const cell = document.getElementById('c0_0');
      log.push({
        label,
        classes: cell ? [...cell.classList] : null,
        hasLockBadge: cell ? /spine-lock/.test(cell.innerHTML) : null,
        lockedCells: JSON.parse(JSON.stringify(st.lockedCells ?? [])),
        turn: st.currentTurnSlot,
      });
    };

    // Make it slot 1's turn so the lock is owned by the opponent (slot 1).
    st.currentTurnSlot = 1;
    st.lockInventory = { 0: [3, 3, 5], 1: [1, 3, 5] };
    session.dispatch({ type: CMD.PLACE_LOCK, payload: { r: 0, c: 0, duration: 1 } });
    snap('after opponent places 1-turn lock at (0,0)');

    // Now slot 0 (us). Pass — advanceTurn ticks the lock 1 -> 0, removing it.
    session.dispatch({ type: CMD.PASS_TURN });
    snap('after our pass (lock should tick out)');

    return log;
  });

  for (const s of steps) console.log('STEP', JSON.stringify(s));

  const afterExpire = steps[steps.length - 1];
  expect(afterExpire.lockedCells.length).toBe(0); // engine cleared it
  // The DOM must not still show a lock on an unlocked cell.
  expect(afterExpire.classes).not.toContain('spine-lock-cell');
  expect(afterExpire.classes).not.toContain('locked-cell');
  expect(afterExpire.hasLockBadge).toBeFalsy();
});
