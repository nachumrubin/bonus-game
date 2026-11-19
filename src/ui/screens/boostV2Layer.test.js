// boostV2Layer — presentation helpers + the hooks driving a real local
// Boost 2.0 session through the controller (no DOM needed).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { EV } from '../../events/eventTypes.js';
import { createLocalGameSession } from '../../game/sessions/localGameSession.js';
import { createGameController } from '../controllers/gameController.js';
import { mountBoostV2Layer, markerHTML, cardHTML, badgeFor, sheetModel, breakdownRows, escapeHtml } from './boostV2Layer.js';
import { DICT, addWordsFromText } from '../../game/core/hebrewDictionary.js';
import { HV } from '../../game/core/letterDistribution.js';
import { getRules } from '../../game/boostV2/rulesConfig.js';
import { longWord, letterHunt, wordEdge, powerWord, bridgeBuilder, tileMaster } from '../../game/boostV2/challengeCatalog.js';
import { createRng } from '../../util/rng.js';
import { PHASE } from '../../game/boostV2/matchStateV2.js';

const _log = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _log; });

const RULES = getRules();
const nullRoot = { querySelector: () => null, querySelectorAll: () => [] };

test('marker + card: icon only, difficulty as the border class; level and reward only in the accessible label', () => {
  const html = markerHTML(longWord(RULES, 'MEDIUM'));
  assert.match(html, /v2-mk--medium/);
  assert.doesNotMatch(html, /◆/);
  assert.match(html, /v2-ic--long_word/);
  assert.match(html, />6\+<\/text>/);
  assert.doesNotMatch(html, /\+10</);
  assert.doesNotMatch(cardHTML(longWord(RULES, 'MEDIUM')).split('aria-hidden="true"><b>')[1], /בינוני|\+10/);
  assert.match(cardHTML(longWord(RULES, 'MEDIUM')), /v2-card--medium/);
  assert.match(html, /aria-label="מילה ארוכה, בינוני, 10 נקודות"/);
  assert.match(markerHTML(letterHunt(RULES, 'EASY', 'ל'), 'is-pending'), /v2-mk--easy is-pending/);
});

test('badges: letters read RTL, numbers LTR; Power Word shows N+', () => {
  assert.deepEqual(badgeFor(wordEdge(RULES, 'HARD', 'ע', 'START')), { text: 'ע…', dir: 'rtl' });
  assert.deepEqual(badgeFor(wordEdge(RULES, 'EASY', 'ת', 'END')), { text: '…ת', dir: 'rtl' });
  assert.deepEqual(badgeFor(tileMaster(RULES, 'MEDIUM')), { text: '×5', dir: 'ltr' });
  assert.equal(badgeFor(powerWord(RULES, 'MEDIUM')).text, '12+');
  assert.equal(badgeFor(bridgeBuilder(RULES)).text, '⇄');
});

test('card + sheet content come from the definition', () => {
  const card = cardHTML(letterHunt(RULES, 'EASY', 'ל'));
  assert.match(card, /ציד אותיות/);
  assert.match(card, /v2-ic--letter_hunt/);
  assert.match(card, />ל<\/text>/);
  assert.doesNotMatch(card, /v2-icon-slot/);
  const m = sheetModel(longWord(RULES, 'MEDIUM'));
  assert.equal(m.name, 'מילה ארוכה');
  assert.equal(m.level, 'בינוני');
  assert.equal(m.reward, 10);
  assert.equal(m.example, 'מחשבים');
  assert.ok(m.notes.some(n => n.includes('אותיות שכבר על הלוח')));
  assert.ok(sheetModel(letterHunt(RULES, 'EASY', 'ל')).notes.some(n => n.includes('ג׳וקר')));
  assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});

test('breakdown rows: words, completed (✓ +R), failed (✗ 0), full rack', () => {
  const lw = longWord(RULES, 'MEDIUM'), lh = letterHunt(RULES, 'EASY', 'ל');
  const rows = breakdownRows({
    words: [{ text: 'מחשבים' }, { text: 'שם' }], baseScore: 18, fullRackBonus: 25,
    boostResults: [
      { definitionId: lw.definitionId, completed: true, reward: 10 },
      { definitionId: lh.definitionId, completed: false, reward: 0 },
    ],
  }, { [lw.definitionId]: lw, [lh.definitionId]: lh });
  assert.deepEqual(rows.map(r => [r.kind, r.label, r.value]), [
    ['words', 'מילים · מחשבים, שם', 18],
    ['ok', '✓ מילה ארוכה', 10],
    ['fail', '✗ ציד אותיות', 0],
    ['rack', 'בונוס מגש מלא · 8 אריחים', 25],
  ]);
});

// ── integration: session + controller + layer hooks ───────────────────────
function setRack(state, slot, letters) {
  state.bag.push(...state.racks[slot]);
  state.racks[slot] = [];
  for (const l of letters) state.racks[slot].push(state.bag.splice(state.bag.lastIndexOf(l), 1)[0]);
}

function startMatch() {
  bus._reset();
  DICT.clear();
  addWordsFromText(['לא', 'אב', 'של', 'בא'].join('\n'));
  const session = createLocalGameSession({
    bus, mode: 'offline-2p', tileBagSeed: 'layer-test', startingSlot: 0,
    players: { 0: { uid: 'p0', displayName: 'דנה' }, 1: { uid: 'p1', displayName: 'יואב' } },
    ruleset: 'BOOST_V2', boostQueueRng: createRng('layer-q'),
  });
  const controller = createGameController({ bus, session, mySlot: null });
  const timers = [];
  const layer = mountBoostV2Layer({
    root: nullRoot, bus, controller, getState: () => session.state,
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {},
  });
  session.start();
  return { session, controller, layer, h: layer.hooks };
}

const tile = (r, c, letter) => ({ r, c, letter, val: HV[letter], isJoker: false, rackIndex: null });

test('opening setup through the hooks: highlights, choice, place, skip hands the step over', () => {
  const { session, controller, h } = startMatch();
  const st = session.state;
  setRack(st, 0, ['ל', 'א']);
  controller.placeTile(tile(4, 4, 'ל'));
  controller.placeTile(tile(4, 5, 'א'));
  assert.ok(controller.confirmMove());
  controller.passTurn();
  assert.equal(st.boostV2.phase, PHASE.OPENING_SETUP);
  const v = controller.view;

  assert.deepEqual(h.disabledControls(v), ['exchange', 'recall', 'rack']);
  assert.deepEqual(h.playPreview(v), { label: 'הצב כאן', hidePreview: true });
  assert.deepEqual(h.emptyCell(3, 4, v).classes, ['v2-legal']);
  assert.deepEqual(h.emptyCell(0, 0, v).classes, ['v2-dim']);

  // Without a choice, שבץ asks for one.
  assert.equal(controller.confirmMove(), false);
  assert.equal(v.lastInvalidReason, 'boost-setup-choose');
  // Tap a legal square → it becomes the pending choice (and taps are always handled in setup).
  assert.equal(h.onCellClick(3, 4, { hasSelection: false }), true);
  assert.deepEqual(v.v2SetupChoice, { r: 3, c: 4 });
  assert.match(h.emptyCell(3, 4, v).html, /is-pending/);
  assert.equal(h.onCellClick(0, 0, { hasSelection: false }), true, 'illegal taps are swallowed');
  assert.ok(controller.confirmMove());
  assert.equal(st.boostV2.openingSetup.placements.length, 1);
  assert.equal(v.v2SetupChoice, null);
  assert.match(h.emptyCell(3, 4, v).html, /is-setup/);

  // Player 0's step: skip → player 1 places it.
  assert.equal(st.currentTurnSlot, 0);
  controller.skipOpeningStep();
  assert.equal(st.currentTurnSlot, 1);
  for (const [r, c] of [[5, 4], [4, 6]]) {
    h.onCellClick(r, c, { hasSelection: false });
    assert.ok(controller.confirmMove());
  }
  assert.equal(st.boostV2.phase, PHASE.NORMAL);
  assert.equal(st.boostV2.activeBoosts.length, 3);
  assert.match(h.emptyCell(3, 4, v).html, /v2-mk/);
  assert.equal(h.emptyCell(0, 0, v), null, 'plain empty cell outside placement mode');
});

test('normal turn: covering a Boost opens replacement mode; שבץ waits for the choice, then commits', () => {
  const { session, controller, h } = startMatch();
  const st = session.state;
  setRack(st, 0, ['ל', 'א']);
  controller.placeTile(tile(4, 4, 'ל'));
  controller.placeTile(tile(4, 5, 'א'));
  controller.confirmMove();
  controller.passTurn();
  for (const [r, c] of [[3, 4], [5, 4], [4, 6]]) { h.onCellClick(r, c, { hasSelection: false }); controller.confirmMove(); }
  const v = controller.view;
  assert.equal(st.currentTurnSlot, 0);

  // A Boost tap with no tile selected opens the details sheet (handled);
  // with a tile selected the tap falls through to normal tile placement.
  assert.equal(h.onCellClick(5, 4, { hasSelection: false }), true);
  assert.equal(h.onCellClick(5, 4, { hasSelection: true }), false);

  // Draft: א under ל at (5,4) → "לא" vertical, covering the Boost there.
  setRack(st, 0, ['א', 'ב']);
  controller.placeTile(tile(5, 4, 'א'));
  const d = controller.v2Draft();
  assert.ok(d.ok);
  assert.equal(d.breakdown.consumedBoostIds.length, 1);
  assert.equal(d.required, 1);
  assert.equal(h.playPreview(v).score, d.breakdown.totalScore);
  const legal = d.legal[0];
  assert.deepEqual(h.emptyCell(legal.r, legal.c, v).classes, ['v2-legal']);

  // שבץ before choosing → hint, nothing dispatched.
  const before = st.moveHistory.length;
  assert.equal(controller.confirmMove(), false);
  assert.equal(v.lastInvalidReason, 'boost-placement-needed');
  assert.equal(st.moveHistory.length, before);

  // Choose, move it, then commit.
  assert.equal(h.onCellClick(legal.r, legal.c, { hasSelection: false }), true);
  assert.equal(controller.v2Draft().complete, true);
  const other = d.legal[1];
  h.onCellClick(other.r, other.c, { hasSelection: false });
  assert.deepEqual(v.boostPlacements, [{ r: other.r, c: other.c }], 'a second tap moves the single replacement');
  const events = [];
  bus.on(EV.MOVE_CONFIRMED, (p) => events.push(p));
  assert.ok(controller.confirmMove());
  assert.equal(events.length, 1);
  assert.equal(events[0].bonusExtra, events[0].breakdown.boostScore, 'score animation gets Boost rewards as its extra');
  assert.ok(st.boostV2.activeBoosts.some(b => b.r === other.r && b.c === other.c));
  assert.deepEqual(v.boostPlacements, [], 'cleared after the move');
});

test('legacy games are untouched: no hooks behaviour without boostV2 state', () => {
  bus._reset();
  const session = createLocalGameSession({ bus, mode: 'offline-2p', tileBagSeed: 'legacy', players: { 0: { uid: 'a' }, 1: { uid: 'b' } } });
  const controller = createGameController({ bus, session, mySlot: null });
  const { hooks } = mountBoostV2Layer({ root: nullRoot, bus, controller, getState: () => session.state });
  assert.equal(controller.view.ruleset, 'LEGACY_V1');
  assert.equal(hooks.emptyCell(0, 0, controller.view), null);
  assert.equal(hooks.onCellClick(0, 0, { hasSelection: false }), false);
  assert.equal(hooks.playPreview(controller.view), null);
  assert.equal(controller.v2Draft(), null);
});

test('first move: only the four centre squares are marked, until a word is down', () => {
  const { session, controller, h } = startMatch();
  const v = controller.view;
  for (const [r, c] of [[4, 4], [4, 5], [5, 4], [5, 5]]) assert.deepEqual(h.emptyCell(r, c, v).classes, ['v2-center']);
  assert.equal(h.emptyCell(3, 4, v), null);
  setRack(session.state, 0, ['ל', 'א']);
  controller.placeTile(tile(4, 4, 'ל'));
  controller.placeTile(tile(4, 5, 'א'));
  assert.ok(controller.confirmMove());
  assert.equal(h.emptyCell(5, 5, controller.view), null, 'markers gone after the opening word');
});

test('hidden cards render as placeholders; the details sheet ignores them', () => {
  const hidden = { definitionId: '__hidden__', family: 'HIDDEN', difficulty: 'MEDIUM', hidden: true };
  assert.match(markerHTML(hidden), /v2-mk--hidden/);
  assert.match(cardHTML(hidden), /אתגר נסתר/);
});
