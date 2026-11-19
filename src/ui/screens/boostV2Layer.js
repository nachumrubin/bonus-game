// boostV2Layer — the Boost 2.0 additions to the game screen (Phase 5).
//
// Mounted next to mountGameScreen for BOOST_V2 matches only. It supplies the
// `boostV2Hooks` the game screen calls (cell decoration, cell taps, control
// gating, play-button preview, after-render) and owns four pieces of DOM:
//   #v2-strip   — above the board: next-two queue preview / live move
//                 breakdown + replacement tray / opening-setup stepper
//   #v2-sheet   — challenge details (tap a Boost with no tile selected)
//   #v2-result  — non-modal score breakdown after every move (auto-hides)
//   end screen  — rack-deduction lines on #ov-end for natural endings
// Approved mockups: https://claude.ai/artifact/QwTp3yWjgbmyD2qaT7hUJS
//
// All rules come from the engine's pure modules (draftPreview, engineV2,
// matchStateV2, challengeCatalog) — this file only decides what to show.
// The family icons are external artwork that does not exist yet
// (docs/asset_inventory.md): their places are reserved with an empty slot.

import { EV } from '../../events/eventTypes.js';
import { $, on } from '../domHelpers.js';
import { DIFFICULTY_PRESENTATION } from '../../game/boostV2/rulesConfig.js';
import { FAMILY, FAMILY_META, SCOPE, describeRequirementHe, parameterBadge } from '../../game/boostV2/challengeCatalog.js';
import { PHASE, publicView } from '../../game/boostV2/matchStateV2.js';
import { legalOpeningSquares } from '../../game/boostV2/engineV2.js';

export const V2_RESULT_MS = 3600;
const key = (r, c) => `${r},${c}`;

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// ── pure presentation helpers (unit-tested) ───────────────────────────────
export function badgeFor(def) {
  const text = parameterBadge(def);
  return { text, dir: /[א-ת]/.test(text) ? 'rtl' : 'ltr' };
}

// Online Boost 2.0: cards after the two visible ones stay secret until the
// server reveals them (definition.hidden — boostV2OnlineSession).
export const HIDDEN_CARD_LABEL = 'אתגר נסתר';

export function markerHTML(def, extraClass = '') {
  if (!def) return '';
  if (def.hidden) {
    return `<div class="v2-mk v2-mk--hidden${extraClass ? ` ${extraClass}` : ''}" role="img" aria-label="${HIDDEN_CARD_LABEL}">`
      + '<span class="v2-mk-s" aria-hidden="true">?</span></div>';
  }
  const d = DIFFICULTY_PRESENTATION[def.difficulty];
  const b = badgeFor(def);
  const cls = `v2-mk v2-mk--${def.difficulty.toLowerCase()}${extraClass ? ` ${extraClass}` : ''}`;
  const label = `${FAMILY_META[def.family].nameHe}, ${d.labelHe}, ${def.reward} נקודות`;
  return `<div class="${cls}" role="img" aria-label="${escapeHtml(label)}">`
    + `<span class="v2-mk-s" aria-hidden="true">${d.symbol}</span>`
    + `<span class="v2-mk-b" dir="${b.dir}" aria-hidden="true">${escapeHtml(b.text)}</span>`
    + `<span class="v2-mk-r" dir="ltr" aria-hidden="true">+${def.reward}</span></div>`;
}

export function cardHTML(def, { note = '' } = {}) {
  if (!def) return '';
  if (def.hidden) {
    return '<div class="v2-card v2-card--hidden"><span class="v2-icon-slot" aria-hidden="true">?</span>'
      + `<span class="v2-card-tx"><b><span class="v2-nm">${HIDDEN_CARD_LABEL}</span></b>`
      + `<i>ייחשף אחרי המהלך${note ? ` · ${escapeHtml(note)}` : ''}</i></span></div>`;
  }
  const d = DIFFICULTY_PRESENTATION[def.difficulty];
  const b = badgeFor(def);
  return `<div class="v2-card v2-card--${def.difficulty.toLowerCase()}">`
    + '<span class="v2-icon-slot" aria-hidden="true"></span>'
    + '<span class="v2-card-tx">'
    + `<b><span class="v2-nm">${escapeHtml(FAMILY_META[def.family].nameHe)}</span><span class="v2-bd" dir="${b.dir}">${escapeHtml(b.text)}</span></b>`
    + `<i>${d.symbol} ${d.labelHe} · <span dir="ltr">+${def.reward}</span>${note ? ` · ${escapeHtml(note)}` : ''}</i>`
    + '</span></div>';
}

const EXAMPLES = {
  LONG_WORD: { 4: 'שלום', 6: 'מחשבים', 8: 'התקדמות' },
  EXACT_TARGET: { 4: 'שלום', 6: 'מחשבים', 8: 'התקדמות' },
  UNIQUE_LETTERS: { 4: 'שלום', 5: 'מחברת', 7: 'מכתבים' },
};

// Content of the challenge-details sheet.
export function sheetModel(def) {
  const d = DIFFICULTY_PRESENTATION[def.difficulty];
  const p = def.parameters ?? {};
  let example = null;
  if (def.family === FAMILY.LONG_WORD) example = EXAMPLES.LONG_WORD[p.minimumLength];
  if (def.family === FAMILY.EXACT_TARGET) example = EXAMPLES.EXACT_TARGET[p.exactLength];
  if (def.family === FAMILY.UNIQUE_LETTERS) example = EXAMPLES.UNIQUE_LETTERS[p.minimumLength];
  if (def.family === FAMILY.DOUBLE_LETTER) example = p.minRepeatedLetters >= 2 ? 'גלגל' : 'אבא';
  const notes = [];
  if (def.evaluationScope === SCOPE.WORD) {
    notes.push('גם אותיות שכבר על הלוח נספרות.');
    notes.push('מספיקה מילה אחת דרך הבוסט — גם מילה צולבת.');
  }
  if (def.family === FAMILY.LETTER_HUNT) notes.push('ג׳וקר שמייצג את האות נחשב.');
  if (def.family === FAMILY.TILE_MASTER) notes.push('רק אריחים חדשים נספרים, ואחד מהם על הבוסט.');
  if (def.family === FAMILY.BRIDGE_BUILDER) notes.push('הבוסט השני לא חייב להצליח.');
  notes.push('מי שמניח אריח על הבוסט משתמש בו, גם בלי להשלים את האתגר.');
  return {
    name: FAMILY_META[def.family].nameHe,
    symbol: d.symbol, level: d.labelHe, levelClass: def.difficulty.toLowerCase(),
    reward: def.reward,
    requirement: describeRequirementHe(def),
    example,
    notes,
  };
}

// Score breakdown rows (result card + live strip share them).
export function breakdownRows(b, definitions) {
  const rows = [{ kind: 'words', label: `מילים · ${b.words.map(w => w.text).join(', ')}`, value: b.baseScore }];
  for (const r of b.boostResults) {
    const def = definitions?.[r.definitionId];
    const name = def ? FAMILY_META[def.family].nameHe : r.family;
    rows.push(r.completed
      ? { kind: 'ok', label: `✓ ${name}`, value: r.reward }
      : { kind: 'fail', label: `✗ ${name}`, value: 0 });
  }
  if (b.fullRackBonus) rows.push({ kind: 'rack', label: 'בונוס מגש מלא · 8 אריחים', value: b.fullRackBonus });
  return rows;
}

const signed = (n) => `<span dir="ltr">${n > 0 ? '+' : ''}${n}</span>`;

// ── mount ─────────────────────────────────────────────────────────────────
export function mountBoostV2Layer({ root = globalThis.document, bus, controller, getState, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const cleanups = [];
  const strip = $('#v2-strip', root);
  const sheetWrap = $('#v2-sheet', root);
  const resultEl = $('#v2-result', root);
  const sg = $('#sg', root);
  sg?.classList?.add?.('boost-v2');
  if (strip) strip.hidden = false;
  let resultTimer = null;
  let lastStripHtml = '';

  // One draft computation per distinct view (renderBoard calls emptyCell 100×).
  let draftKey = null;
  let draftCache = null;
  function draftFor(v) {
    const k = JSON.stringify([v.placed, v.swappedTiles, v.boostPlacements, v._boostV2?.revision, v.currentTurnSlot]);
    if (k !== draftKey) { draftKey = k; draftCache = controller.v2Draft?.() ?? null; }
    return draftCache;
  }
  let setupKey = null;
  let setupLegal = new Set();
  function openingLegal(v) {
    const k = `${v._boostV2?.revision}`;
    if (k !== setupKey) { setupKey = k; setupLegal = new Set(legalOpeningSquares(getState()).map(s => key(s.r, s.c))); }
    return setupLegal;
  }

  const inSetup = (v) => v._boostV2?.phase === PHASE.OPENING_SETUP;
  const defOf = (v, id) => v._boostV2?.definitions?.[id];

  function boostAt(v, r, c) {
    return v._boostV2?.activeBoosts?.find(b => b.r === r && b.c === c) ?? null;
  }

  // ── hooks ───────────────────────────────────────────────────────────────
  const hooks = {
    emptyCell(r, c, v) {
      const s = v._boostV2;
      if (!s) return null;
      if (inSetup(v)) {
        const setup = s.openingSetup;
        const placed = setup?.placements?.find(p => p.r === r && p.c === c);
        if (placed) return { html: markerHTML(defOf(v, placed.effectiveDefinitionId), 'is-setup'), classes: ['v2-boost'] };
        if (v.v2SetupChoice && v.v2SetupChoice.r === r && v.v2SetupChoice.c === c) {
          const cur = setup?.effective?.[setup.placements.length];
          return { html: markerHTML(defOf(v, cur?.definitionId), 'is-pending'), classes: ['v2-boost', 'v2-choice'] };
        }
        return { html: '', classes: [openingLegal(v).has(key(r, c)) ? 'v2-legal' : 'v2-dim'] };
      }
      const b = boostAt(v, r, c);
      if (b) return { html: markerHTML(defOf(v, b.effectiveDefinitionId)), classes: ['v2-boost'] };
      const d = draftFor(v);
      if (d?.ok && d.required > 0) {
        const i = d.choices.findIndex(ch => ch.r === r && ch.c === c);
        if (i >= 0) return { html: markerHTML(d.replacements[i].definition, 'is-pending'), classes: ['v2-boost', 'v2-choice'] };
        if (!d.complete || d.required === 1) {
          const legal = d.legal.some(sq => sq.r === r && sq.c === c);
          return { html: '', classes: [legal ? 'v2-legal' : 'v2-dim'] };
        }
      }
      return null;
    },

    onCellClick(r, c, { hasSelection }) {
      const v = controller.view;
      if (!v._boostV2) return false;
      if (inSetup(v)) {
        if (openingLegal(v).has(key(r, c))) {
          const same = v.v2SetupChoice && v.v2SetupChoice.r === r && v.v2SetupChoice.c === c;
          controller.setV2SetupChoice(same ? null : { r, c });
          return true;
        }
        const placed = v._boostV2.openingSetup?.placements?.find(p => p.r === r && p.c === c);
        if (placed) openSheet(defOf(v, placed.effectiveDefinitionId));
        return true; // nothing else is playable during setup
      }
      if (hasSelection) return false; // a rack tile is selected → normal placement
      const d = draftFor(v);
      if (d?.ok && d.required > 0) {
        const i = d.choices.findIndex(ch => ch.r === r && ch.c === c);
        if (i >= 0) {
          controller.setBoostPlacements(d.choices.filter((_, j) => j !== i));
          return true;
        }
        if (d.legal.some(sq => sq.r === r && sq.c === c)) {
          const next = d.complete ? d.choices.slice(0, -1) : d.choices; // full → move the latest one
          controller.setBoostPlacements([...next, { r, c }]);
          return true;
        }
      }
      const b = boostAt(v, r, c);
      if (b) { openSheet(defOf(v, b.effectiveDefinitionId)); return true; }
      return false;
    },

    disabledControls(v) {
      return inSetup(v) ? ['exchange', 'recall', 'rack'] : [];
    },

    playPreview(v) {
      if (!v._boostV2) return null;
      if (inSetup(v)) return { label: 'הצב כאן', hidePreview: true };
      const d = draftFor(v);
      return d?.ok ? { score: d.breakdown.totalScore } : null;
    },

    afterRender(v) {
      renderStrip(v);
    },
  };

  // ── strip ───────────────────────────────────────────────────────────────
  function renderStrip(v) {
    if (!strip) return;
    const s = v._boostV2;
    let html = '';
    if (!s) html = '';
    else if (inSetup(v)) html = setupStripHTML(v);
    else {
      const d = draftFor(v);
      html = d?.ok ? draftStripHTML(v, d) : queueStripHTML(v);
    }
    if (html === lastStripHtml) return;
    lastStripHtml = html;
    strip.innerHTML = html;
  }

  function queueStripHTML(v) {
    const up = publicView(v._boostV2).upcoming;
    const cards = up.length ? up.map(u => cardHTML(u.definition)).join('') : '<span class="v2-muted">אין עוד אתגרים בתור</span>';
    return `<div class="v2-row"><span class="v2-lbl">הבאים בתור</span>${cards}</div>`;
  }

  function draftStripHTML(v, d) {
    const chips = breakdownRows(d.breakdown, v._boostV2.definitions)
      .map(r => `<span class="v2-chip v2-chip--${r.kind}">${escapeHtml(r.label)} ${signed(r.value)}</span>`).join('');
    const total = `<span class="v2-total">${signed(d.breakdown.totalScore)}</span>`;
    let tray = '';
    if (d.required > 0) {
      const idx = d.complete ? d.required - 1 : d.choices.length;
      const status = d.complete ? '<span class="v2-ok">✓ מוקם</span>' : '<span class="v2-hint">בחרו משבצת</span>';
      tray = `<div class="v2-row v2-tray"><span class="v2-lbl">בוסט חדש ${Math.min(idx + 1, d.required)}/${d.required}</span>`
        + `${cardHTML(d.replacements[idx].definition)}${status}</div>`;
    }
    return `<div class="v2-row v2-sum"><div class="v2-chips">${chips}</div>${total}</div>${tray}`;
  }

  function setupStripHTML(v) {
    const setup = v._boostV2.openingSetup;
    const names = (slot) => escapeHtml(v._players?.[slot]?.displayName ?? `שחקן ${slot + 1}`);
    const steps = setup.effective.map((e, i) => {
      const def = defOf(v, e.definitionId);
      const done = i < setup.placements.length;
      const now = i === setup.placements.length;
      const who = done ? names(setup.placements[i].placedBySlot) : names(setup.order[i]);
      const state = done ? `${who} ✓` : now ? `${who} · עכשיו` : who;
      return `<li class="v2-step${now ? ' is-now' : ''}${done ? ' is-done' : ''}"><span class="v2-step-h">${i + 1} · ${state}</span>${cardHTML(def)}</li>`;
    }).join('');
    return '<div class="v2-setup"><div class="v2-setup-h"><b>מציבים בוסטים — כולם יופעלו יחד</b>'
      + '<button type="button" class="v2-skip" data-v2-skip="1">דלג · היריב יציב</button></div>'
      + `<ol class="v2-steps">${steps}</ol></div>`;
  }

  if (strip) {
    cleanups.push(on(strip, 'click', (e) => {
      if (e.target?.closest?.('[data-v2-skip]')) controller.skipOpeningStep?.();
    }));
  }

  // ── sheet ───────────────────────────────────────────────────────────────
  function openSheet(def) {
    if (!sheetWrap || !def || def.hidden) return;
    const m = sheetModel(def);
    const ex = m.example
      ? `<div class="v2-ex"><span class="v2-muted">לדוגמה</span><div class="v2-ex-tiles">${[...m.example].map(ch => `<span class="v2-ex-t">${escapeHtml(ch)}</span>`).join('')}</div></div>`
      : '';
    sheetWrap.innerHTML = '<div class="v2-sheet" role="dialog" aria-modal="true" aria-labelledby="v2-sheet-ttl">'
      + '<div class="v2-sheet-grip" aria-hidden="true"></div>'
      + '<div class="v2-sheet-hd"><span class="v2-icon-slot v2-icon-slot--lg" aria-hidden="true"></span><div>'
      + `<h2 id="v2-sheet-ttl">${escapeHtml(m.name)}</h2>`
      + `<div class="v2-sheet-tags"><span class="v2-tag v2-tag--${m.levelClass}">${m.symbol} ${m.level}</span><span class="v2-tag v2-tag--pts"><span dir="ltr">+${m.reward}</span> נק׳</span></div>`
      + '</div></div>'
      + `<p class="v2-sheet-req">${escapeHtml(m.requirement)}</p>${ex}`
      + `<ul class="v2-sheet-notes">${m.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
      + '<button type="button" class="v2-sheet-ok" data-v2-close="1">הבנתי</button></div>';
    sheetWrap.classList?.remove?.('hidden');
    sheetWrap.querySelector?.('[data-v2-close]')?.focus?.();
  }
  function closeSheet() {
    if (!sheetWrap) return;
    sheetWrap.classList?.add?.('hidden');
    sheetWrap.innerHTML = '';
  }
  if (sheetWrap) {
    cleanups.push(on(sheetWrap, 'click', (e) => {
      if (e.target === sheetWrap || e.target?.closest?.('[data-v2-close]')) closeSheet();
    }));
    cleanups.push(on(sheetWrap, 'keydown', (e) => { if (e.key === 'Escape') closeSheet(); }));
  }

  // ── result card ─────────────────────────────────────────────────────────
  function showResult({ slot, breakdown }) {
    if (!resultEl || !breakdown) return;
    const st = getState();
    const name = escapeHtml(st?.players?.[slot]?.displayName ?? `שחקן ${slot + 1}`);
    const rows = breakdownRows(breakdown, st?.boostV2?.definitions)
      .map(r => `<div class="v2-res-row v2-res-row--${r.kind}"><span>${escapeHtml(r.label)}</span>${signed(r.value)}</div>`).join('');
    resultEl.innerHTML = `<div class="v2-res-hd">${name}</div>${rows}`
      + `<div class="v2-res-row v2-res-total"><span>סה״כ</span>${signed(breakdown.totalScore)}</div>`;
    resultEl.classList?.remove?.('hidden');
    if (resultTimer) clearTimer(resultTimer);
    resultTimer = setTimer(() => { resultEl.classList?.add?.('hidden'); resultTimer = null; }, V2_RESULT_MS);
  }
  if (resultEl) cleanups.push(on(resultEl, 'click', () => resultEl.classList?.add?.('hidden')));
  if (bus) {
    cleanups.push(bus.on(EV.MOVE_CONFIRMED, (p) => { if (p?.breakdown) showResult(p); }));
    // Online: the opponent's move arrives as OPPONENT_MOVED (with breakdown).
    cleanups.push(bus.on(EV.OPPONENT_MOVED, (p) => { if (p?.breakdown) showResult(p); }));
    cleanups.push(bus.on(EV.GAME_COMPLETED, (p) => { if (p?.boostV2Endgame) renderEndDeductions(p.boostV2Endgame); }));
  }

  // ── end screen ──────────────────────────────────────────────────────────
  function renderEndDeductions(eg) {
    for (const slot of [0, 1]) {
      const card = $(`#end-card-${slot}`, root);
      if (!card) continue;
      let line = card.querySelector?.('.end-v2-ded');
      if (!line) {
        line = (root.ownerDocument ?? root).createElement?.('div');
        if (!line) continue;
        line.className = 'end-v2-ded';
        card.appendChild(line);
      }
      line.innerHTML = `צבור ${eg.accumulated[slot]} · מגש <span dir="ltr">${eg.deductions[slot] ? `−${eg.deductions[slot]}` : '0'}</span>`;
    }
  }

  function unmount() {
    if (resultTimer) clearTimer(resultTimer);
    closeSheet();
    if (strip) { strip.innerHTML = ''; strip.hidden = true; }
    resultEl?.classList?.add?.('hidden');
    sg?.classList?.remove?.('boost-v2');
    for (const el of root.querySelectorAll?.('.end-v2-ded') ?? []) el.remove?.();
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { hooks, unmount, _openSheet: openSheet, _showResult: showResult };
}
