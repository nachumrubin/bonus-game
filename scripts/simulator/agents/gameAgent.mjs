// gameAgent.mjs — one simulated human player in a real online game.
//
// Each agent is a complete, independent client: its own Firebase app + auth
// (compatClient), its own bus, and the same spine modules main.js mounts for
// an online game — minus the DOM:
//
//   onlineGameSession          real Firebase transactions / watchers
//   gameController             the view-model the UI drives (placeTile,
//                              confirmMove, exchangeTiles, … incl. its race
//                              guards and illegal-word auto-pass)
//   turnTimerController        the local clock that auto-passes at the
//                              deadline (root=null → no DOM)
//   timeoutWatchdog            the opponent-side timeout claim
//   bonusActivationController  mini-game / wheel resolution
//   presence + disconnectController
//   liveBonus broadcast        copy of main.js attachBonusFlow's online block
//
// The agent is EVENT-DRIVEN: nothing ticks centrally. On its turn it plans
// WHAT to do (decide.mjs), WHEN to commit (timing.mjs) and the human
// in-between actions (humanBehavior.mjs), then executes through the
// controller at those times. Everything it does and sees is recorded for
// failure bundles and the soak report.

import { CMD } from '../../../src/events/commands.js';
import { EV } from '../../../src/events/eventTypes.js';
import * as roomService from '../../../src/game/online/roomService.js';
import { createOnlineGameSession } from '../../../src/game/sessions/onlineGameSession.js';
import { createGameController } from '../../../src/ui/controllers/gameController.js';
import { createTurnTimerController } from '../../../src/ui/controllers/turnTimerController.js';
import {
  createBonusActivationController, BONUS_RESOLVED, MINIGAME_CLOSED,
} from '../../../src/ui/controllers/bonusActivationController.js';
import { createTimeoutWatchdog, DEFAULT_WATCHDOG_GRACE_MS } from '../../../src/game/online/timeoutWatchdog.js';
import { startPresence } from '../../../src/game/online/presenceService.js';
import { createDisconnectController } from '../../../src/ui/controllers/disconnectController.js';
import { DISCONNECT_OPEN } from '../../../src/ui/screens/disconnectScreen.js';
import { serverNow } from '../../../src/game/online/serverClock.js';
import { sendReaction } from '../../../src/reactions/reactionService.js';
import { modeDescriptor } from '../../../src/game/sessions/modes.js';

import { createBus } from '../lib/bus.mjs';
import { decideTurn } from './decide.mjs';
import { planCommitTime, spreadActions } from './timing.mjs';
import { buildPreviewDrafts, buildLookups, chooseReaction, REACTION_COOLDOWN_MS } from './humanBehavior.mjs';
import { sampleMiniGameOutcome, sampleWheelOutcome, sampleMiniGameDwell } from './bonusOutcomes.mjs';

// Mirrors of UI-module constants that live in DOM-importing files.
const BONUS_AWARD_ACK = 'bonus/award-acknowledged'; // gameScreen.js
const AWARD_CLOSE_ANIM_MS = 320;                    // gameScreen.js close()
const MAX_REPLANS_PER_TURN = 3;

function isTerminal(status) {
  return status === 'completed' || status === 'abandoned' || status === 'expired';
}

/**
 * @param {object} o
 * @param {string} o.name                 'A' | 'B' (for logs)
 * @param {object} o.client               makeCompatUser() result
 * @param {object} o.persona              personas.mjs (withChaos applied)
 * @param {() => number} o.rng
 * @param {string[]} o.wordList
 * @param {(w: string) => boolean} o.isWordValid
 * @param {object} [o.opts]
 * @param {number} [o.opts.miniGameTimeScale=1]
 * @param {boolean} [o.opts.presence=true]
 * @param {object} [o.opts.allow]         decideTurn allow-list (prod safety)
 */
export function createGameAgent({ name, client, persona, rng, wordList, isWordValid, opts = {} }) {
  const { db, uid } = client;
  const bus = createBus({ label: name, record: true, now: serverNow });
  const timers = new Set();
  const stats = {
    turns: 0, commandsByKind: {}, rejects: {}, syncRejected: 0, replans: 0,
    previews: 0, previewWrites: 0, lookups: 0, lookupsValid: 0,
    reactionsSent: 0, reactionsBlocked: 0, reactionsReceived: 0, reactionErrors: 0,
    bonus: { minigame: {}, wheel: {}, award: 0, vetoed: 0 },
    deadline: [], // { phase, edge, plannedOffset, actualOffset, kind, outcome }
    liveBonusWrites: 0, disconnectOpens: 0,
    timeoutsClaimedByMe: 0,
  };
  const chosenExtras = []; // { turnNumber, idx, kind, extra, outcomeId? } — oracle cross-check

  let room = null;
  let mySlot = null;
  let session = null;
  let controller = null;
  let bonusCtl = null;
  let turnTimer = null;
  let watchdog = null;
  let presence = null;
  let disconnectCtl = null;
  const subs = [];
  let disposed = false;
  let plannedTurnKey = null;
  // Turn generation: bumped whenever the observed turn key changes. A plan's
  // pending steps only run in the generation they were planned in, so a turn
  // that is rolled back (e.g. a phantom optimistic state) and later re-reached
  // gets a fresh plan instead of being skipped or double-played.
  let turnGen = 0;
  let lastSeenKey = null;
  function observeTurnKey() {
    const k = turnKey();
    if (k !== lastSeenKey) {
      lastSeenKey = k;
      turnGen++;
      if (plannedTurnKey !== k) plannedTurnKey = null;
    }
    return turnGen;
  }
  let replansThisTurn = 0;
  let inFlight = 0;
  let bonusFlowBusy = false;
  let lastReactionAt = 0;
  let pendingOutcome = null; // deadline record awaiting its outcome
  let lastPreviewSig = null;

  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  // ── helpers ──────────────────────────────────────────────────────────────
  function at(serverMs, fn) {
    if (disposed) return null;
    const h = setTimeout(() => { timers.delete(h); if (!disposed) safe(fn); }, Math.max(0, serverMs - serverNow()));
    timers.add(h);
    return h;
  }
  function after(ms, fn) { return at(serverNow() + ms, fn); }
  function safe(fn) {
    try { const r = fn(); if (r?.catch) r.catch(err => note('agent/error', { message: String(err?.message ?? err) })); }
    catch (err) { note('agent/error', { message: String(err?.message ?? err), stack: err?.stack?.split('\n').slice(0, 4).join(' | ') }); }
  }
  function note(type, p = {}) { bus.log.push({ t: serverNow(), type, p }); }
  function count(map, key) { map[key] = (map[key] ?? 0) + 1; }
  function state() { return session?.state ?? null; }
  function turnKey(s = state()) { return s ? `${s.turnNumber}:${s.currentTurnSlot}` : null; }
  function myTurn(s = state()) { return !!s && s.status === 'playing' && s.currentTurnSlot === mySlot; }
  function limitMs() { return roomService.turnLimitMsFromSettings(state()?.settings ?? room?.settings ?? {}); }
  function timed() {
    const s = state();
    return !!s && modeDescriptor(s.mode).hasTurnTimer === true && !!s.settings?.timelimit && limitMs() > 0;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /** Coin screen + ready handshake (live rooms), then mount the game. */
  async function join(initialRoom, slot) {
    room = initialRoom;
    mySlot = slot;
    const isAsync = (room.mode ?? '').endsWith('-async');
    if (!isAsync && room.status !== 'playing') {
      // Coin-toss screen: the player taps through after 1–4 s.
      await sleep(1000 + rng() * 3000);
      if (disposed) return;
      room = await waitForStart();
      if (!room || disposed) return;
    }
    await mount(room);
  }

  function waitForStart() {
    return new Promise((resolve) => {
      let finished = false;
      let unwatch = null;
      const timeout = setTimeout(() => finish(null, 'start-timeout'), 60_000);
      const finish = (r, why) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        try { unwatch?.(); } catch { /* swallow */ }
        if (why) note('agent/start-failed', { why });
        resolve(r);
      };
      const maybe = (latest) => {
        if (!latest) return;
        const r0 = !!(latest.ready?.[0] ?? latest.ready?.['0']);
        const r1 = !!(latest.ready?.[1] ?? latest.ready?.['1']);
        if (latest.status === 'playing' && r0 && r1) finish(latest);
        else if (isTerminal(latest.status)) finish(null, `terminal-before-start:${latest.status}`);
      };
      unwatch = roomService.watchRoom(db, room.roomId, maybe);
      roomService.markReadyAndMaybeStart(db, room.roomId, mySlot, serverNow()).then(maybe).catch((e) => {
        note('agent/ready-failed', { message: String(e?.message ?? e) });
      });
    });
  }

  async function mount(r) {
    session = await createOnlineGameSession({ bus, db, room: r, mySlot });
    controller = createGameController({ bus, session, mySlot });
    bonusCtl = createBonusActivationController({ bus, session });
    turnTimer = createTurnTimerController({ bus, root: null, sessionRef: () => session, now: serverNow });
    attachLiveBonusBroadcast();
    attachBonusPlayer();
    attachReactions();
    attachTurnDriver();
    attachOutcomeTracking();

    const isAsync = (r.mode ?? '').endsWith('-async');
    if (!isAsync && r.settings?.timelimit) {
      const seconds = Number(r.settings.botTime || r.settings.turnSeconds || 0);
      if (seconds > 0) {
        watchdog = createTimeoutWatchdog({ db, roomId: r.roomId, mySlot, limitMs: seconds * 1000, now: serverNow });
      }
    }
    if (opts.presence !== false) {
      presence = await startPresence(db, { uid, currentRoom: r.roomId, serverTimestamp: () => serverNow(), doc: null })
        .catch((e) => { note('agent/presence-failed', { message: String(e?.message ?? e) }); return null; });
      disconnectCtl = createDisconnectController({ bus, dbRef: () => db, sessionRef: () => session });
      subs.push(bus.on(DISCONNECT_OPEN, (p) => { stats.disconnectOpens++; note('agent/disconnect-open', p ?? {}); }));
    }

    subs.push(bus.on(EV.GAME_COMPLETED, (p) => {
      note('agent/game-completed', { status: state()?.status, ...(p ?? {}) });
      maybeReact('gameEnd', 0.6);
      // Give the completion write + reaction a moment, then report done.
      after(1500, () => resolveDone({ status: state()?.status }));
    }));

    session.start();
    // Pre-warm the transaction cache (see gameRunner Phase 2).
    await db.ref(`rooms/${r.roomId}`).once('value');
    disconnectCtl?.resubscribe?.();
    maybeReact('gameStart', 0.35);
    maybePlanTurn('mount');
    if (isTerminal(state()?.status)) resolveDone({ status: state()?.status });
  }

  // ── turn driver ──────────────────────────────────────────────────────────
  function attachTurnDriver() {
    for (const ev of [EV.GAME_STARTED, EV.TURN_CHANGED, EV.MOVE_SCORE_COMMITTED, EV.OPPONENT_MOVED]) {
      subs.push(bus.on(ev, () => after(0, () => maybePlanTurn(ev))));
    }
    subs.push(bus.on(EV.INVALID_MOVE_REJECTED, ({ reason } = {}) => {
      count(stats.rejects, reason ?? 'unknown');
      if (inFlight > 0) inFlight--;
      // word-not-in-dictionary → gameController auto-passes after its shake
      // animation (real behaviour). Anything else: the player fixes it.
      if (reason === 'word-not-in-dictionary') return;
      if (!myTurn() || replansThisTurn >= MAX_REPLANS_PER_TURN) return;
      replansThisTurn++;
      stats.replans++;
      after(500 + rng() * 1500, () => {
        controller.recallAll();
        executePlan(decideTurn(state(), mySlot, persona, rng, ctxFor({ illegal: false, lock: false, walkAway: false, resign: false })), { replan: true });
      });
    }));
    subs.push(bus.on('evt/SYNC_REJECTED', (p) => {
      stats.syncRejected++;
      if (inFlight > 0) inFlight--;
      note('agent/sync-rejected', p ?? {});
    }));
  }

  function ctxFor(allowOverride = {}) {
    return { wordList, isWordValid, timed: timed(), allow: { ...(opts.allow ?? {}), ...allowOverride } };
  }

  function maybePlanTurn(trigger) {
    if (disposed || !session) return;
    const s = state();
    const gen = observeTurnKey();
    if (!myTurn(s) || bonusFlowBusy) return;
    const key = turnKey(s);
    if (key === plannedTurnKey) return;
    plannedTurnKey = key;
    replansThisTurn = 0;
    stats.turns++;

    const now = serverNow();
    const deadline = timed() ? Number(s.turnDeadlineMs) || (now + limitMs()) : null;
    const plan = decideTurn(s, mySlot, persona, rng, ctxFor());
    const when = planCommitTime({ rng, persona, nowMs: now, deadlineMs: deadline, limitMs: timed() ? limitMs() : 0, graceMs: DEFAULT_WATCHDOG_GRACE_MS });
    note('agent/plan', { trigger, key, kind: plan.kind, phase: when.phase, edge: when.edge, offset: when.offsetFromDeadlineMs });

    // In-between human actions.
    const drafts = (plan.kind === 'move' || plan.kind === 'illegal')
      ? buildPreviewDrafts(s, plan.placed, rng, persona.previewsPerTurn) : [];
    const lookups = buildLookups(s.racks?.[mySlot], plan.word, rng, persona.lookupsPerTurn);
    const steps = [
      ...drafts.map(d => ({ kind: 'preview', d })),
      ...lookups.map(w => ({ kind: 'lookup', w })),
    ];
    if (plan.freeSwapLetters?.length) steps.unshift({ kind: 'freeSwap', letters: plan.freeSwapLetters });
    if (plan.kind === 'pass' || (plan.kind === 'exchange' && plan.reason === 'poor-rack')) steps.push({ kind: 'react', ctx: 'stuck' });
    const times = spreadActions({ rng, nowMs: now, commitAtMs: when.atMs, n: steps.length });
    steps.forEach((st, i) => at(times[i], () => runStep(st, key, gen)));

    if (plan.kind === 'walkAway') {
      stats.deadline.push({ phase: 'walkAway', edge: null, plannedOffset: null, actualOffset: null, kind: 'walkAway', outcome: 'pending' });
      pendingOutcome = stats.deadline[stats.deadline.length - 1];
      return; // the turn timer / opponent watchdog end this turn
    }
    at(when.atMs, () => {
      if (observeTurnKey() !== gen || turnKey() !== key) {
        // Our turn ended before we acted (timeout auto-pass / watchdog claim).
        stats.deadline.push({ phase: when.phase, edge: when.edge, plannedOffset: when.offsetFromDeadlineMs, actualOffset: null, kind: plan.kind, outcome: 'turn-gone-before-action' });
        return;
      }
      // A free swap changed the rack — re-plan the real move against it.
      const finalPlan = plan.freeSwapLetters?.length
        ? decideTurn(state(), mySlot, persona, rng, ctxFor({ resign: false, walkAway: false }))
        : plan;
      const rec = {
        phase: when.phase, edge: when.edge, plannedOffset: when.offsetFromDeadlineMs,
        actualOffset: deadline ? Math.round(serverNow() - Number(state()?.turnDeadlineMs || deadline)) : null,
        kind: finalPlan.kind, outcome: 'pending',
      };
      stats.deadline.push(rec);
      pendingOutcome = rec;
      executePlan(finalPlan, { key });
    });
  }

  function runStep(st, key, gen) {
    if (observeTurnKey() !== gen || turnKey() !== key || !myTurn()) return;
    switch (st.kind) {
      case 'preview': {
        controller.recallAll();
        const rack = [...(state().racks?.[mySlot] ?? [])];
        const used = new Set();
        for (const t of st.d) {
          const idx = rackIndexFor(rack, t, used);
          controller.placeTile({ ...t, rackIndex: idx });
        }
        stats.previews++;
        writePreview();
        break;
      }
      case 'lookup': {
        stats.lookups++;
        if (isWordValid(st.w)) stats.lookupsValid++;
        note('agent/lookup', { word: st.w });
        break;
      }
      case 'freeSwap': {
        count(stats.commandsByKind, 'freeSwap');
        controller.exchangeTiles(st.letters, { freeSwap: true });
        break;
      }
      case 'react':
        maybeReact(st.ctx, persona.reactionChance * 2);
        break;
      default:
    }
  }

  function rackIndexFor(rack, tile, used) {
    const want = tile.isJoker ? '?' : tile.letter;
    for (let i = 0; i < rack.length; i++) {
      if (!used.has(i) && rack[i] === want) { used.add(i); return i; }
    }
    return null;
  }

  // Mirror main.js GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED → setLivePreview
  // (deduped on an identical payload).
  function writePreview() {
    const tiles = controller.view.placed.map(p => ({ r: p.r, c: p.c, letter: p.letter, val: p.val, isJoker: !!p.isJoker }));
    const sig = JSON.stringify(tiles);
    if (sig === lastPreviewSig) return;
    lastPreviewSig = sig;
    stats.previewWrites++;
    roomService.setLivePreview(db, room.roomId, { slot: mySlot, tiles }).catch((e) => note('agent/preview-failed', { message: String(e?.message ?? e) }));
  }

  function executePlan(plan, { replan = false } = {}) {
    if (!plan) return;
    count(stats.commandsByKind, plan.kind + (replan ? '(replan)' : ''));
    note('agent/execute', { kind: plan.kind, word: plan.word ?? null, lock: plan.lock ?? null });
    inFlight++;
    let accepted = true;
    switch (plan.kind) {
      case 'move':
      case 'illegal': {
        controller.recallAll();
        const rack = [...(state().racks?.[mySlot] ?? [])];
        const used = new Set();
        for (const t of plan.placed) {
          controller.placeTile({ ...t, rackIndex: t.rackIndex ?? rackIndexFor(rack, t, used) });
        }
        if (plan.lock) controller.setPendingLock(plan.lock);
        writePreview();
        accepted = controller.confirmMove();
        break;
      }
      case 'lockOnly':
        controller.recallAll();
        if (controller.setPendingLock(plan.lock)) accepted = controller.confirmMove();
        else { accepted = false; controller.passTurn(); }
        break;
      case 'exchange':
        if (plan.letters?.length) controller.exchangeTiles(plan.letters);
        else controller.passTurn();
        break;
      case 'pass': controller.passTurn(); break;
      case 'resign': controller.resign(); break;
      case 'stallClaim': session.dispatch({ type: CMD.CLAIM_STALL_END, payload: { slot: mySlot } }); break;
      default: accepted = false;
    }
    if (!accepted) {
      inFlight = Math.max(0, inFlight - 1);
      const reason = controller.view.lastInvalidReason ?? 'controller-refused';
      if (pendingOutcome && pendingOutcome.outcome === 'pending') pendingOutcome.outcome = `refused:${reason}`;
      note('agent/refused', { kind: plan.kind, reason });
    }
  }

  // Resolve the deadline record's outcome from the first decisive event.
  function attachOutcomeTracking() {
    const settle = (outcome) => {
      if (inFlight > 0 && outcome !== 'opponent-claimed-timeout') inFlight = Math.max(0, inFlight - 1);
      if (pendingOutcome && pendingOutcome.outcome === 'pending') {
        pendingOutcome.outcome = outcome;
        pendingOutcome = null;
      }
    };
    subs.push(bus.on(EV.TURN_CHANGED, (p = {}) => {
      const prev = p.prevSlot;
      const reason = p.reason ?? 'sync';
      if (prev === mySlot || prev == null) settle(`turn-changed:${reason}`);
    }));
    subs.push(bus.on(EV.MOVE_CONFIRMED, (p = {}) => {
      if (p.slot === mySlot && p.scoringDeferred) settle('committed-deferred');
    }));
    subs.push(bus.on('evt/SYNC_REJECTED', () => settle('sync-rejected')));
    subs.push(bus.on(EV.GAME_COMPLETED, () => settle('game-completed')));
  }

  // ── bonus flow (my slot) ─────────────────────────────────────────────────
  function attachBonusPlayer() {
    // Mini-game / wheel: play it, show the result, tap המשך.
    subs.push(bus.on(EV.BONUS_PENDING, (pending = {}) => {
      if (pending.slot !== mySlot) return;
      bonusFlowBusy = true;
      const kind = pending.kind ?? 'minigame';
      const key = pending.miniGameKey ?? 'unknown';
      const { playMs, resultDwellMs } = sampleMiniGameDwell(kind, key, rng, { timeScale: opts.miniGameTimeScale ?? 1 });
      note('agent/bonus-start', { kind, key, playMs });
      // Live progress ticks (the real mini-games emit these every second).
      const t0 = serverNow();
      const totalSecs = Math.ceil(playMs / 1000);
      for (let s = 1; s < totalSecs; s++) {
        after(s * 1000, () => bus.emit('liveBonus/progress', { secsLeft: totalSecs - s, score: null, label: null }));
      }
      after(playMs, () => {
        let res;
        if (kind === 'wheel') {
          const outcomeId = sampleWheelOutcome(rng);
          res = bonusCtl.resolveWheel({ outcomeId });
          count(stats.bonus.wheel, outcomeId);
          chosenExtras.push({ turnNumber: pending.turnNumber, idx: pending.idx, kind, outcomeId });
        } else {
          const outcome = sampleMiniGameOutcome(key, rng);
          res = bonusCtl.resolveMiniGame(outcome);
          count(stats.bonus.minigame, `${key}:${outcome.success ? 'win' : 'lose'}`);
          chosenExtras.push({ turnNumber: pending.turnNumber, idx: pending.idx, kind, extra: outcome.success ? outcome.earnedPts : 0 });
        }
        note('agent/bonus-resolved', { kind, key, ok: res?.ok, reason: res?.reason, elapsed: serverNow() - t0 });
        after(resultDwellMs, () => {
          bus.emit(MINIGAME_CLOSED, {});
          bonusFlowBusy = false;
          after(0, () => maybePlanTurn('bonus-closed'));
        });
      });
    }));

    // Auto / future award card: read it, tap אישור (gameScreen close()).
    subs.push(bus.on(EV.BOOST_ACTIVATED, ({ slot, boostId, bonusIdx, payload, consumed, pending } = {}) => {
      if (slot !== mySlot || consumed || pending) return;
      stats.bonus.award++;
      bonusFlowBusy = true;
      const extra = boostId === 'auto_extra_score' ? (Number(payload?.extra) || 0) : 0;
      chosenExtras.push({ turnNumber: state()?.turnNumber, idx: bonusIdx, kind: 'award', boostId, extra });
      after(600 + rng() * 2400, () => {
        controller.finalizeBoostAward({ slot, extra, bonusIdx });
        after(AWARD_CLOSE_ANIM_MS, () => {
          bus.emit(BONUS_AWARD_ACK, { slot, boostId, extra });
          bonusFlowBusy = false;
          after(0, () => maybePlanTurn('award-closed'));
        });
      });
    }));
    subs.push(bus.on(EV.BONUS_VETOED, ({ slot } = {}) => { if (slot === mySlot) stats.bonus.vetoed++; }));
  }

  // Copy of main.js attachBonusFlow's online liveBonus block: broadcast the
  // active bonus to the room so the opponent freezes their timer/watchdog.
  function attachLiveBonusBroadcast() {
    let current = null;
    let active = false;
    let lastDeferredMove = null;
    let lastProgressSig = null;
    const write = (payload) => {
      const withMove = payload && lastDeferredMove
        ? { ...payload, words: lastDeferredMove.words, moveScore: lastDeferredMove.score }
        : payload;
      current = withMove;
      stats.liveBonusWrites++;
      roomService.setLiveBonus(db, room.roomId, withMove).catch((e) => note('agent/livebonus-failed', { message: String(e?.message ?? e) }));
    };
    const clear = () => { lastDeferredMove = null; write(null); };
    subs.push(bus.on(EV.MOVE_CONFIRMED, ({ slot, words, score, scoringDeferred } = {}) => {
      if (slot !== mySlot || !scoringDeferred) return;
      lastDeferredMove = { words: Array.isArray(words) ? words.filter(Boolean) : [], score: Number(score) || 0 };
    }));
    subs.push(bus.on(EV.BONUS_PENDING, (p) => {
      if (!p || p.slot !== mySlot) return;
      active = true;
      write({ slot: mySlot, kind: p.kind ?? 'minigame', bonusType: p.bonusType ?? null, title: String(p.bonusType ?? 'bonus'), desc: '', icon: null });
    }));
    subs.push(bus.on(EV.BOOST_ACTIVATED, ({ slot, boostId, payload, consumed, pending } = {}) => {
      if (consumed || pending || slot !== mySlot) return;
      active = true;
      const extra = Number(payload?.extra) || 0;
      write({ slot: mySlot, kind: 'award', bonusType: null, title: boostId === 'auto_extra_score' ? '🎉 בוסט!' : '⚡ בוסט!', desc: extra ? `+${extra} נקודות` : null, icon: '🎁' });
    }));
    subs.push(bus.on(EV.MOVE_SCORE_COMMITTED, ({ slot } = {}) => { if (slot === mySlot && active) { active = false; clear(); } }));
    subs.push(bus.on(EV.TURN_CHANGED, () => { if (active) { active = false; clear(); } }));
    subs.push(bus.on(BONUS_RESOLVED, ({ slot, earnedPts, skipped } = {}) => {
      if (slot !== mySlot || !active) return;
      if (Number(earnedPts) > 0 && !skipped) return;
      active = false; clear();
    }));
    subs.push(bus.on(BONUS_AWARD_ACK, ({ slot } = {}) => { if (slot === mySlot && active) { active = false; clear(); } }));
    subs.push(bus.on('liveBonus/progress', (progress = {}) => {
      if (!active || !current) return;
      const sig = JSON.stringify({ secsLeft: progress.secsLeft ?? null, score: progress.score ?? null, label: progress.label ?? null });
      if (sig === lastProgressSig) return;
      lastProgressSig = sig;
      write({ ...current, progress });
    }));
  }

  // ── reactions ────────────────────────────────────────────────────────────
  function attachReactions() {
    subs.push(bus.on(EV.REACTION_RECEIVED, ({ reaction } = {}) => {
      if (reaction?.senderSlot !== mySlot) stats.reactionsReceived++;
    }));
    const onScore = ({ slot, score, bonusExtra } = {}) => {
      if (slot == null) return;
      if (slot !== mySlot) {
        if (Number(bonusExtra) > 0) maybeReact('opponentBonus');
        else if (Number(score) >= 25) maybeReact('opponentBig');
        else maybeReact('opponentSmall', persona.reactionChance * 0.2);
      } else if (Number(score) >= 30) {
        maybeReact('myBig', persona.reactionChance * 0.5);
      }
      const s = state();
      if (s && s.status === 'playing') {
        const diff = (s.scores?.[mySlot] ?? 0) - (s.scores?.[1 - mySlot] ?? 0);
        if (diff < -60) maybeReact('behind', persona.reactionChance * 0.15);
        else if (Math.abs(diff) < 10 && s.turnNumber > 10) maybeReact('close', persona.reactionChance * 0.1);
      }
    };
    subs.push(bus.on(EV.OPPONENT_MOVED, onScore));
    // Load test: how long after the opponent made a move did we see it?
    // lastMove.ts is stamped by the opponent's engine at commit time; both
    // agents of a game share one process clock, so this is exact.
    if (typeof opts.onSample === 'function') {
      subs.push(bus.on(EV.OPPONENT_MOVED, () => {
        const ts = Number(state()?.moveHistory?.at?.(-1)?.ts);
        if (Number.isFinite(ts) && ts > 0) opts.onSample({ kind: 'visible', ms: Date.now() - ts });
      }));
    }
    subs.push(bus.on(EV.MOVE_SCORE_COMMITTED, onScore));
    // Impatient poke while waiting on a slow opponent.
    subs.push(bus.on(EV.TURN_CHANGED, () => {
      const s = state();
      if (!s || s.currentTurnSlot === mySlot) return;
      const key = turnKey(s);
      after(15_000 + rng() * 20_000, () => {
        if (turnKey() === key && state()?.status === 'playing') maybeReact('waiting', persona.reactionChance * 0.3);
      });
    }));
  }

  function maybeReact(context, chance = persona.reactionChance) {
    if (disposed || !room || rng() >= chance) return;
    const reaction = chooseReaction(context, rng);
    if (!reaction) return;
    after(500 + rng() * 2500, () => {
      const now = serverNow();
      // Real controller refuses inside the cooldown (canSendReaction); some
      // impatient taps land inside it — count them, don't send them.
      if (now - lastReactionAt < REACTION_COOLDOWN_MS) { stats.reactionsBlocked++; return; }
      lastReactionAt = now;
      stats.reactionsSent++;
      note('agent/reaction', { context, ...reaction });
      sendReaction(db, room.roomId, { ...reaction, senderSlot: mySlot }).catch((e) => {
        stats.reactionErrors++;
        note('agent/reaction-failed', { message: String(e?.message ?? e) });
      });
    });
  }

  // ── teardown ─────────────────────────────────────────────────────────────
  async function dispose() {
    if (disposed) return;
    disposed = true;
    for (const h of timers) clearTimeout(h);
    timers.clear();
    for (const off of subs.splice(0)) { try { off(); } catch { /* swallow */ } }
    try { watchdog?.dispose?.(); } catch { /* swallow */ }
    try { disconnectCtl?.dispose?.(); } catch { /* swallow */ }
    try { turnTimer?.dispose?.(); } catch { /* swallow */ }
    try { bonusCtl?.dispose?.(); } catch { /* swallow */ }
    try { controller?.dispose?.(); } catch { /* swallow */ }
    try { await presence?.stop?.(); } catch { /* swallow */ }
    try { await session?.dispose?.(); } catch { /* swallow */ }
    resolveDone({ status: state()?.status ?? 'disposed' });
  }

  return {
    name, uid, persona, bus, stats, chosenExtras, done,
    get mySlot() { return mySlot; },
    get session() { return session; },
    get controller() { return controller; },
    get roomId() { return room?.roomId ?? null; },
    // Not quiescent: a command awaiting its outcome, a bonus flow open, or
    // (with simulated latency) writes still travelling to/from the server.
    get busy() { return inFlight > 0 || bonusFlowBusy || (client.netStats?.inflight ?? 0) > 0; },
    join,
    dispose,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
