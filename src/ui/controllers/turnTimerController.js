import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { modeDescriptor } from '../../game/sessions/modes.js';
import { $, setText } from '../domHelpers.js';

export function createTurnTimerController({
  bus,
  root = globalThis.document,
  sessionRef = () => globalThis.__spine?.activeGame?.session ?? null,
  now = () => Date.now(),
  setIntervalFn = globalThis.setInterval?.bind(globalThis),
  clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
  tickMs = 250,
} = {}) {
  if (!bus) throw new Error('createTurnTimerController: bus required');

  const cleanups = [];
  let interval = null;
  let timedOutKey = null;
  // Last second-boundary value emitted on 'timer/tick'. Keyed by turn so a
  // fresh turn re-arms ticks even if the previous turn fired them already.
  let lastTickKey = null;
  let lastTickSec = null;
  // While >0, the timer is frozen: display shows the full per-turn allowance
  // and the auto-pass dispatch is suppressed. Bonus flows (mini-games, +N
  // overlays, wheel) bump this on start and decrement on completion so the
  // bot/opponent doesn't lose seconds while the human is in a boost flow.
  let bonusPauseCount = 0;
  // Menu pause (e.g. the "המשחק מושהה" overlay). Distinct from the bonus
  // pause because the user expects to come back to the SAME remaining time,
  // not a fresh full clock. We snapshot the remaining ms when game/paused
  // fires; on game/resumed we shift state.turnDeadlineMs forward by the
  // duration of the pause so remaining time is preserved.
  let menuPauseActive = false;
  let menuPauseRemainingMs = 0;

  // Clear any stale menu-pause state before the per-event sync runs. The
  // controller is created once at app boot and lives for the whole app
  // session, so a paused-then-saved game can leave `menuPauseActive=true`
  // hanging around — when the next game starts (fresh game OR a resumed
  // local save) sync() would otherwise display the previous game's frozen
  // remaining time and never tick. Registered BEFORE sync so the reset
  // fires first in the bus's FIFO Set iteration order.
  cleanups.push(bus.on(EV.GAME_STARTED, () => {
    menuPauseActive = false;
    menuPauseRemainingMs = 0;
  }));

  const eventTypes = [
    EV.GAME_STARTED,
    EV.TURN_CHANGED,
    EV.GAME_COMPLETED,
  ];
  for (const type of eventTypes) cleanups.push(bus.on(type, sync));

  // Bonus pause/resume. The names match what bonusActivationController and
  // gameScreen emit; we accept either path (mini-game pending → resolved,
  // or auto-bonus overlay → award-acknowledged).
  cleanups.push(bus.on('bonus/pending', pauseForBonus));
  cleanups.push(bus.on('bonus/resolved', resumeFromBonus));

  // Menu pause/resume. Preserves remaining time across the pause.
  cleanups.push(bus.on('game/paused',  freezeForMenuPause));
  cleanups.push(bus.on('game/resumed', resumeFromMenuPause));

  // Opponent boost mirror: pause this client's timer while the active
  // player is in a boost flow on the other side. We can't use the local
  // bonus/pending event because the boost activation event never fires
  // locally for the opponent — it's the room's `liveBonus` field that
  // tells us a boost is in progress. Pair pause/resume on the same
  // transition: liveBonus going active → pause, liveBonus going null →
  // resume. Only react when the boost belongs to the opponent — our own
  // bonus flow is already handled by the local bonus/pending path above.
  let opponentBonusActive = false;
  cleanups.push(bus.on(EV.LIVE_BONUS_CHANGED, ({ liveBonus } = {}) => {
    const session = sessionRef();
    const mySlot = session?.mySlot;
    const isOpponentBoost = liveBonus?.active
      && (mySlot === 0 || mySlot === 1)
      && liveBonus.slot !== mySlot;
    if (isOpponentBoost && !opponentBonusActive) {
      opponentBonusActive = true;
      pauseForBonus();
    } else if (!isOpponentBoost && opponentBonusActive) {
      opponentBonusActive = false;
      resumeFromBonus();
    }
  }));
  cleanups.push(bus.on(EV.BOOST_ACTIVATED, (payload) => {
    // Every fresh bonus-square activation opens the modal award overlay;
    // freeze the clock until the player acknowledges. Consumption events
    // (free_tile_swap being spent, etc.) reuse BOOST_ACTIVATED with
    // `consumed: true` and shouldn't freeze the timer. Same goes for the
    // `pending: true` turn-start reminder emitted by emitTurnStartEffects
    // for queued future-effect boosts (free_tile_swap waking up) — there's
    // no modal so there's nothing to freeze the timer behind.
    if (payload?.consumed || payload?.pending) return;
    pauseForBonus();
  }));
  cleanups.push(bus.on('bonus/award-acknowledged', resumeFromBonus));

  // Score-animation pause. After a move commits the score-merge sequence
  // (per-word chips → sum chip → boost merge → hold → flight → count-up)
  // runs for ~2 s before the next player effectively gets their clock.
  // Without this freeze, TURN_CHANGED would fire mid-animation and the
  // new player would lose those seconds while watching the previous
  // player's score pop in. Constants mirror gameScreen.playScoreMergeSequence
  // / animationController.scoreMergeTiming.
  const WORD_MERGE_STAGGER_MS = 250;
  const WORD_MERGE_FLIGHT_MS  = 380;
  const BOOST_MERGE_DELAY_MS  = 250;
  const HOLD_AFTER_MERGE_MS   = 420;
  const SUM_FLIGHT_MS         = 480;
  const COUNTUP_PEAK_MS       = 900;
  function scoreAnimationDurationMs(wordTiles, bonusExtra) {
    const wordCount = Array.isArray(wordTiles) ? wordTiles.length : 0;
    const extra = Number(bonusExtra) || 0;
    if (wordCount === 0 && extra === 0) return COUNTUP_PEAK_MS;
    const lastWordStart = wordCount > 0 ? (wordCount - 1) * WORD_MERGE_STAGGER_MS : 0;
    const boostStart    = extra > 0 ? lastWordStart + BOOST_MERGE_DELAY_MS : lastWordStart;
    const mergeEnd      = boostStart + WORD_MERGE_FLIGHT_MS;
    return mergeEnd + HOLD_AFTER_MERGE_MS + SUM_FLIGHT_MS + COUNTUP_PEAK_MS;
  }
  function freezeForScoreAnimation(payload) {
    // The deferred-bonus MOVE_CONFIRMED carries scoringDeferred=true — the
    // bonus pause path already covers that case (and the per-word floats
    // only fire on MOVE_SCORE_COMMITTED). Skip here so we don't double-
    // freeze and lose seconds.
    if (payload?.scoringDeferred) {
      // Still sync so the display refreshes; the regular MOVE_CONFIRMED
      // sync was removed above.
      sync();
      return;
    }
    const ms = scoreAnimationDurationMs(payload?.wordTiles, payload?.bonusExtra);
    if (ms <= 0) { sync(); return; }
    pauseForBonus();
    sync();
    setTimeout(resumeFromBonus, ms);
  }
  cleanups.push(bus.on(EV.MOVE_CONFIRMED,       freezeForScoreAnimation));
  cleanups.push(bus.on(EV.MOVE_SCORE_COMMITTED, freezeForScoreAnimation));
  cleanups.push(bus.on(EV.OPPONENT_MOVED,       freezeForScoreAnimation));

  sync();
  interval = setIntervalFn?.(sync, tickMs) ?? null;

  function freezeForMenuPause() {
    if (menuPauseActive) return; // idempotent
    const state = sessionRef()?.state;
    const deadline = Number(state?.turnDeadlineMs) || 0;
    menuPauseRemainingMs = deadline > 0 ? Math.max(0, deadline - now()) : 0;
    menuPauseActive = true;
    sync();
  }
  function resumeFromMenuPause() {
    if (!menuPauseActive) return; // idempotent
    menuPauseActive = false;
    const state = sessionRef()?.state;
    if (state && menuPauseRemainingMs > 0) {
      // Shift the deadline forward by however long the pause lasted, so
      // the player resumes with the same remaining time they paused on.
      state.turnDeadlineMs = now() + menuPauseRemainingMs;
      // Re-anchor the per-turn cache; the new deadline must override the
      // stale one ensureDeadline cached before the pause began.
      state._turnTimerKey = `${state.turnNumber}:${state.currentTurnSlot}`;
    }
    menuPauseRemainingMs = 0;
    timedOutKey = null; // allow a fresh auto-pass if we resume past the deadline
    sync();
  }

  function pauseForBonus() {
    bonusPauseCount += 1;
    sync();
  }
  function resumeFromBonus() {
    bonusPauseCount = Math.max(0, bonusPauseCount - 1);
    if (bonusPauseCount === 0) {
      // Force ensureDeadline to rebuild a fresh deadline for the current
      // turn — the player just acknowledged the bonus, so the next player
      // gets the full clock starting from `now`.
      //
      // Online modes are authoritative on the server: the committing client
      // already wrote `turnDeadlineMs = commitTime + limitMs` into the room,
      // and both clients render from that single value. If we zeroed it
      // here, `ensureDeadline` would fall through to the offline auto-set
      // branch and recompute a LOCAL deadline based on each client's
      // `now()` — guaranteeing 1-3 s of drift between the two windows.
      // Only reset the local cache key; leave turnDeadlineMs intact so the
      // online branch returns the room's value.
      const state = sessionRef()?.state;
      if (state) {
        state._turnTimerKey = null;
        const desc = modeDescriptor(state.mode);
        if (desc.hasTurnTimer !== true) state.turnDeadlineMs = 0;
      }
      timedOutKey = null;
    }
    sync();
  }

  function sync() {
    const session = sessionRef();
    const state = session?.state;
    const timerEl = $('#turn-timer-value', root);
    const wrap = $('#turn-timer', root);

    // Menu pause: freeze the display at the REMAINING time captured when
    // pause started, and suppress the auto-pass dispatch. Unlike the bonus
    // pause below, we don't display the full per-turn allowance — the
    // whole point of a menu pause is that the player resumes exactly where
    // they left off.
    if (menuPauseActive) {
      const desc = modeDescriptor(state?.mode);
      const timerEnabled = !!state?.settings?.timelimit
        && (desc.hasTurnTimer === true || desc.hasTurnTimer === 'optional');
      // Keep state.turnDeadlineMs continuously rebased to now() + remaining
      // so any external snapshot (e.g. saveLocalGame on "צא לתפריט") sees
      // the paused remaining, not a value decremented by the seconds the
      // player spent sitting on the pause overlay.
      if (state && menuPauseRemainingMs > 0) {
        state.turnDeadlineMs = now() + menuPauseRemainingMs;
      }
      if (state?.status === 'playing' && timerEnabled && menuPauseRemainingMs > 0) {
        const secs = Math.max(0, Math.ceil(menuPauseRemainingMs / 1000));
        setText(timerEl, String(secs));
        wrap?.classList?.add?.('active');
        wrap?.classList?.toggle?.('urgent', secs <= 10);
        wrap?.classList?.toggle?.('crit',  secs <= 5);
        wrap?.classList?.toggle?.('warn',  secs <= 10 && secs > 5);
      } else {
        setText(timerEl, '--');
        wrap?.classList?.remove?.('urgent', 'warn', 'crit', 'active');
      }
      return;
    }

    // Bonus pause: freeze the display at the full per-turn allowance and
    // skip the auto-pass dispatch. We do NOT call ensureDeadline here so
    // state.turnDeadlineMs isn't repeatedly rebuilt while paused; the next
    // resume() will clear it and the next sync will compute a fresh value.
    if (bonusPauseCount > 0) {
      // Honour the same enabled-check ensureDeadline applies — otherwise a
      // game played without a time-limit would briefly flash the timer
      // (e.g., the per-turn allowance) when this pause activates during a
      // score-animation freeze, then hide it again. Players reported this
      // as the timer "appearing while the score animation runs and then
      // disappearing again."
      const desc = modeDescriptor(state?.mode);
      const timerEnabled = !!state?.settings?.timelimit
        && (desc.hasTurnTimer === true || desc.hasTurnTimer === 'optional');
      const seconds = Number(state?.settings?.botTime
        ?? state?.settings?.turnSeconds
        ?? 0);
      if (state?.status === 'playing' && timerEnabled && seconds > 0) {
        setText(timerEl, String(seconds));
        wrap?.classList?.add?.('active');
        wrap?.classList?.remove?.('urgent', 'warn', 'crit');
      } else {
        setText(timerEl, '--');
        wrap?.classList?.remove?.('urgent', 'warn', 'crit', 'active');
      }
      return;
    }

    const deadline = ensureDeadline(state);

    if (!state || state.status !== 'playing' || !deadline) {
      setText(timerEl, '--');
      wrap?.classList?.remove('urgent', 'warn', 'crit', 'active');
      return;
    }

    const remainingMs = deadline - now();
    const secs = Math.max(0, Math.ceil(remainingMs / 1000));
    setText(timerEl, String(secs));
    wrap?.classList?.add?.('active');
    wrap?.classList?.toggle?.('urgent', secs <= 10);
    wrap?.classList?.toggle?.('crit', secs <= 5);
    wrap?.classList?.toggle?.('warn', secs <= 10 && secs > 5);

    // Emit a 'timer/tick' for the final 3,2,1 seconds — only on transitions
    // (not every 250 ms poll) and only once per turn at each value.
    const turnKey = `${state.turnNumber}:${state.currentTurnSlot}`;
    if (lastTickKey !== turnKey) {
      lastTickKey = turnKey;
      lastTickSec = null;
    }
    if (secs >= 1 && secs <= 3 && secs !== lastTickSec) {
      lastTickSec = secs;
      bus.emit('timer/tick', { secs });
    } else if (secs > 3) {
      lastTickSec = null;
    }

    if (remainingMs <= 0) {
      const key = `${state.turnNumber}:${state.currentTurnSlot}`;
      if (timedOutKey !== key) {
        timedOutKey = key;
        session.dispatch?.({
          type: CMD.PASS_TURN,
          payload: { reason: 'timeout' },
        });
      }
    }
  }

  function ensureDeadline(state) {
    if (!state) return null;
    const explicit = Number(state.turnDeadlineMs || 0);
    const key = `${state.turnNumber}:${state.currentTurnSlot}`;
    // Mid-turn re-entry: keep whatever deadline we already locked in for
    // this exact turn. Crucially we DON'T reuse a deadline from a previous
    // turn just because it hasn't expired yet — that's how a fast player
    // move could leave 18s of their clock on the bot's turn (and let the
    // bot effectively play twice in a row when the bot's "thinking" timer
    // outlasted the inherited deadline).
    if (state._turnTimerKey === key && explicit > 0) {
      return explicit;
    }

    const desc = modeDescriptor(state.mode);
    // 'optional' modes (offline-solo, offline-2p) only run a timer when the
    // user has the `timelimit` setting on. 'true' modes (live online) always
    // run. Online async + tutorial keep their old behavior.
    const enabled = !!state.settings?.timelimit
      && (desc.hasTurnTimer === true || desc.hasTurnTimer === 'optional');
    if (!enabled) {
      state._turnTimerKey = key;
      return explicit > 0 ? explicit : null;
    }

    // Online modes (hasTurnTimer === true) get their deadline from the room
    // / Firebase — trust whatever state.turnDeadlineMs currently holds for
    // this turn, even if it's in the past (so a timeout still fires). If
    // the room hasn't published a deadline yet (explicit == 0), return null
    // rather than auto-computing locally — a locally-computed deadline would
    // be anchored to this client's `now()` and drift away from the
    // opponent's locally-computed deadline by the network latency between
    // when each client reached this branch.
    if (desc.hasTurnTimer === true) {
      state._turnTimerKey = key;
      return explicit > 0 ? explicit : null;
    }

    // Offline / optional modes: each turn gets its own fresh clock. The
    // previous turn's deadline is discarded here so a fast move doesn't
    // bleed seconds onto the next player.
    const seconds = Number(state.settings?.botTime || state.settings?.turnSeconds || 0);
    if (seconds > 0) {
      state.turnDeadlineMs = now() + seconds * 1000;
      state._turnTimerKey = key;
      timedOutKey = null;
      return state.turnDeadlineMs;
    }
    return null;
  }

  function dispose() {
    if (interval != null) {
      clearIntervalFn?.(interval);
      interval = null;
    }
    for (const off of cleanups.splice(0)) {
      try { off(); } catch {}
    }
  }

  return { sync, dispose };
}
