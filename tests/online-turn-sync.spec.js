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
});
