// Leave-game cleanup parity vs. legacy goHome().
//
// Legacy authority (HEAD:index.html):
//   - goHome() at line 4072: clearT(); clearMoveTimer(); clearBotThinkTimeout();
//     stopMusic(); closes ~27 overlays; showSc('sh').
//   - Timer / bot globals at lines 3306-3308: moveTimerInt, botThinkTimeout,
//     onlineTimerRenderInt, onlineTimeoutWatchdogInt.
//
// Player-visible invariant we assert: after teardown (back-to-home, pause
// quit, etc.) no stale timer, bot delay, or online listener can mutate
// game state. Even if a fake clock is advanced past the bot's think delay
// or past the turn deadline, scores / racks / board / turn must remain
// frozen at the moment of teardown.

const test = require('node:test');
const assert = require('node:assert/strict');

let modulesPromise;
function loadModules() {
  modulesPromise ??= Promise.all([
    import('../../src/events/bus.js'),
    import('../../src/events/commands.js'),
    import('../../src/events/eventTypes.js'),
    import('../../src/game/core/hebrewDictionary.js'),
    import('../../src/game/sessions/localGameSession.js'),
    import('../../src/game/sessions/botGameSession.js'),
    import('../../src/ui/controllers/turnTimerController.js'),
  ]).then(([bus, commands, events, dict, localSession, botSession, timer]) => ({
    bus, commands, events, dict, localSession, botSession, timer,
  }));
  return modulesPromise;
}

const PLAYERS = { 0: { uid: 'a', displayName: 'A' }, 1: { uid: 'b', displayName: 'B' } };

function snapshot(state) {
  return {
    rack0: [...state.racks[0]],
    rack1: [...state.racks[1]],
    bagLen: state.bag.length,
    score0: state.scores[0],
    score1: state.scores[1],
    turnSlot: state.currentTurnSlot,
    turnNumber: state.turnNumber,
    passCount: state.passCount,
    moveCount: state.moveCount,
    status: state.status,
  };
}

// ───────────────────────────────────────────────────────────────────────
// 1. Bot game: leave while bot is "thinking" → scheduler must not fire.
// Legacy clearBotThinkTimeout() clears the pending bot delay. Spine
// equivalent: session.dispose() must cancel attachBotPlayer's pending
// scheduler handle.
test('parity: leaving mid-bot-think cancels the pending scheduler so no move is dispatched', async () => {
  const m = await loadModules();
  m.bus._reset();
  m.dict.DICT.clear();
  m.dict.addWordsFromText('אב\n');

  const session = m.localSession.createLocalGameSession({
    bus: m.bus,
    mode: 'offline-solo',
    tileBagSeed: 'leave-bot',
    players: PLAYERS,
    startingSlot: 1, // bot starts
  });
  session.state.racks[0] = ['ת','ת','ת','ת','ת','ת','ת','ת'];
  session.state.racks[1] = ['א','ב','ג','ד','ה','ו','ז','ח'];

  // Mock scheduler: store the callback, return a handle, allow cancel.
  const scheduled = new Map();
  let nextId = 1;
  const scheduler = (fn, ms) => {
    const id = nextId++;
    scheduled.set(id, { fn, ms, cancelled: false });
    return id;
  };
  const cancelScheduler = (id) => {
    const entry = scheduled.get(id);
    if (entry) entry.cancelled = true;
  };

  m.botSession.attachBotPlayer(session, {
    slot: 1,
    wordList: ['אב'],
    isWordValid: () => true,
    thinkingMs: 3000,
    scheduler,
    cancelScheduler,
  });

  session.start();
  assert.equal(scheduled.size, 1, 'bot scheduled a think-timeout on its turn');
  const before = snapshot(session.state);

  // ─ Player presses back-to-home: simulate gameFlowController's endActiveGame().
  session.dispose();

  // Fire all outstanding scheduled callbacks as if the clock advanced.
  for (const entry of scheduled.values()) {
    assert.equal(entry.cancelled, true, 'pending bot timeout was cancelled by session.dispose');
    if (!entry.cancelled) entry.fn(); // would-be bot move; cancelled means we skip it
  }

  // No move/pass should have been applied — engine state frozen at teardown.
  assert.deepEqual(snapshot(session.state), before, 'state untouched after teardown + clock advance');
});

// ───────────────────────────────────────────────────────────────────────
// 2. Turn timer: leave the game; timer must not auto-pass anyone afterwards.
// Legacy clearMoveTimer() halts moveTimerInt. Spine equivalent: timer
// controller's sessionRef returns null after teardown, so sync() early-exits
// without dispatching PASS_TURN.
test('parity: turn timer dispatches no PASS_TURN once the active game is torn down', async () => {
  const m = await loadModules();
  m.bus._reset();
  m.dict.DICT.clear();
  m.dict.addWordsFromText('אב\n');

  const session = m.localSession.createLocalGameSession({
    bus: m.bus,
    mode: 'offline-2p',
    tileBagSeed: 'leave-timer',
    players: PLAYERS,
    settings: { timelimit: true, botTime: 20 },
  });
  session.state.racks[0] = ['א','ב','ג','ד','ה','ו','ז','ח'];
  session.state.racks[1] = ['ט','י','כ','ל','מ','נ','ס','ע'];

  const dispatched = [];
  const origDispatch = session.dispatch.bind(session);
  session.dispatch = (cmd) => { dispatched.push(cmd); origDispatch(cmd); };

  let nowMs = 1_000_000;
  let activeRef = session; // simulates activeGame.session ref

  const t = m.timer.createTurnTimerController({
    bus: m.bus,
    root: { querySelector: () => ({ textContent: '', classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} } }) },
    sessionRef: () => activeRef,
    now: () => nowMs,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });

  // First sync installs a fresh deadline (botTime=20 ⇒ 20s).
  // Tear down the activeGame BEFORE the deadline expires.
  const before = snapshot(session.state);
  activeRef = null;       // gameFlowController.endActiveGame() ⇒ activeGame = null
  session.dispose();

  // Advance clock 60s into the future — well past where the deadline would have fired.
  nowMs += 60_000;
  t.sync();

  assert.equal(
    dispatched.filter(c => c.type === m.commands.CMD.PASS_TURN).length,
    0,
    'no PASS_TURN dispatched after activeGame teardown'
  );
  assert.deepEqual(snapshot(session.state), before, 'engine state unchanged across teardown + clock advance');
  t.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 3. Bus listener invariant: a TURN_CHANGED event manually fired after
// session.dispose() must NOT trigger the bot. Catches a regression where
// attachBotPlayer keeps a listener attached past teardown.
test('parity: bus listeners are detached so a stray TURN_CHANGED does not wake the bot', async () => {
  const m = await loadModules();
  m.bus._reset();
  m.dict.DICT.clear();
  m.dict.addWordsFromText('אב\n');

  const session = m.localSession.createLocalGameSession({
    bus: m.bus,
    mode: 'offline-solo',
    tileBagSeed: 'leave-stray',
    players: PLAYERS,
  });
  session.state.racks[1] = ['א','ב','ג','ד','ה','ו','ז','ח'];

  let botActed = 0;
  m.bus.on(m.events.EV.MOVE_CONFIRMED, () => { botActed++; });
  m.bus.on(m.events.EV.TURN_CHANGED, () => { /* observer only */ });

  m.botSession.attachBotPlayer(session, {
    slot: 1,
    wordList: ['אב'],
    isWordValid: () => true,
    thinkingMs: 0,
    scheduler: (fn) => fn(), // sync
  });
  session.dispose();

  // Manually emit TURN_CHANGED for slot 1 — bot listener should be gone.
  m.bus.emit(m.events.EV.TURN_CHANGED, { currentTurnSlot: 1, turnNumber: 2 });
  assert.equal(botActed, 0, 'bot did not act on a post-dispose TURN_CHANGED');
});
