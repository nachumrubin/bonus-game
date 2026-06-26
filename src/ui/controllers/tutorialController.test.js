import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { EV } from '../../events/eventTypes.js';
import { MENU_INTENT } from '../screens/menuScreen.js';
import { TUTORIAL_INTENT, TUTORIAL_OPEN, TUTORIAL_TIP, TUTORIAL_CLEAR } from '../screens/tutorialScreen.js';
import { GAME_SCREEN_INTENT } from '../screens/gameScreen.js';
import { DICT_INTENT } from '../screens/dictionaryScreen.js';
import { createTutorialController } from './tutorialController.js';
import { BONUS_RESOLVED } from './bonusActivationController.js';
import { TUTORIAL_BONUS_CELL } from '../../game/sessions/tutorialSession.js';

test('menu replay opens the tutorial intro and start launches tutorial game', () => {
  bus._reset();
  let opened = 0;
  let starts = 0;
  const storage = new Map();
  bus.on(TUTORIAL_OPEN, () => { opened++; });
  createTutorialController({
    bus,
    startTutorialGame: () => { starts++; },
    storage: { setItem: (k, v) => storage.set(k, v) },
  });

  bus.emit(MENU_INTENT.OPEN_TUTORIAL, {});
  bus.emit(TUTORIAL_INTENT.START, {});
  assert.equal(opened, 1);
  assert.equal(starts, 1);
  assert.equal(storage.get('bonusGameTutSeen'), '1');
});

test('GAME_STARTED emits singleTile tip first', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  assert.equal(tips.length, 1);
  assert.ok(tips[0].selectors.includes('#c5_6'), 'singleTile tip points at (5,6)');
  assert.ok(tips[0].selectors.includes('#brack[letter=ש]'));
});

test('placing a tile advances to recallDemo, recalling advances to first', () => {
  bus._reset();
  const tips = [];
  const clears = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  bus.on('tutorial/clear', () => clears.push(true));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  assert.equal(tips.length, 1); // singleTile tip

  // Player places one tile
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, {
    slot: 0,
    tiles: [{ r: 5, c: 6, letter: 'ש' }],
  });
  assert.equal(tips.length, 2);
  assert.ok(tips[1].selectors.includes('#btn-recall'), 'recallDemo tip points at recall button');

  // Player recalls (tiles go back to empty)
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, { slot: 0, tiles: [] });
  assert.equal(tips.length, 3);
  assert.ok(tips[2].selectors.includes('#c5_6'), 'first-move tip points at first cell');
  assert.ok(tips[2].selectors.includes('#c5_9'), 'first-move tip covers all 4 cells');
});

test('placing all 4 tiles shows dictQuery tip; DICT_INTENT.CHECK_QUERY advances to שבץ', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  // Skip singleTile / recallDemo by forcing to first state via recall
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, { slot: 0, tiles: [{ r: 5, c: 6, letter: 'ש' }] });
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, { slot: 0, tiles: [] });

  const tipsBefore = tips.length;

  // All 4 tiles placed → dictQuery tip
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, {
    slot: 0,
    tiles: [
      { r: 5, c: 6, letter: 'ש' },
      { r: 5, c: 7, letter: 'ל' },
      { r: 5, c: 8, letter: 'ו' },
      { r: 5, c: 9, letter: 'מ' },
    ],
  });
  assert.equal(tips.length, tipsBefore + 1, 'dictQuery tip shown when all 4 placed');
  assert.ok(tips[tips.length - 1].selectors.includes('#btn-shailta'), 'dictQuery tip highlights שאילתה button');

  // Opening the dictionary does NOT advance the tip — player must click בדוק
  bus.emit(DICT_INTENT.OPEN_QUERY, {});
  assert.equal(tips.length, tipsBefore + 1, 'play tip not shown on dictionary open');

  // Player clicks בדוק → play-button tip shown
  bus.emit(DICT_INTENT.CHECK_QUERY, { word: 'שלום' });
  assert.equal(tips.length, tipsBefore + 2, 'play tip shown after בדוק click');
  assert.ok(tips[tips.length - 1].selectors.includes('#btn-play'), 'play tip highlights שבץ button');
});

test('removing a tile after dictQuery tip reverts to firstMove tip', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  // Fast-path: skip singleTile/recall
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, { slot: 0, tiles: [{ r: 5, c: 6, letter: 'ש' }] });
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, { slot: 0, tiles: [] });

  // All 4 placed → dictQuery tip
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, {
    slot: 0,
    tiles: [
      { r: 5, c: 6, letter: 'ש' },
      { r: 5, c: 7, letter: 'ל' },
      { r: 5, c: 8, letter: 'ו' },
      { r: 5, c: 9, letter: 'מ' },
    ],
  });
  const afterDict = tips.length;

  // Player removes one tile
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, {
    slot: 0,
    tiles: [
      { r: 5, c: 6, letter: 'ש' },
      { r: 5, c: 7, letter: 'ל' },
      { r: 5, c: 8, letter: 'ו' },
    ],
  });
  assert.equal(tips.length, afterDict + 1, 'firstMove tip re-emitted');
  assert.ok(tips[tips.length - 1].selectors.includes('#c5_9'), 'reverts to firstMove tip');
});

test('full tutorial flow: שלום → illegalInfo → exchange → lockInfo → lock placement → bot3 parallel words → bonus → BONUS_RESOLVED', () => {
  bus._reset();
  const tips = [];
  const clears = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  bus.on('tutorial/clear', () => clears.push(true));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });

  // --- player confirms שלום ---
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, words: ['שלום'] });
  assert.ok(clears.length >= 1, 'tip cleared while bot thinks');

  // --- bot plays לב (move 1) → illegalInfo ---
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['לב'] });
  const afterBot1 = tips.length;
  assert.ok(afterBot1 >= 1, 'illegalInfo tip emitted after bot move 1');
  assert.equal(tips[afterBot1 - 1].label, 'מהלך לא חוקי', 'tip is the illegal-move info tip');
  assert.ok(tips[afterBot1 - 1].showNext, 'illegalInfo tip has הבא button');

  // --- player taps הבא → exchange prompt ---
  bus.emit(TUTORIAL_INTENT.NEXT, {});
  assert.equal(tips[tips.length - 1].label, 'החלפת אות', 'הבא on illegalInfo shows exchangeTip');

  // --- player exchanges a tile ---
  bus.emit(EV.TILES_EXCHANGED, { slot: 0, count: 1 });
  assert.equal(tips[tips.length - 1].label, 'תור היריב', 'waiting-for-bot tip shown after exchange');

  // --- bot plays תו (move 2) → lockInfo ---
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['תו'] });
  const afterBot2 = tips.length;
  assert.ok(afterBot2 > afterBot1, 'lockInfo tip emitted after bot move 2');
  assert.equal(tips[afterBot2 - 1].label, 'נעילת משבצת', 'lockInfo tip shown');
  assert.ok(tips[afterBot2 - 1].showNext, 'lockInfo tip has הבא button');
  assert.ok(tips[afterBot2 - 1].selectors.some(s => s.includes('lock-inv-display')), 'lockInfo highlights lock button');

  // --- player places the lock (LOCK_PLACED at lockInfo step) → waitForBot3 ---
  bus.emit(EV.LOCK_PLACED, { slot: 0, lock: { r: 7, c: 7 } });
  assert.ok(clears.length >= 2, 'tip cleared after lock placement');

  // --- bot plays ת at (6,8) (move 3) forming "בת" + "תות" → parallelWords ---
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['בת', 'תות'] });
  const afterBot3 = tips.length;
  assert.ok(afterBot3 > afterBot2, 'parallelWords tip emitted after bot move 3');
  assert.equal(tips[afterBot3 - 1].label, 'מילים מקבילות', 'parallelWords tip shown');
  assert.ok(tips[afterBot3 - 1].showNext, 'parallelWords tip has הבא button');

  // --- player taps הבא → bonus tip ---
  bus.emit(TUTORIAL_INTENT.NEXT, {});
  assert.equal(tips[tips.length - 1].label, 'משבצות בוסט', 'הבא on parallelWords shows bonus tip');

  // --- player places 'י' on the bonus square and confirms ---
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, words: ['שלומי'] });
  assert.equal(tips.filter(t => t.label === 'כל הכבוד!').length, 0,
    'completion tip not shown before BONUS_RESOLVED');

  // --- mini-game completes → completion tip ---
  bus.emit(BONUS_RESOLVED, { kind: 'minigame', slot: 0, success: true, earnedPts: 40 });
  assert.equal(tips[tips.length - 1].label, 'כל הכבוד!', 'completion tip shown after BONUS_RESOLVED');
  assert.match(tips[tips.length - 1].text, /הפעלת בוסט/);
  assert.ok(!tips[tips.length - 1].autoCloseMs, 'completion tip stays until dismissed');
});

test('bot move 2 after exchange triggers lockTip with interactive selectors', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, words: ['שלום'] });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['לב'] });
  bus.emit(EV.TILES_EXCHANGED, { slot: 0, count: 1 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['תו'] });

  const lockTip = tips.find(t => t.label === 'נעילת משבצת');
  assert.ok(lockTip, 'lock tip emitted when bot plays 2nd move after exchange');
  assert.ok(lockTip.selectors.length > 0, 'lockTip has selectors (interactive)');
});

test('bonus step live-preview: placing the bonus tile shows שבץ tip; removing it reverts to bonus tip', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  // Fast-path to the bonus step via: שלום → bot1 → exchange → bot2 → lock → bot3 → הבא
  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, words: ['שלום'] });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['לב'] });
  bus.emit(EV.TILES_EXCHANGED, { slot: 0, count: 1 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['תו'] });
  bus.emit(EV.LOCK_PLACED, { slot: 0, lock: { r: 7, c: 7 } });   // player places lock
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['בת', 'תות'] }); // bot move 3
  bus.emit(TUTORIAL_INTENT.NEXT, {});                              // הבא → bonus tip

  const bonusTipIdx = tips.findIndex(t => t.label === 'משבצות בוסט');
  assert.ok(bonusTipIdx >= 0, 'bonus tip shown at start of bonus step');

  // Player places the bonus tile → play tip
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, {
    slot: 0,
    tiles: [{ r: TUTORIAL_BONUS_CELL.r, c: TUTORIAL_BONUS_CELL.c, letter: 'י' }],
  });
  assert.equal(tips[tips.length - 1].label, 'אישור', 'play tip shown when bonus cell occupied');

  // Player removes it → bonus tip reverts
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, { slot: 0, tiles: [] });
  assert.equal(tips[tips.length - 1].label, 'משבצות בוסט', 'bonus tip restored when tile removed');
});

test('TUTORIAL_INTENT.NEXT: illegalInfo→exchangePrompt, lockInfo→bonus (skip lock), parallelWords→bonus', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, words: ['שלום'] });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['לב'] });
  assert.equal(tips[tips.length - 1].label, 'מהלך לא חוקי');

  // הבא on illegalInfo → exchangePrompt
  bus.emit(TUTORIAL_INTENT.NEXT, {});
  assert.equal(tips[tips.length - 1].label, 'החלפת אות', 'הבא on illegalInfo shows exchangeTip');

  // Exchange → bot2 → lockInfo
  bus.emit(EV.TILES_EXCHANGED, { slot: 0, count: 1 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['תו'] });
  assert.equal(tips[tips.length - 1].label, 'נעילת משבצת');

  // הבא on lockInfo → bonus (player chose to skip the lock step)
  bus.emit(TUTORIAL_INTENT.NEXT, {});
  assert.equal(tips[tips.length - 1].label, 'משבצות בוסט', 'הבא on lockInfo skips to bonus');

  // Now test parallelWords→bonus via a second independent controller
  bus._reset();
  const tips2 = [];
  bus.on(TUTORIAL_TIP, (p) => tips2.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });
  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, words: ['שלום'] });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['לב'] });
  bus.emit(EV.TILES_EXCHANGED, { slot: 0, count: 1 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['תו'] });
  bus.emit(EV.LOCK_PLACED, { slot: 0, lock: { r: 7, c: 7 } });    // lock placement
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['בת'] });         // bot move 3
  assert.equal(tips2[tips2.length - 1].label, 'מילים מקבילות', 'parallelWords tip shown');

  // הבא on parallelWords → bonus
  bus.emit(TUTORIAL_INTENT.NEXT, {});
  assert.equal(tips2[tips2.length - 1].label, 'משבצות בוסט', 'הבא on parallelWords advances to bonus');
});

test('illegal-word rejection during illegalInfo advances to botSecond so bot-move-2 triggers lockTip', () => {
  bus._reset();
  const tips = [];
  const clears = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  bus.on(TUTORIAL_CLEAR, () => clears.push(true));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, words: ['שלום'] });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['לב'] });

  assert.ok(tips[tips.length - 1].label === 'מהלך לא חוקי', 'illegalInfo tip shown');
  const clearsBeforeRejection = clears.length;

  // Player tries a non-dict word → engine rejects → tutorial advances to botSecond
  bus.emit(EV.INVALID_MOVE_REJECTED, { reason: 'word-not-in-dictionary' });
  assert.ok(clears.length > clearsBeforeRejection, 'tip cleared on rejection');

  // ~2s later (1100ms auto-pass + 900ms think): bot plays ת (2nd scripted move)
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['תו'] });
  assert.ok(tips[tips.length - 1].label === 'נעילת משבצת', 'lockTip shown after bot-move-2');
  assert.ok(tips[tips.length - 1].showNext, 'lockTip has הבא button');
});

test('illegal-word rejection during exchangePrompt also advances correctly', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, words: ['שלום'] });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['לב'] });
  // Player clicks הבא → goes to exchangePrompt
  bus.emit(TUTORIAL_INTENT.NEXT, {});
  assert.ok(tips[tips.length - 1].label === 'החלפת אות');

  // Player tries illegal move instead of exchanging
  bus.emit(EV.INVALID_MOVE_REJECTED, { reason: 'word-not-in-dictionary' });

  // Bot plays ת after auto-pass
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['תו'] });
  assert.ok(tips[tips.length - 1].label === 'נעילת משבצת', 'lockTip shown even when illegal move happened from exchangePrompt step');
});
