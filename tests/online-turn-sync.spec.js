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

  test('does not treat an opponent state with the same local sequence as our echo', async ({ page }) => {
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
      const applied = [];
      const fakeStateRef = {
        on: (_type, fn) => { listener = fn; return fn; },
        off: () => {}
      };

      window.fbRef = () => fakeStateRef;
      window.loadGameState = (s) => { applied.push({ moveCount: Number(s.moveCount || 0), pushId: s.pushId }); };
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
      window._onlineClientId = 'me';
      window._myLastPushSeq = 7;
      window._myLastPushId = 'my-push';

      listenForMoves();
      listener({
        exists: () => true,
        val: () => ({
          moveCount: 12,
          turn: 0,
          stateSeq: 7,
          lastWriterId: 'other-client',
          pushId: 'other-push'
        }),
      });

      window.fbRef = originalFbRef;
      window.loadGameState = originalLoadGameState;
      window.clearMoveTimer = originalClearMoveTimer;
      window.updateUI = originalUpdateUI;
      window.renderBoard = originalRenderBoard;
      window.renderRack = originalRenderRack;
      window.renderBonusStrips = originalRenderBonusStrips;
      window.setS = originalSetS;
      window.saveOnlineSession = originalSaveOnlineSession;

      return { applied, myLastPushId: window._myLastPushId };
    });

    expect(result.applied).toEqual([{ moveCount: 12, pushId: 'other-push' }]);
    expect(result.myLastPushId).toBeUndefined();
  });

  test('pushMoveToFirebase allocates stateSeq from current Firebase state', async ({ page }) => {
    await page.goto('/index.html');

    const result = await page.evaluate(async () => {
      const originalFbRef = window.fbRef;
      const originalSaveOnlineSession = window.saveOnlineSession;
      const originalSendPush = window._sendPushNotification;
      const originalFirebase = window.firebase;

      let transactionPayload = null;
      const writes = [];
      window.fbRef = (path) => {
        if(path.endsWith('/state')){
          return {
            transaction: (fn) => {
              transactionPayload = fn({ stateSeq: 42, moveCount: 4, turn: 1 });
              return Promise.resolve({ snapshot: { val: () => transactionPayload } });
            }
          };
        }
        return { set: (value) => { writes.push({ path, value }); return Promise.resolve(); } };
      };
      window.saveOnlineSession = () => {};
      window._sendPushNotification = () => {};
      window.firebase = { database: { ServerValue: { TIMESTAMP: 123456 } } };

      gMode = 'online';
      onlineMode = 'live';
      roomCode = '123456';
      myRole = 'guest';
      window._myPlayerIndex = 1;
      window._onlineClientId = 'client-a';
      onlineStateSeq = 5;
      moveCount = 5;
      turn = 0;

      pushMoveToFirebase('handoff');
      await Promise.resolve();

      window.fbRef = originalFbRef;
      window.saveOnlineSession = originalSaveOnlineSession;
      window._sendPushNotification = originalSendPush;
      window.firebase = originalFirebase;

      return {
        stateSeq: transactionPayload.stateSeq,
        moveCount: transactionPayload.moveCount,
        turn: transactionPayload.turn,
        writer: transactionPayload.lastWriterId,
        hasPushId: typeof transactionPayload.pushId === 'string' && transactionPayload.pushId.length > 0,
        liveCleared: writes.some(w => w.path.endsWith('/live') && Array.isArray(w.value) && w.value.length === 0)
      };
    });

    expect(result.stateSeq).toBe(43);
    expect(result.moveCount).toBe(5);
    expect(result.turn).toBe(0);
    expect(result.writer).toBe('client-a');
    expect(result.hasPushId).toBe(true);
    expect(result.liveCleared).toBe(true);
  });

  test('online end menu resigns immediately and updates room status', async ({ page }) => {
    await page.goto('/index.html');

    const result = await page.evaluate(() => {
      const originalConfirm = window.confirm;
      const originalFbRef = window.fbRef;
      const originalCleanup = window.cleanupOnlineListeners;
      const originalStopDcTimer = window.stopDcTimer;
      const originalRemoveSession = window.removeOnlineSession;
      const originalEndGame = window.endGame;
      const originalSetS = window.setS;

      let updatePayload = null;
      let stopCalls = 0;
      let cleanupCalls = 0;
      let removeCalls = 0;
      let endCalls = 0;
      const statuses = [];

      window.confirm = () => true;
      window.fbRef = () => ({
        update: (payload) => {
          updatePayload = payload;
          return Promise.resolve();
        }
      });
      window.stopDcTimer = () => { stopCalls++; };
      window.cleanupOnlineListeners = () => { cleanupCalls++; };
      window.removeOnlineSession = () => { removeCalls++; };
      window.endGame = () => { endCalls++; };
      window.setS = (msg) => { statuses.push(msg); };

      gMode = 'online';
      roomCode = '123456';
      myRole = 'host';

      openEndMenu();

      window.confirm = originalConfirm;
      window.fbRef = originalFbRef;
      window.cleanupOnlineListeners = originalCleanup;
      window.stopDcTimer = originalStopDcTimer;
      window.removeOnlineSession = originalRemoveSession;
      window.endGame = originalEndGame;
      window.setS = originalSetS;

      return { updatePayload, stopCalls, cleanupCalls, removeCalls, endCalls, statuses };
    });

    expect(result.updatePayload.status).toBe('resigned');
    expect(result.updatePayload.resignedBy).toBe('host');
    expect(result.stopCalls).toBe(1);
    expect(result.cleanupCalls).toBe(1);
    expect(result.removeCalls).toBe(1);
    expect(result.endCalls).toBe(1);
    expect(result.statuses).toContain('פרשת מהמשחק.');
  });

  test('room resigned status notifies opponent immediately', async ({ page }) => {
    await page.goto('/index.html');

    const result = await page.evaluate(() => {
      const originalFbRef = window.fbRef;
      const originalAnnounce = window.announceOpponentResigned;
      const originalRemove = window.removeOnlineSession;

      let listener = null;
      let announcedWith = null;
      const removed = [];
      const fakeRoomRef = {
        on: (_type, fn) => { listener = fn; return fn; },
        off: () => {}
      };

      window.fbRef = () => fakeRoomRef;
      window.announceOpponentResigned = (role) => { announcedWith = role; };
      window.removeOnlineSession = (code) => { removed.push(code); };

      gMode = 'online';
      roomCode = '654321';
      myRole = 'guest';

      listenForRoomStatus();
      listener({
        exists: () => true,
        val: () => ({ status: 'resigned', resignedBy: 'host' }),
      });

      window.fbRef = originalFbRef;
      window.announceOpponentResigned = originalAnnounce;
      window.removeOnlineSession = originalRemove;

      return { announcedWith, removedCount: removed.length };
    });

    expect(result.announcedWith).toBe('host');
    expect(result.removedCount).toBe(0);
  });
});
