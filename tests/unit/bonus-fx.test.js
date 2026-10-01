import { test } from 'node:test';
import assert from 'node:assert/strict';

import { confettiBurst, countUp, showBonusResult } from '../../src/ui/screens/miniGames/bonusFx.js';

// node has no requestAnimationFrame, so countUp lands on the final value
// synchronously — perfect for asserting the end state.
test('countUp: sets the final value (no rAF in node)', () => {
  const el = { textContent: '' };
  countUp(el, 42);
  assert.equal(el.textContent, '42');
});

test('countUp: applies prefix/suffix', () => {
  const el = { textContent: '' };
  countUp(el, 17, { prefix: '+', suffix: " נק'" });
  assert.equal(el.textContent, "+17 נק'");
});

test('countUp: tolerates a null element', () => {
  assert.doesNotThrow(() => countUp(null, 5));
});

test('countUp: non-numeric target falls back to 0', () => {
  const el = { textContent: 'x' };
  countUp(el, 'abc');
  assert.equal(el.textContent, '0');
});

test('confettiBurst: no-op without a usable container', () => {
  assert.equal(confettiBurst(null), null);
  assert.equal(confettiBurst({}, { doc: null }), null);
});

test('confettiBurst: builds a layer of pieces with an injected doc', () => {
  // Minimal fake DOM: elements collect children + a cssText sink.
  const made = [];
  const doc = {
    createElement(tag) {
      const el = {
        tag, className: '', style: { cssText: '' },
        children: [],
        appendChild(c) { this.children.push(c); },
        remove() {},
      };
      made.push(el);
      return el;
    },
  };
  const container = { children: [], appendChild(c) { this.children.push(c); } };
  const layer = confettiBurst(container, { count: 6, doc });
  assert.ok(layer, 'returns the layer');
  assert.equal(container.children.length, 1);
  assert.equal(layer.className, 'bz-confetti');
  assert.equal(layer.children.length, 6);
  assert.ok(layer.children.every(p => p.className === 'bz-confetti-piece'));
});

test('showBonusResult: writes premium markup and is null-safe', () => {
  const container = { innerHTML: '', querySelector: () => null, closest: () => null };
  showBonusResult(container, { success: true, headline: 'מצאת!', points: 30, doc: null });
  assert.match(container.innerHTML, /bz-result is-win/);
  assert.match(container.innerHTML, /מצאת!/);
  assert.match(container.innerHTML, /data-bz-count/);
});

test('showBonusResult: failure state has no points block and uses is-soft', () => {
  const container = { innerHTML: '', querySelector: () => null, closest: () => null };
  showBonusResult(container, { success: false, headline: 'אין מילים', sub: 'נסה שוב', doc: null });
  assert.match(container.innerHTML, /bz-result is-soft/);
  assert.doesNotMatch(container.innerHTML, /data-bz-count/);
  assert.match(container.innerHTML, /נסה שוב/);
});

test('showBonusResult: tolerates a container without innerHTML', () => {
  assert.doesNotThrow(() => showBonusResult({}, { success: true }));
});

// ── shared result markup / helpers (Oct 2026 mini-game redesign) ──
import { bonusResultHtml, wordTilesHtml, escapeHtml } from '../../src/ui/screens/miniGames/bonusFx.js';
import { setTone } from '../../src/ui/screens/miniGames/bonusUi.js';

test('bonusResultHtml: win → gold trophy medal + count-up points', () => {
  const h = bonusResultHtml({ success: true, headline: 'כל הכבוד!', points: 40 });
  assert.match(h, /bz-result is-win/);
  assert.match(h, /#gi-trophy/);
  assert.match(h, /data-bz-count/);
});

test('bonusResultHtml: explicit tone/icon, no points block without points', () => {
  const h = bonusResultHtml({ success: false, tone: 'bad', icon: 'x', headline: 'לא נכון', extraHtml: '<i id="x"></i>' });
  assert.match(h, /bz-result is-bad/);
  assert.match(h, /#gi-x/);
  assert.doesNotMatch(h, /data-bz-count/);
  assert.match(h, /<i id="x"><\/i>/);
});

test('wordTilesHtml: one wood tile per letter, escaped, with a tone bezel', () => {
  const h = wordTilesHtml('אב<', 'ok');
  assert.equal((h.match(/bz-tile is-sm is-ok/g) || []).length, 3);
  assert.match(h, /&lt;/);
  assert.equal(wordTilesHtml(''), '');
  assert.equal(escapeHtml('"a"&'), '&quot;a&quot;&amp;');
});

test('setTone: maps true/false/string/null onto is-* classes', () => {
  const el = { className: '' };
  setTone(el, 'bz-status', true);  assert.equal(el.className, 'bz-status is-ok');
  setTone(el, 'bz-status', false); assert.equal(el.className, 'bz-status is-bad');
  setTone(el, 'bz-status', 'warn'); assert.equal(el.className, 'bz-status is-warn');
  setTone(el, 'bz-status', null);  assert.equal(el.className, 'bz-status');
  assert.doesNotThrow(() => setTone(null, 'x', true));
});
