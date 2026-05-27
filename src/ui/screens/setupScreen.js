// setupScreen — wires the legacy #ss setup screen (player names + difficulty)
// to the new spine. Same incremental pattern as menuScreen: replace inline
// onclicks with bus-driven listeners; preserve legacy DOM and CSS.
//
// Flow:
//   1. Menu's START_2P / START_VS_BOT intent → main.js opens #ss in the
//      appropriate mode (P2 input visible for vs, difficulty visible for bot).
//   2. User edits #ip1 / #ip2 inputs and clicks difficulty buttons (which
//      now emit DIFF_PICKED on the bus instead of calling setDiff()).
//   3. Clicking the green "Play" button emits SETUP_PLAY_CLICKED with a
//      payload of { mode, p1Name, p2Name, difficulty }. main.js subscribes
//      and calls startGameViaSpine.
//   4. Clicking "Back" emits SETUP_BACK_CLICKED.

import { $, on } from '../domHelpers.js';
import { loadUiPreferences } from '../../game/settings/settingsCompat.js';

export const SETUP_INTENT = Object.freeze({
  PLAY_CLICKED: 'setup/playClicked',
  BACK_CLICKED: 'setup/backClicked',
  DIFF_PICKED:  'setup/diffPicked',
});

// The bus event main.js fires to ASK the setup screen to open in a particular
// mode. Triggers visibility of #p2f (P2 name) vs #dff (difficulty) and the
// title text.
export const SETUP_OPEN = 'setup/open';

const SELECTORS = {
  setupRoot:  '#ss',
  title:      '#stitle',
  p1Input:    '#ip1',
  p2Input:    '#ip2',
  p2Field:    '#p2f',
  diffField:  '#dff',
  diffEasy:   'button[onclick="setDiff(0,this)"]',
  diffMed:    'button[onclick="setDiff(1,this)"]',
  diffHard:   'button[onclick="setDiff(2,this)"]',
  playBtn:    'button[onclick="startGame()"]',
  backBtn:    'button[onclick="goHome()"]',
};

export function mountSetupScreen({ root = globalThis.document, bus, getDisplayName } = {}) {
  if (!bus) throw new Error('mountSetupScreen: bus required');

  const setup = $(SELECTORS.setupRoot, root);
  if (!setup) {
    console.warn('[setupScreen] #ss not found — not mounted');
    return { unmount() {} };
  }

  let mode = 'vs';                   // 'vs' or 'bot'
  let difficulty = 1;                // 0=easy, 1=med, 2=hard
  let botTime = 40;                  // 20 | 40 | 60
  let showBothRacks = false;

  const cleanups = [];

  // ─── Show-both-racks toggle ────────────────────────────
  const racksShowBtn = setup.querySelector?.('#ss-racks-both');
  const racksMineBtn = setup.querySelector?.('#ss-racks-mine');
  function applyRacksClass() {
    racksShowBtn?.classList?.[showBothRacks ? 'add' : 'remove']('a');
    racksMineBtn?.classList?.[showBothRacks ? 'remove' : 'add']('a');
  }
  if (racksShowBtn) {
    cleanups.push(on(racksShowBtn, 'click', (e) => {
      e.preventDefault?.();
      showBothRacks = true;
      applyRacksClass();
    }));
  }
  if (racksMineBtn) {
    cleanups.push(on(racksMineBtn, 'click', (e) => {
      e.preventDefault?.();
      showBothRacks = false;
      applyRacksClass();
    }));
  }

  // ─── Speed buttons ─────────────────────────────────────
  const speedDefs = [
    { speed: 20, el: setup.querySelector?.('#ss-spd-20') },
    { speed: 40, el: setup.querySelector?.('#ss-spd-40') },
    { speed: 60, el: setup.querySelector?.('#ss-spd-60') },
  ];
  for (const def of speedDefs) {
    if (!def.el) continue;
    cleanups.push(on(def.el, 'click', (e) => {
      e.preventDefault?.();
      botTime = def.speed;
      for (const d of speedDefs) {
        if (d.el) (d.speed === botTime ? d.el.classList?.add('a') : d.el.classList?.remove('a'));
      }
    }));
  }

  // ─── Replace difficulty button onclicks ────────────────
  const diffButtons = [
    { sel: SELECTORS.diffEasy, level: 0 },
    { sel: SELECTORS.diffMed,  level: 1 },
    { sel: SELECTORS.diffHard, level: 2 },
  ];
  for (const def of diffButtons) {
    const btn = $(def.sel, setup);
    if (!btn) continue;
    def.el = btn;
    btn.removeAttribute('onclick');
    cleanups.push(on(btn, 'click', (e) => {
      e.preventDefault?.();
      difficulty = def.level;
      // Mirror legacy CSS class toggle so the active button is styled
      for (const d of diffButtons) {
        const b = d.el;
        if (b) (d.level === difficulty ? b.classList?.add('a') : b.classList?.remove('a'));
      }
      bus.emit(SETUP_INTENT.DIFF_PICKED, { difficulty });
    }));
  }

  // ─── Replace #playBtn (start) ──────────────────────────
  const playBtn = $(SELECTORS.playBtn, setup);
  if (playBtn) {
    playBtn.removeAttribute('onclick');
    cleanups.push(on(playBtn, 'click', (e) => {
      e.preventDefault?.();
      const p1 = ($(SELECTORS.p1Input, setup)?.value ?? 'שחקן 1').trim() || 'שחקן 1';
      const p2 = ($(SELECTORS.p2Input, setup)?.value ?? 'שחקן 2').trim() || 'שחקן 2';
      bus.emit(SETUP_INTENT.PLAY_CLICKED, { mode, p1Name: p1, p2Name: p2, difficulty, botTime, showBothRacks: mode === 'vs' ? showBothRacks : false });
    }));
  }

  // ─── Replace back button ───────────────────────────────
  const backBtn = $(SELECTORS.backBtn, setup);
  if (backBtn) {
    backBtn.removeAttribute('onclick');
    cleanups.push(on(backBtn, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(SETUP_INTENT.BACK_CLICKED);
    }));
  }

  // ─── Listen for SETUP_OPEN to configure mode-specific visibility ──
  cleanups.push(bus.on(SETUP_OPEN, ({ mode: nextMode = 'vs', initialDifficulty = 1, initialBotTime = 40 } = {}) => {
    mode = nextMode;
    difficulty = initialDifficulty;
    botTime = [20, 40, 60].includes(initialBotTime) ? initialBotTime : 40;
    for (const d of speedDefs) {
      if (d.el) (d.speed === botTime ? d.el.classList?.add('a') : d.el.classList?.remove('a'));
    }
    // Title
    const title = $(SELECTORS.title, setup);
    if (title) title.textContent = mode === 'bot' ? 'נגד המחשב' : 'שני שחקנים';
    const p1Input = $(SELECTORS.p1Input, setup);
    if (p1Input) {
      const name = getDisplayName?.() ?? loadUiPreferences(globalThis.localStorage).lastDisplayName;
      if (name) p1Input.value = name;
    }
    // Show P2 input only in vs mode; show difficulty only in bot mode
    const p2Field = $(SELECTORS.p2Field, setup);
    if (p2Field) p2Field.style.display = mode === 'vs' ? '' : 'none';
    const diffField = $(SELECTORS.diffField, setup);
    if (diffField) diffField.style.display = mode === 'bot' ? '' : 'none';
    // Show racks toggle only in vs mode
    const racksRow = setup.querySelector?.('#ss-racks-row');
    if (racksRow) racksRow.style.display = mode === 'vs' ? '' : 'none';
    // Reset difficulty active class
    for (const d of diffButtons) {
      const b = d.el;
      if (b) (d.level === difficulty ? b.classList?.add('a') : b.classList?.remove('a'));
    }
    // Reset racks toggle (default to "only mine")
    showBothRacks = false;
    applyRacksClass();
  }));

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
