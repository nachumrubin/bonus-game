// evolutionScreen — the level-up evolution overlay (#ov-evolution) and its queue (Phase 4).
//
// main.js feeds every profile snapshot to noteProfile(uid, boosties). Levels are compared
// with the ones this device has already celebrated (localStorage, per account), so a level
// reached here or on another device plays exactly once. A level-up waits while a game is
// still being played, and after the game-over screen opens it waits a moment so the
// result lands first. Several level-ups play one after another.
//
// The scene: evolutionScene.js (three.js, imported only when needed). Without WebGL 2, on
// a load error, or under reduced motion it shows the stills instead: a cross-fade from the
// old full-body still to the new one, with a CSS flash (no flash under reduced motion).
//
// EVO_SHOW { kind: 'level', id, from, to } replays one (the store's "watch" button).
// A chain unlock ({ kind: 'unlock', id }) follows its level-up with a card offering to
// equip the new Boostie (STORE_INTENT.EQUIP).

import { boostieStillSrc, boostieModelSrc, boostieName } from '../../game/account/boostieCatalog.js';
import { cue as cueSfx } from '../feedbackService.js';
import { STORE_INTENT } from '../screens/avatarStoreScreen.js';
import { canUseLive3d } from './scoreboardLive.js';
import { diffEvolutions, evolutionCopy, EVO_T, SEEN_KEY_PREFIX, EVO_SHOW, EVO_CLOSED } from './evolutionData.js';

export { EVO_SHOW, EVO_CLOSED };

const END_HOLD_MS = 2400;      // let the game-over result land first
const BUSY_RETRY_MS = 1500;
const LOAD_WAIT_MS = 5000;     // models not ready by then → stills

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function readSeen(storage, uid) {
  try { const raw = storage?.getItem(SEEN_KEY_PREFIX + uid); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeSeen(storage, uid, seen) {
  try { storage?.setItem(SEEN_KEY_PREFIX + uid, JSON.stringify(seen)); } catch {}
}

export function mountEvolutionScreen({
  bus,
  doc = globalThis.document,
  storage = globalThis.localStorage,
  isBusy = () => false,
  prefersReducedMotion = () => false,
  canUse3d = () => canUseLive3d(),
  importer = () => import('./evolutionScene.js'),
  endOpenEvent = 'overlay/end/open',
} = {}) {
  if (!bus) throw new Error('mountEvolutionScreen: bus required');
  const queue = [];
  const cleanups = [];
  let showing = null;       // { scene, timers, done }
  let holdUntil = 0;
  let retry = 0;
  let el = null;

  // ---------- queue ----------
  function noteProfile(uid, boosties) {
    if (!uid || !boosties) return;
    const { seen, events } = diffEvolutions(readSeen(storage, uid), boosties);
    writeSeen(storage, uid, seen);
    if (!events.length) return;
    queue.push(...events);
    pump();
  }

  function pump() {
    clearTimeout(retry);
    if (showing || !queue.length || !doc?.body) return;
    const wait = Math.max(holdUntil - Date.now(), isBusy() ? BUSY_RETRY_MS : 0);
    if (wait > 0) { retry = setTimeout(pump, wait); return; }
    const ev = queue.shift();
    if (ev.kind === 'unlock') showUnlock(ev);
    else showLevel(ev);
  }

  // ---------- DOM ----------
  function ensureEl() {
    if (el && doc.body.contains(el)) return el;
    el = doc.createElement('div');
    el.id = 'ov-evolution';
    el.className = 'evo-ov hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'evo-title');
    el.innerHTML = `
      <div class="evo-stage">
        <img class="evo-still evo-still--from" alt="">
        <img class="evo-still evo-still--to" alt="">
        <canvas class="evo-cv" aria-hidden="true"></canvas>
        <div class="evo-flash" aria-hidden="true"></div>
      </div>
      <button type="button" class="evo-skip">דלג</button>
      <div class="ovc evo-card dlg-gold">
        <div class="evo-kicker"></div>
        <div id="evo-title" class="evo-title"></div>
        <div class="evo-lvl"></div>
        <div class="evo-change"></div>
        <div class="ovbtns evo-btns"></div>
      </div>`;
    doc.body.append(el);
    el.addEventListener('click', onClick);
    return el;
  }
  const $ = (sel) => el.querySelector(sel);

  function onClick(e) {
    const b = e.target?.closest?.('button');
    if (!b || !showing) return;
    if (b.classList.contains('evo-skip')) { skip(); return; }
    const act = b.getAttribute('data-evo');
    if (act === 'equip') bus.emit(STORE_INTENT.EQUIP, { id: showing.ev.id });
    if (act) close();
  }

  function setCard({ kicker, title, lvl, change, buttons }) {
    $('.evo-kicker').textContent = kicker;
    $('.evo-title').textContent = title;
    $('.evo-lvl').textContent = lvl;
    $('.evo-change').textContent = change;
    $('.evo-change').hidden = !change;
    $('.evo-btns').innerHTML = buttons.map(([act, label, cls]) =>
      `<button type="button" class="ovb ${cls}" data-evo="${act}">${esc(label)}</button>`).join('');
  }

  function open(ev, mode) {
    ensureEl();
    el.className = `evo-ov evo-${mode}`;
    showing = { ev, scene: null, timers: [], cardShown: false };
    return showing;
  }

  function later(fn, ms) {
    const s = showing;
    s.timers.push(setTimeout(() => { if (showing === s) fn(); }, ms));
  }

  function showCard() {
    if (!showing || showing.cardShown) return;
    showing.cardShown = true;
    el.classList.add('is-card');
    cueSfx('evolve.reveal');
    $('.evo-btns button')?.focus?.({ preventScroll: true });
  }

  // ---------- level-up ----------
  async function showLevel(ev) {
    const s = open(ev, 'level');
    const copy = evolutionCopy(ev.id, ev.to);
    setCard({ kicker: 'התפתחות!', title: copy.title, lvl: copy.levelName, change: copy.change ? `חדש: ${copy.change}` : '',
      buttons: [['close', 'המשך', 'p gold']] });
    const fromImg = $('.evo-still--from'), toImg = $('.evo-still--to');
    fromImg.src = boostieStillSrc(ev.id, ev.from, 'full');
    toImg.src = boostieStillSrc(ev.id, ev.to, 'full');
    fromImg.alt = `${boostieName(ev.id)} שלב ${ev.from}`;
    toImg.alt = `${boostieName(ev.id)} שלב ${ev.to}`;
    el.classList.remove('hidden');

    const reduced = prefersReducedMotion();
    if (!reduced && canUse3d()) {
      el.classList.add('is-loading');
      try {
        const scene = await Promise.race([
          importer().then((m) => m.createEvolutionScene({
            canvas: $('.evo-cv'),
            fromSrc: boostieModelSrc(ev.id, ev.from),
            toSrc: boostieModelSrc(ev.id, ev.to),
          })),
          new Promise((_, rej) => setTimeout(() => rej(new Error('load timeout')), LOAD_WAIT_MS)),
        ]);
        if (showing !== s) { scene?.dispose(); return; }
        s.scene = scene;
        el.classList.remove('is-loading');
        el.classList.add('is-3d');
        scene.onFlash(() => cueSfx('evolve.burst'));
        scene.onCard(() => { if (showing === s) showCard(); });
        scene.start();
        cueSfx('evolve.charge');
        return;
      } catch (e) {
        if (showing !== s) return;
        el.classList.remove('is-loading');
        console.warn('[boostie3d] evolution in stills:', e?.message || e);
      }
    }
    playStills(reduced);
  }

  function playStills(reduced) {
    el.classList.add('is-stills');
    if (reduced) {
      later(() => el.classList.add('is-swapped'), 400);
      later(showCard, 1200);
      return;
    }
    cueSfx('evolve.charge');
    el.classList.add('is-charging');
    later(() => { el.classList.add('is-flash'); cueSfx('evolve.burst'); }, EVO_T.charge * 1000);
    later(() => el.classList.add('is-swapped'), EVO_T.flashPeak * 1000);
    later(() => el.classList.remove('is-flash'), EVO_T.flashEnd * 1000);
    later(showCard, EVO_T.card * 1000);
  }

  // ---------- chain unlock ----------
  function showUnlock(ev) {
    open(ev, 'unlock');
    const name = boostieName(ev.id);
    setCard({ kicker: 'בוסטי חדש נפתח!', title: `${name} הצטרף אליך`, lvl: 'שלב 1', change: '',
      buttons: [['equip', 'בחר עכשיו', 'p gold'], ['close', 'אחר כך', '']] });
    const toImg = $('.evo-still--to');
    toImg.src = boostieStillSrc(ev.id, 1, 'full');
    toImg.alt = name;
    el.classList.remove('hidden');
    el.classList.add('is-stills', 'is-swapped');
    showCard();
  }

  // ---------- skip / close ----------
  function skip() {
    if (!showing || showing.cardShown) return;
    showing.timers.forEach(clearTimeout);
    showing.timers = [];
    showing.scene?.skip();
    el.classList.remove('is-charging', 'is-flash');
    el.classList.add('is-swapped');
    showCard();
  }

  function close() {
    const s = showing;
    if (!s) return;
    s.timers.forEach(clearTimeout);
    s.scene?.dispose();
    showing = null;
    el.className = 'evo-ov hidden';
    bus.emit(EVO_CLOSED, { ...s.ev });
    // A short breath before the next one.
    retry = setTimeout(pump, 350);
  }

  // ---------- wiring ----------
  cleanups.push(bus.on(endOpenEvent, () => { holdUntil = Date.now() + END_HOLD_MS; if (queue.length) pump(); }));
  cleanups.push(bus.on(EVO_SHOW, (ev = {}) => {
    if (!ev.id || !(ev.to > ev.from)) return;
    queue.unshift({ kind: 'level', id: ev.id, from: ev.from, to: ev.to });
    pump();
  }));
  const onKey = (e) => { if (e.key === 'Escape' && showing) (showing.cardShown ? close() : skip()); };
  doc?.addEventListener?.('keydown', onKey);

  return {
    noteProfile,
    _state: () => ({ queue: [...queue], showing: showing?.ev ?? null }),   // test hook
    _close: close,
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
      doc?.removeEventListener?.('keydown', onKey);
      clearTimeout(retry);
      if (showing) { showing.timers.forEach(clearTimeout); showing.scene?.dispose(); showing = null; }
      el?.remove();
      el = null;
    },
  };
}
