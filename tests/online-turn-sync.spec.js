const { test, expect } = require('@playwright/test');

test.describe('online turn handoff sync', () => {
  test('publishes online state after normal turn handoff', async ({ page }) => {
    await page.goto('/index.html');

    const result = await page.evaluate(() => {
      let pushCalls = 0;
      const realPush = window.pushMoveToFirebase;
      const realSetTimeout = window.setTimeout;

      window.pushMoveToFirebase = () => { pushCalls++; };
      window.setTimeout = (fn, ms) => {
        if (fn === window.pushMoveToFirebase) {
          fn();
          return 1;
        }
        return realSetTimeout(fn, 0);
      };

      gMode = 'online';
      onlineMode = 'live';
      myRole = 'guest';
      window._myPlayerIndex = 1;
      turn = 0;
      futBon[0].extraTurn = false;
      futBon[1].extraTurn = false;

      nextTurn();

      const out = { turn, pushCalls };
      window.pushMoveToFirebase = realPush;
      window.setTimeout = realSetTimeout;
      return out;
    });

    expect(result.turn).toBe(1);
    expect(result.pushCalls).toBe(1);
  });

  test('publishes online state on extra-turn path', async ({ page }) => {
    await page.goto('/index.html');

    const result = await page.evaluate(() => {
      let pushCalls = 0;
      const realPush = window.pushMoveToFirebase;
      const realSetTimeout = window.setTimeout;

      window.pushMoveToFirebase = () => { pushCalls++; };
      window.setTimeout = (fn, ms) => {
        if (fn === window.pushMoveToFirebase) {
          fn();
          return 1;
        }
        return realSetTimeout(fn, 0);
      };

      gMode = 'online';
      onlineMode = 'live';
      myRole = 'host';
      window._myPlayerIndex = 0;
      turn = 0;
      futBon[0].extraTurn = true;

      nextTurn();

      const out = { turn, pushCalls, extraTurnFlag: futBon[0].extraTurn };
      window.pushMoveToFirebase = realPush;
      window.setTimeout = realSetTimeout;
      return out;
    });

    expect(result.turn).toBe(0);
    expect(result.extraTurnFlag).toBe(false);
    expect(result.pushCalls).toBe(1);
  });

  test('ignores stale snapshots so turn state does not roll back', async ({ page }) => {
    await page.goto('/index.html');

    const result = await page.evaluate(() => {
      const originalFbRef = window.fbRef;
      const originalLoadGameState = window.loadGameState;
      const originalClearMoveTimer = window.clearMoveTimer;
      const originalUpdateUI = window.updateUI;
      const originalRenderBoard = window.renderBoard;
      const originalRenderRack = window.renderRack;
      const originalRenderBonusStrips = window.renderBonusStrips;
      const originalSetS = window.setS;
      const originalSaveOnlineSession = window.saveOnlineSession;

      let listener = null;
      const appliedMoveCounts = [];
      const fakeStateRef = {
        on: (_type, fn) => { listener = fn; return fn; },
        off: () => {}
      };

      window.fbRef = () => fakeStateRef;
      window.loadGameState = (s) => { appliedMoveCounts.push(Number(s.moveCount || 0)); };
      window.clearMoveTimer = () => {};
      window.updateUI = () => {};
      window.renderBoard = () => {};
      window.renderRack = () => {};
      window.renderBonusStrips = () => {};
      window.setS = () => {};
      window.saveOnlineSession = () => {};

      gMode = 'online';
      roomCode = '123456';
      window._myPlayerIndex = 0;
      window._myLastPush = 1;

      listenForMoves();

      const emit = (state) => listener({
        exists: () => true,
        val: () => state,
      });

      // Our own echo gets ignored.
      emit({ moveCount: 1, turn: 1 });
      // Opponent's next move gets applied.
      emit({ moveCount: 2, turn: 0 });
      // Late stale event must be ignored.
      emit({ moveCount: 1, turn: 1 });

      window.fbRef = originalFbRef;
      window.loadGameState = originalLoadGameState;
      window.clearMoveTimer = originalClearMoveTimer;
      window.updateUI = originalUpdateUI;
      window.renderBoard = originalRenderBoard;
      window.renderRack = originalRenderRack;
      window.renderBonusStrips = originalRenderBonusStrips;
      window.setS = originalSetS;
      window.saveOnlineSession = originalSaveOnlineSession;

      return {
        appliedMoveCounts,
        myLastPush: window._myLastPush,
      };
    });

    expect(result.appliedMoveCounts).toEqual([2]);
    expect(result.myLastPush).toBeUndefined();
  });

});
