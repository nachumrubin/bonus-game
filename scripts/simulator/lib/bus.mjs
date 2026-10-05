// bus.mjs — per-client event bus for simulator agents.
//
// Same surface as the app's module-level bus (on / emit) so every spine
// module (onlineGameSession, gameController, bonusActivationController,
// turnTimerController, …) can be wired to it unchanged. Each simulated
// client gets its OWN bus: two clients on one bus would see each other's
// re-emissions and double-commit (see gameRunner.mjs Phase 2 comment).
//
// Optional ring-buffer recorder: keeps the last `recordLimit` events with a
// compact payload summary so a failure bundle can show what each client saw
// right before things went wrong.

const SUMMARY_KEYS = [
  'slot', 'mySlot', 'currentTurnSlot', 'turnNumber', 'score', 'baseScore',
  'bonusExtra', 'words', 'reason', 'status', 'boostId', 'bonusType', 'kind',
  'extra', 'idx', 'bonusIdx', 'scoringDeferred', 'consumed', 'pending',
  'outcomeId', 'earnedPts', 'success', 'winnerSlot', 'abandonedBy', 'version',
];

export function summarizePayload(payload) {
  if (payload == null || typeof payload !== 'object') return payload ?? null;
  const out = {};
  for (const k of SUMMARY_KEYS) {
    if (payload[k] !== undefined) out[k] = payload[k];
  }
  if (Array.isArray(payload.placed)) out.placedN = payload.placed.length;
  if (payload.liveBonus !== undefined) out.liveBonusActive = !!payload.liveBonus?.active;
  return out;
}

export function createBus({ label = '', record = false, recordLimit = 2000, now = () => Date.now(), trace = !!process.env.SIM_DEBUG_BUS } = {}) {
  const subs = new Map();
  const log = [];
  let errors = 0;
  return {
    label,
    log,
    get subscriberCount() {
      let n = 0;
      for (const set of subs.values()) n += set.size;
      return n;
    },
    get handlerErrors() { return errors; },
    on(type, fn) {
      let set = subs.get(type);
      if (!set) { set = new Set(); subs.set(type, set); }
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(type, payload) {
      if (record) {
        log.push({ t: now(), type, p: summarizePayload(payload) });
        if (log.length > recordLimit) log.splice(0, log.length - recordLimit);
      }
      if (trace) console.log(`[bus ${label}] ${type}`, JSON.stringify(payload)?.slice(0, 160));
      const set = subs.get(type);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(payload); } catch (err) {
          errors++;
          if (record) log.push({ t: now(), type: 'sim/handler-error', p: { on: type, message: String(err?.message ?? err) } });
          console.error(`[sim-bus ${label}]`, type, err);
        }
      }
    },
  };
}
