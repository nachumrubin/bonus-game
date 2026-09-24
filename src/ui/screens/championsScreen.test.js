import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as bus from '../../events/bus.js';
import {
  buildChampionsHtml,
  buildChampionsEmptyHtml,
  rankShift,
  rankDeltaMarkup,
  stageLeaderboardEntries,
  playChampEndMotion,
  CHAMPS_EMPTY_TITLE,
  CHAMPS_EMPTY_SUB,
  CHAMPS_INTENT,
  CHAMPS_OPEN,
  CHAMPS_RENDER,
  CHAMPS_ERROR,
  mountChampionsScreen,
} from './championsScreen.js';

function makeEl({ hidden = true, onclick = null } = {}) {
  const listeners = [];
  const cls = new Set(hidden ? ['hidden'] : []);
  const attrs = onclick ? { onclick } : {};
  return {
    innerHTML: '',
    classList: {
      add(c) { cls.add(c); },
      remove(c) { cls.delete(c); },
      contains(c) { return cls.has(c); },
    },
    getAttribute(n) { return attrs[n] ?? null; },
    setAttribute(n, v) { attrs[n] = v; },
    removeAttribute(n) { delete attrs[n]; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    click() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeRoot({ overlay, home, end, close }) {
  overlay.querySelector = (sel) => sel === 'button[onclick="ovClose(\'ov-champs\')"]' ? close : null;
  return {
    querySelector(sel) {
      if (sel === '#ov-champs') return overlay;
      if (sel === '#champions-wrap-home') return home;
      if (sel === '#champions-wrap') return end;
      return null;
    },
  };
}

test('buildChampionsHtml renders empty and escaped rows', () => {
  const empty = buildChampionsHtml([]);
  assert.match(empty, /champs-empty--copy/);
  assert.ok(empty.includes(CHAMPS_EMPTY_TITLE));
  assert.ok(empty.includes(CHAMPS_EMPTY_SUB));
  assert.equal(buildChampionsEmptyHtml(), empty);
  const html = buildChampionsHtml([{ uid: 'u<1', name: '<Alice>', rating: 1050 }]);
  assert.match(html, /&lt;Alice&gt;/);
  assert.match(html, /1050/);
  assert.match(html, /דירוג/);
});

test('CHAMPS_OPEN shows overlay and emits open intent', () => {
  bus._reset();
  const overlay = makeEl();
  const home = makeEl();
  const root = makeRoot({ overlay, home, end: makeEl(), close: makeEl({ onclick: "ovClose('ov-champs')" }) });
  let opens = 0;
  bus.on(CHAMPS_INTENT.OPEN, () => { opens++; });
  mountChampionsScreen({ root, bus });
  bus.emit(CHAMPS_OPEN, {});
  assert.ok(!overlay.classList.contains('hidden'));
  assert.match(home.innerHTML, /טוען/);
  assert.equal(opens, 1);
});

test('CHAMPS_RENDER paints home and end targets', () => {
  bus._reset();
  const home = makeEl();
  const end = makeEl();
  mountChampionsScreen({
    root: makeRoot({ overlay: makeEl(), home, end, close: makeEl() }),
    bus,
  });
  bus.emit(CHAMPS_RENDER, { entries: [{ uid: 'u1', name: 'Alice', rating: 1099 }] });
  assert.match(home.innerHTML, /Alice/);
  assert.match(end.innerHTML, /1099/);
});

test('rankShift is post minus pre, and refuses missing ranks', () => {
  assert.equal(rankShift(5, 3), -2);
  assert.equal(rankShift(3, 5), 2);
  assert.equal(rankShift(4, 4), 0);
  assert.equal(rankShift(null, 2), null);
  assert.equal(rankShift(2, null), null);
  assert.equal(rankShift(0, 1), null);
});

test('rank delta markup is a green up arrow or a red down arrow, and zero is silent', () => {
  assert.equal(rankDeltaMarkup(0), '');
  assert.equal(rankDeltaMarkup(null), '');
  const up = rankDeltaMarkup(-2);
  assert.match(up, /champ-rank-delta--up/);
  assert.match(up, /▲2/);
  assert.match(up, /עלייה של 2 מקומות/);
  const down = rankDeltaMarkup(3);
  assert.match(down, /champ-rank-delta--down/);
  assert.match(down, /▼3/);
  assert.match(down, /ירידה של 3 מקומות/);
  assert.doesNotMatch(down, /champ-rank-delta--up/);
});

test('buildChampionsHtml puts the rank delta only on the current user row', () => {
  const html = buildChampionsHtml([
    { uid: 'me', name: 'Me', rating: 1500 },
    { uid: 'a', name: 'Ann', rating: 1400 },
    { uid: 'b', name: 'Bo', rating: 1300 },
  ], { myUid: 'me', myPosition: 1, rankDelta: -2 });
  assert.match(html, /champ-medal-icon/);
  assert.match(html, /class="champ-me"/);
  assert.match(html, /champ-rank-delta--up/);
  assert.match(html, /▲2/);
  const me = html.indexOf('champ-me');
  const ann = html.indexOf('Ann');
  assert.ok(html.slice(me, ann).includes('▲2'));
  assert.equal(html.match(/champ-rank-delta--up/g).length, 1);
});

test('buildChampionsHtml hides a zero rank change and marks a drop', () => {
  const same = buildChampionsHtml([
    { uid: 'me', name: 'Me', rating: 1000 },
  ], { myUid: 'me', myPosition: 1, rankDelta: 0 });
  assert.doesNotMatch(same, /champ-rank-delta/);
  const worse = buildChampionsHtml([
    { uid: 'a', name: 'Ann', rating: 1600 },
    { uid: 'me', name: 'Me', rating: 1500 },
  ], { myUid: 'me', myPosition: 2, rankDelta: 4 });
  assert.match(worse, /champ-rank-delta--down/);
  assert.match(worse, /▼4/);
  const ann = worse.indexOf('Ann');
  assert.doesNotMatch(worse.slice(0, ann), /champ-rank-delta/);
  assert.match(worse.slice(ann), /champ-rank-delta--down/);
});

test('outside-top-N row carries the rank delta', () => {
  const html = buildChampionsHtml(
    [{ uid: 'a', name: 'Ann', rating: 2000 }],
    {
      myUid: 'me',
      myPosition: 12,
      myEntry: { uid: 'me', name: 'Me', rating: 900 },
      rankDelta: 3,
    },
  );
  assert.match(html, /champ-me--outside/);
  assert.match(html, /▼3/);
  assert.doesNotMatch(html.slice(0, html.indexOf('champ-me--outside')), /champ-rank-delta/);
});

test('stageLeaderboardEntries parks the user at the pre-game index inside the top-N', () => {
  const entries = [
    { uid: 'me', name: 'Me', rating: 1300 },
    { uid: 'a', name: 'Ann', rating: 1200 },
    { uid: 'b', name: 'Bo', rating: 1100 },
  ];
  const staged = stageLeaderboardEntries(entries, { myUid: 'me', preRank: 3, postRank: 1 });
  assert.deepEqual(staged.map((e) => e.uid), ['a', 'b', 'me']);
  assert.equal(stageLeaderboardEntries(entries, { myUid: 'me', preRank: 12, postRank: 1 }), null);
  assert.equal(stageLeaderboardEntries(entries, { myUid: 'me', preRank: 1, postRank: 8 }), null);
  assert.equal(stageLeaderboardEntries(entries, { myUid: 'me', preRank: 1, postRank: 1 }), null);
});

test('end render shows the rank delta and home render does not', () => {
  bus._reset();
  const home = makeEl();
  const end = makeEl();
  mountChampionsScreen({
    root: makeRoot({ overlay: makeEl(), home, end, close: makeEl() }),
    bus,
  });
  bus.emit(CHAMPS_RENDER, {
    entries: [
      { uid: 'me', name: 'Me', rating: 1500 },
      { uid: 'a', name: 'Ann', rating: 1400 },
    ],
    myUid: 'me',
    myPosition: 1,
    preRank: 3,
    target: 'all',
  });
  assert.match(end.innerHTML, /champ-rank-delta--up/);
  assert.match(end.innerHTML, /▲2/);
  assert.match(end.innerHTML, /1500/);
  assert.doesNotMatch(home.innerHTML, /champ-rank-delta/);
  assert.match(home.innerHTML, /Me/);
});

test('end-table motion starts at the pre-game slot and pre-game ELO', () => {
  const prevRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  try {
    const cell = { textContent: '' };
    const wrap = {
      innerHTML: '',
      querySelector(sel) {
        return sel === 'tr.champ-me [data-champ-elo]' ? cell : null;
      },
      querySelectorAll() { return []; },
    };
    playChampEndMotion(wrap, {
      entries: [
        { uid: 'me', name: 'Me', rating: 1300 },
        { uid: 'a', name: 'Ann', rating: 1200 },
      ],
      myUid: 'me',
      myPosition: 1,
      preRank: 2,
      eloFrom: 1100,
      reducedMotion: false,
    });
    const ann = wrap.innerHTML.indexOf('Ann');
    const me = wrap.innerHTML.indexOf('>Me<');
    assert.ok(ann !== -1 && ann < me, 'user stays in the pre-game slot until the count-up finishes');
    assert.match(wrap.innerHTML, /1100/);
    assert.match(wrap.innerHTML, /champ-rank-delta--up/);
    assert.doesNotMatch(wrap.innerHTML, /1300/);
    assert.equal(cell.textContent, '1100');
  } finally {
    if (prevRaf) globalThis.requestAnimationFrame = prevRaf;
    else delete globalThis.requestAnimationFrame;
  }
});

test('omitted or null eloFrom does not count the end rating up from zero', () => {
  const prevRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  try {
    const entries = [
      { uid: 'me', name: 'Me', rating: 1480 },
      { uid: 'a', name: 'Ann', rating: 1200 },
    ];
    for (const eloArgs of [{}, { eloFrom: null }]) {
      const cell = { textContent: 'kept' };
      let eloQueries = 0;
      const wrap = {
        innerHTML: '',
        querySelector(sel) {
          if (sel === 'tr.champ-me [data-champ-elo]') {
            eloQueries += 1;
            return cell;
          }
          return null;
        },
        querySelectorAll() { return []; },
      };
      playChampEndMotion(wrap, {
        entries,
        myUid: 'me',
        myPosition: 1,
        preRank: 2,
        reducedMotion: false,
        ...eloArgs,
      });
      assert.equal(eloQueries, 0);
      assert.equal(cell.textContent, 'kept');
      assert.match(wrap.innerHTML, /data-champ-elo>1480</);
      assert.doesNotMatch(wrap.innerHTML, /data-champ-elo>0</);
      const me = wrap.innerHTML.indexOf('>Me<');
      const ann = wrap.innerHTML.indexOf('Ann');
      assert.ok(me !== -1 && me < ann, 'final order is painted when there is nothing to count');
    }

    const cell = { textContent: 'kept' };
    const wrap = {
      innerHTML: '',
      querySelector(sel) {
        return sel === 'tr.champ-me [data-champ-elo]' ? cell : null;
      },
      querySelectorAll() { return []; },
    };
    playChampEndMotion(wrap, {
      entries,
      myUid: 'me',
      myPosition: 1,
      preRank: 1,
      reducedMotion: false,
    });
    assert.equal(cell.textContent, 'kept');
    assert.match(wrap.innerHTML, /data-champ-elo>1480</);
  } finally {
    if (prevRaf) globalThis.requestAnimationFrame = prevRaf;
    else delete globalThis.requestAnimationFrame;
  }
});

test('a pre-game rating of 0 still counts up to the shown rating', () => {
  const prevRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  try {
    const cell = { textContent: '' };
    const wrap = {
      innerHTML: '',
      querySelector(sel) {
        return sel === 'tr.champ-me [data-champ-elo]' ? cell : null;
      },
      querySelectorAll() { return []; },
    };
    playChampEndMotion(wrap, {
      entries: [{ uid: 'me', name: 'Me', rating: 24 }],
      myUid: 'me',
      myPosition: 1,
      eloFrom: 0,
      reducedMotion: false,
    });
    assert.equal(cell.textContent, '0');
    assert.match(wrap.innerHTML, /data-champ-elo>24</);
  } finally {
    if (prevRaf) globalThis.requestAnimationFrame = prevRaf;
    else delete globalThis.requestAnimationFrame;
  }
});

test('reduced motion paints the final order and rating with the delta', () => {
  const wrap = { innerHTML: '' };
  playChampEndMotion(wrap, {
    entries: [
      { uid: 'me', name: 'Me', rating: 1300 },
      { uid: 'a', name: 'Ann', rating: 1200 },
    ],
    myUid: 'me',
    myPosition: 1,
    preRank: 2,
    eloFrom: 1100,
    reducedMotion: true,
  });
  const me = wrap.innerHTML.indexOf('>Me<');
  const ann = wrap.innerHTML.indexOf('Ann');
  assert.ok(me !== -1 && me < ann);
  assert.match(wrap.innerHTML, /1300/);
  assert.match(wrap.innerHTML, /champ-rank-delta--up/);
  assert.doesNotMatch(wrap.innerHTML, /1100/);
});

test('champ medal icon uses the post-game 22px size on the overlay table too', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rule = css.match(/#champions-wrap \.champ-medal-icon,[\s\S]*?#champions-wrap-home \.champ-medal-icon\{[^}]+\}/);
  assert.ok(rule, 'medal size rule must cover the post-game wrap and the overlay wrap');
  assert.match(rule[0], /width:22px/);
  assert.match(rule[0], /height:22px/);
  assert.doesNotMatch(css, /#champions-wrap-home \.champ-medal-icon\{width:(?!22px)/);
});

test('CHAMPS_ERROR paints an error placeholder', () => {
  bus._reset();
  const home = makeEl();
  mountChampionsScreen({
    root: makeRoot({ overlay: makeEl(), home, end: makeEl(), close: makeEl() }),
    bus,
  });
  bus.emit(CHAMPS_ERROR, {});
  assert.match(home.innerHTML, /champs-empty--copy/);
  assert.ok(home.innerHTML.includes(CHAMPS_EMPTY_TITLE));
  assert.ok(home.innerHTML.includes(CHAMPS_EMPTY_SUB));
});
