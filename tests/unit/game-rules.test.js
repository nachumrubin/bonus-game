const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('game.js', 'utf8');

function extractFunction(name) {
  const startToken = `function ${name}(`;
  const start = source.indexOf(startToken);
  if (start === -1) throw new Error(`Could not find ${name}`);
  let i = source.indexOf('{', start);
  if (i === -1) throw new Error(`Could not find body for ${name}`);
  let depth = 0;
  for (let j = i; j < source.length; j++) {
    const ch = source[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, j + 1);
      }
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

function buildContextWith(functionNames, extra = {}) {
  const ctx = vm.createContext({ ...extra });
  for (const fn of functionNames) {
    vm.runInContext(extractFunction(fn), ctx);
  }
  return ctx;
}

test('isConnected requires attaching to committed tiles (not only newly placed tiles)', () => {
  const ctx = buildContextWith(
    ['isBonusPos', 'getCommittedTile', 'getMoveTiles', 'isConnected'],
    {
      BS: 10,
      BDEFS: [],
      bBoardData: {},
      bData: Array.from({ length: 10 }, () => Array(10).fill(null)),
      placed: [],
      replacedThisTurn: null,
      firstMove: false
    }
  );

  // New tiles adjacent only to each other, disconnected from board.
  ctx.placed = [
    { r: 5, c: 5, letter: 'א', val: 1 },
    { r: 5, c: 6, letter: 'ב', val: 1 }
  ];
  assert.equal(ctx.isConnected(), false);

  // Connect one new tile to an existing committed tile.
  ctx.bData[5][4] = { r: 5, c: 4, letter: 'ג', val: 1 };
  assert.equal(ctx.isConnected(), true);
});

test('isConnected still allows first move', () => {
  const ctx = buildContextWith(
    ['isBonusPos', 'getCommittedTile', 'getMoveTiles', 'isConnected'],
    {
      BS: 10,
      BDEFS: [],
      bBoardData: {},
      bData: Array.from({ length: 10 }, () => Array(10).fill(null)),
      placed: [{ r: 8, c: 8, letter: 'א', val: 1 }],
      replacedThisTurn: null,
      firstMove: true
    }
  );
  assert.equal(ctx.isConnected(), true);
});

test('triggerBonus B2 grants +20 and auto resolution', () => {
  const ui = new Map();
  const getEl = (id) => {
    if (!ui.has(id)) ui.set(id, { id, textContent: '', innerHTML: '' });
    return ui.get(id);
  };

  const ctx = buildContextWith(['triggerBonus'], {
    bonusPend: { extra: 0, ct: '', player: 0 },
    resetBonusOverlay: () => {},
    runBonusBuilder: () => {},
    buildCrossword: () => {},
    buildCrossingWords: () => {},
    getMediumBonusWord: () => 'שלום',
    getFillableBonusWord: () => 'חברים',
    getLongBonusWord: () => 'בדיקה',
    norm: (s) => s,
    buildUnscramble: () => {},
    buildFillMiddle: () => {},
    commitPlay: () => {},
    ovOpen: (id) => { ctx._lastOpen = id; },
    document: { getElementById: getEl }
  });

  ctx.triggerBonus('B2', 'אבא', 12);
  assert.equal(ctx.bonusPend.extra, 20);
  assert.equal(ctx.bonusPend.ct, 'auto');
  assert.equal(ctx._lastOpen, 'ov-bonus');
  assert.match(getEl('bovt').textContent, /20/);
});

test('getBonusPools filters out bonus words rejected by validator', () => {
  const ctx = buildContextWith(['isBonusPoolWordValid', 'getBonusPools'], {
    _bonusPools: null,
    _commonWords: ['שלום', 'עייפי'],
    DICT: new Set(['שלום', 'עייפי', 'חברים']),
    window: {
      HebrewValidator: {
        ready: true,
        validate: (word) => ({ valid: word !== 'עייפי' })
      }
    },
    Math
  });

  const pools = ctx.getBonusPools();
  assert.ok(pools.short.includes('שלום'));
  assert.ok(!pools.short.includes('עייפי'));
});

test('crossword bonus finalize commits base score + bonus once', () => {
  assert.match(
    source,
    /commitPlay\(bonusPend\.sc,bonusPend\.ws,extra,bonusPend\.player\)/,
    'expected crossword finalize to pass base score and bonus separately'
  );
  assert.doesNotMatch(
    source,
    /commitPlay\(bonusPend\.sc\+extra,bonusPend\.ws,extra,bonusPend\.player\)/,
    'should not add bonus into base score before commit'
  );
});



test('playWord clears move timer before forfeiting invalid move without appeal', () => {
  let clearTimerCalls = 0;
  let nextTurnCalls = 0;
  const statuses = [];
  const ctx = buildContextWith(['playWord'], {
    botBusy: false,
    gMode: 'online',
    turn: 0,
    placed: [{ r: 4, c: 4, letter: 'א', val: 1 }],
    replacedThisTurn: null,
    firstMove: false,
    gameSettings: { appealsMax: 0 },
    appealsUsed: [0, 0],
    reviewInvalid: [{ text: 'שגויה' }],
    clearMoveTimer: () => { clearTimerCalls++; },
    getMoveTiles: () => [{ r: 4, c: 4, letter: 'א', val: 1 }],
    isCollinear: () => true,
    hasGaps: () => false,
    isBonusPos: () => false,
    isConnected: () => true,
    getAllWords: () => [[{ letter: 'א' }, { letter: 'ב' }]],
    buildMoveReview: () => ({ invalid: [{ text: 'שגויה' }], total: 0 }),
    highlightIllegalWords: () => {},
    clearIllegalHighlights: () => {},
    doRecall: () => {},
    forfeitActiveFutureMultiplier: () => '',
    nextTurn: () => { nextTurnCalls++; },
    setS: (msg) => statuses.push(msg),
    setTimeout: (fn) => { fn(); return 1; },
    lastRejWord: '',
    lastRejScore: 0,
    lastRejPlaced: []
  });

  ctx.playWord();
  assert.equal(clearTimerCalls, 1);
  assert.equal(nextTurnCalls, 1);
  assert.match(statuses[0], /מילה לא חוקית/);
});


test('runBotSearchSafely returns null result instead of throwing when search crashes', () => {
  const errors = [];
  const ctx = buildContextWith(['runBotSearchSafely'], {
    doBotSearch: () => { throw new Error('boom'); },
    console: { error: (...args) => errors.push(args.join(' ')) }
  });

  const out = ctx.runBotSearchSafely();
  assert.equal(out.ok, false);
  assert.equal(out.result, null);
  assert.match(String(out.error), /boom/);
  assert.equal(errors.length, 1);
});


test('initGame immediately schedules bot move when bot is drawn first', () => {
  let scheduled = 0;
  let startedTimer = 0;
  const ctx = buildContextWith(['initGame'], {
    BS: 10,
    BDEFS: Array.from({ length: 12 }, (_, i) => ({ id: i })),
    BONUS_TYPES: [{ type: 'B1', ic: '⚡' }, { type: 'B2', ic: '🎁' }],
    Math,
    gMode: 'bot',
    // state vars initGame mutates
    bData: null,
    racks: null,
    scores: null,
    futBon: null,
    lockedCells: null,
    bonusSqUsed: null,
    bBoardData: null,
    turn: 0,
    firstMove: false,
    passCount: 0,
    moveCount: 0,
    placed: [],
    selTile: null,
    selPlaced: null,
    dir: 'H',
    botBusy: false,
    bonusPend: null,
    lastMoveCells: [],
    lastRejWord: '',
    lastRejScore: 0,
    lastRejPlaced: [],
    exchUsed: false,
    replacedThisTurn: null,
    pendingReview: null,
    appealsUsed: [0, 0],
    jokerTarget: null,
    pendingLockCell: null,
    lockInventory: [[], []],
    bonusAssignment: [],
    setOnlineTurnDeadline: () => {},
    setLocalTurnDeadline: () => {},
    initBag: () => {},
    draw: () => {},
    buildUnifiedGrid: () => {},
    renderBoard: () => {},
    renderRack: () => {},
    renderBonusStrips: () => {},
    updateUI: () => {},
    setS: () => {},
    myTurnMsg: () => 'תורך',
    startMoveTimer: () => { startedTimer++; },
    scheduleBotMove: () => { scheduled++; }
  });

  ctx.initGame(1);
  assert.equal(ctx.turn, 1);
  assert.equal(scheduled, 1);
  assert.equal(startedTimer, 0);
});

test('initGame in online mode before both players joined does not start timer', () => {
  let startedTimer = 0;
  let statusMsg = '';
  const ctx = buildContextWith(['initGame'], {
    BS: 10,
    BDEFS: Array.from({ length: 12 }, (_, i) => ({ id: i })),
    BONUS_TYPES: [{ type: 'B1', ic: '⚡' }, { type: 'B2', ic: '🎁' }],
    Math,
    gMode: 'online',
    onlineCoinJoinStarted: false,
    bData: null,
    racks: null,
    scores: null,
    futBon: null,
    lockedCells: null,
    bonusSqUsed: null,
    bBoardData: null,
    turn: 0,
    firstMove: false,
    passCount: 0,
    moveCount: 0,
    placed: [],
    selTile: null,
    selPlaced: null,
    dir: 'H',
    botBusy: false,
    bonusPend: null,
    lastMoveCells: [],
    lastRejWord: '',
    lastRejScore: 0,
    lastRejPlaced: [],
    exchUsed: false,
    replacedThisTurn: null,
    pendingReview: null,
    appealsUsed: [0, 0],
    jokerTarget: null,
    pendingLockCell: null,
    lockInventory: [[], []],
    bonusAssignment: [],
    setOnlineTurnDeadline: () => {},
    setLocalTurnDeadline: () => {},
    initBag: () => {},
    draw: () => {},
    buildUnifiedGrid: () => {},
    renderBoard: () => {},
    renderRack: () => {},
    renderBonusStrips: () => {},
    updateUI: () => {},
    clearMoveTimer: () => {},
    setS: (msg) => { statusMsg = msg; },
    myTurnMsg: () => 'תורך',
    startMoveTimer: () => { startedTimer++; },
    scheduleBotMove: () => {}
  });

  ctx.initGame(0);
  assert.equal(startedTimer, 0);
  assert.equal(statusMsg, 'ממתין להצטרפות שחקנים...');
});

test('getCoinWinnerLabel maps opening player to the player name', () => {
  const ctx = buildContextWith(['getCoinWinnerLabel'], {
    pNames: ['רות', 'דן']
  });
  assert.equal(ctx.getCoinWinnerLabel(0), 'רות');
  assert.equal(ctx.getCoinWinnerLabel(1), 'דן');
});

test('isPresenceConsideredOnline supports legacy and grace-period presence payloads', () => {
  const ctx = buildContextWith(['isPresenceConsideredOnline'], {
    PRESENCE_GRACE_MS: 35000
  });

  assert.equal(ctx.isPresenceConsideredOnline(true, 1000), true);
  assert.equal(ctx.isPresenceConsideredOnline({ connected: true, lastSeen: 1000 }, 2000), true);
  assert.equal(ctx.isPresenceConsideredOnline({ connected: false, lastSeen: 90000 }, 120000), true);
  assert.equal(ctx.isPresenceConsideredOnline({ connected: false, lastSeen: 1000 }, 50000), false);
  assert.equal(ctx.isPresenceConsideredOnline(null, 50000), false);
});

test('isPresenceConsideredOnline treats stale object payloads as offline', () => {
  const ctx = buildContextWith(['isPresenceConsideredOnline'], {
    PRESENCE_GRACE_MS: 35000
  });

  assert.equal(ctx.isPresenceConsideredOnline({ background: true }, 100000), false);
  assert.equal(ctx.isPresenceConsideredOnline({ connected: false, lastSeen: 0 }, 100000), false);
});

test('shouldStartAbsentLossCountdown starts only after two missed turns while offline', () => {
  const ctx = buildContextWith(['shouldStartAbsentLossCountdown']);
  assert.equal(ctx.shouldStartAbsentLossCountdown(0, false), false);
  assert.equal(ctx.shouldStartAbsentLossCountdown(1, false), false);
  assert.equal(ctx.shouldStartAbsentLossCountdown(2, true), false);
  assert.equal(ctx.shouldStartAbsentLossCountdown(2, false), true);
  assert.equal(ctx.shouldStartAbsentLossCountdown(3, false), true);
});

test('computeExpiredOnlineTurnState advances turn and increments missed turn counter', () => {
  const ctx = buildContextWith(['computeExpiredOnlineTurnState'], {
    firebase: { database: { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } } }
  });
  const next = ctx.computeExpiredOnlineTurnState(
    { turn: 0, passCount: 2, moveCount: 7, missedTurns: { 0: 1, 1: 0 } },
    1000,
    20000
  );
  assert.equal(next.turn, 1);
  assert.equal(next.passCount, 3);
  assert.equal(next.moveCount, 8);
  assert.equal(next.turnDeadlineMs, 21000);
  assert.equal(JSON.stringify(next.missedTurns), JSON.stringify({ 0: 2, 1: 0 }));
});

test('shouldClaimExpiredOnlineTurn waits through grace period to avoid deadline races', () => {
  const ctx = buildContextWith(['shouldClaimExpiredOnlineTurn']);
  const state = { turn: 0, turnDeadlineMs: 10_000 };

  assert.equal(ctx.shouldClaimExpiredOnlineTurn(state, 1, 10_999, 1_000), false);
  assert.equal(ctx.shouldClaimExpiredOnlineTurn(state, 1, 11_000, 1_000), true);
  assert.equal(ctx.shouldClaimExpiredOnlineTurn(state, 0, 20_000, 1_000), false);
  assert.equal(ctx.shouldClaimExpiredOnlineTurn({ turn: 0, turnDeadlineMs: 0 }, 1, 20_000, 1_000), false);
});

test('getFirstTurnAnnouncement includes selected player name', () => {
  const ctx = buildContextWith(['getCoinWinnerLabel', 'getFirstTurnAnnouncement'], {
    pNames: ['רות', 'דן']
  });
  assert.equal(ctx.getFirstTurnAnnouncement(0), 'רות מתחיל ראשון!');
  assert.equal(ctx.getFirstTurnAnnouncement(1), 'דן מתחיל ראשון!');
});

test('renderRack shows side racks only in 1v1 mode', () => {
  const byId = new Map();
  const getEl = (id) => {
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        innerHTML: '',
        style: {},
        children: [],
        appendChild(node) { this.children.push(node); },
      });
    }
    return byId.get(id);
  };
  const document = {
    getElementById: getEl,
    createElement: () => ({
      className: '',
      innerHTML: '',
      style: {},
      addEventListener: () => {},
    })
  };

  const sideCalls = [];
  const clearCalls = [];
  const ctx = buildContextWith(['renderRack'], {
    gMode: 'bot',
    turn: 0,
    selTile: null,
    racks: [['א', 'ב'], ['ג', 'ד']],
    HV: {},
    document,
    computeSizes: () => {},
    _renderSideRack: (player, anim) => sideCalls.push({ player, anim }),
    _clearSideRack: (player) => clearCalls.push(player),
  });

  ctx.renderRack('turn');
  assert.equal(sideCalls.length, 0);
  assert.deepEqual(clearCalls, [0, 1]);

  sideCalls.length = 0;
  clearCalls.length = 0;
  ctx.gMode = 'vs';
  ctx.renderRack('turn');
  assert.equal(sideCalls.length, 2);
  assert.deepEqual(sideCalls.map((s) => s.player), [0, 1]);
  assert.equal(clearCalls.length, 0);
});

test('showOnlineCoinToss requires explicit join click for online game entry', () => {
  const timers = [];
  const mkEl = () => ({
    textContent: '',
    style: {},
    classList: {
      add: () => {},
      remove: () => {}
    },
    offsetWidth: 0
  });
  const byId = new Map([
    ['coin-disc', mkEl()],
    ['coin-sub', mkEl()],
    ['coin-msg', mkEl()],
    ['coin-enter', mkEl()]
  ]);

  let shownScreen = null;
  let doneCalled = 0;
  const ctx = buildContextWith(
    ['getCoinWinnerLabel', 'getFirstTurnAnnouncement', 'showOnlineCoinToss'],
    {
      pNames: ['רות', 'דן'],
      pendingStartingTurn: null,
      showSc: (id) => { shownScreen = id; },
      document: { getElementById: (id) => byId.get(id) },
      setTimeout: (fn, _ms) => { timers.push(fn); return timers.length; }
    }
  );

  ctx.showOnlineCoinToss(1, () => { doneCalled++; });
  assert.equal(shownScreen, 'scoin');
  assert.equal(byId.get('coin-enter').style.display, '');
  assert.equal(byId.get('coin-enter').textContent, 'הצטרף');
  assert.equal(byId.get('coin-enter').disabled, true);
  assert.equal(ctx.pendingStartingTurn, 1);

  while (timers.length) timers.shift()();

  assert.equal(ctx.pendingStartingTurn, 1);
  assert.equal(byId.get('coin-disc').textContent, 'דן');
  assert.match(byId.get('coin-msg').textContent, /דן מתחיל ראשון!/);
  assert.equal(byId.get('coin-sub').textContent, 'לחצו "הצטרף" כדי להיכנס למשחק');
  assert.equal(byId.get('coin-enter').disabled, false);
  assert.equal(doneCalled, 1);
});

test('beginOnlineGameAfterBothReady starts timer only when current player is local', () => {
  let shownScreen = null;
  let startedTimer = 0;
  let setStatus = '';
  const ctx = buildContextWith(
    ['beginOnlineGameAfterBothReady'],
    {
      onlineCoinJoinStarted: false,
      onlineCoinJoinReady: { host: true, guest: true },
      pendingStartingTurn: 1,
      gameSettings: { music: false, timelimit: true },
      musicPlaying: false,
      myRole: 'guest',
      turn: 1,
      pNames: ['רות', 'דן'],
      onlineMode: 'live',
      roomCode: '123456',
      showSc: (id) => { shownScreen = id; },
      computeSizes: () => {},
      renderBoard: () => {},
      renderBonusStrips: () => {},
      updateUI: () => {},
      renderRack: () => {},
      saveOnlineSession: () => {},
      setupPresence: () => {},
      listenForRoomStatus: () => {},
      listenForMoves: () => {},
      myTurnMsg: () => 'תורך — בחר אות מהמגש',
      setS: (msg) => { setStatus = msg; },
      startMoveTimer: () => { startedTimer++; },
      setTimeout: (fn, _ms) => { fn(); return 1; },
      fbRef: () => ({ set: () => ({ catch: () => {} }) })
    }
  );

  ctx.beginOnlineGameAfterBothReady();
  assert.equal(shownScreen, 'sg');
  assert.equal(startedTimer, 1);
  assert.equal(setStatus, 'תורך — בחר אות מהמגש');
  assert.equal(ctx.onlineCoinJoinStarted, true);
  assert.equal(ctx.pendingStartingTurn, null);
});

test('startOnlineGame host publishes state before starting coin toss animation', () => {
  assert.match(
    source,
    /fbRef\('rooms\/' \+ roomCode \+ '\/state'\)\.set\(serializeGameState\(\)\)[\s\S]*showOnlineCoinToss\(starter/,
    'expected online host flow to publish room state before running coin toss animation'
  );
});

test('waitingMsg shows opponent name in online mode and fallback elsewhere', () => {
  const onlineCtx = buildContextWith(['waitingMsg'], {
    gMode: 'online',
    pNames: ['רות', 'דן'],
    window: { _myPlayerIndex: 0 }
  });
  assert.equal(onlineCtx.waitingMsg(), 'ממתין ל-דן...');

  const localCtx = buildContextWith(['waitingMsg'], {
    gMode: 'vs',
    pNames: ['רות', 'דן'],
    window: {}
  });
  assert.equal(localCtx.waitingMsg(), 'המתן לתורך');
});
