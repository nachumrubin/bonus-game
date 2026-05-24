// Boost engine — plugin registry + lifecycle hooks.
//
// Each boost is an object exported from src/game/boosts/<id>.js with shape:
//
//   {
//     id: 'double_score',
//     name: 'בוסט כפול',
//     description: 'מכפיל את הניקוד בתור הזה',
//     trigger: 'beforeScoreCommit',           // hook name
//     canActivate(ctx): boolean,
//     apply(ctx): ctx,                        // runs locally
//     buildSyncPayload(ctx): payload,         // serialized to opponent
//     applyRemote(payload, ctx): ctx,         // runs on opponent's client
//     animationKey: 'doubleScoreFlash',
//   }
//
// Trigger names — small fixed list, every hook is opt-in:
//
//   beforeMoveValidate   // can short-circuit validation
//   afterMoveValidate    // can amend moveTiles
//   beforeScoreCommit    // can adjust ctx.score, ctx.words
//   afterScoreCommit     // can read final score
//   onTurnStart          // ctx = { state, slot }
//   onTurnEnd            // ctx = { state, slot }
//   onOpponentMove       // ctx = { state, lastMove }
//
// runHook(name, ctx) walks ctx.activeBoosts and runs each boost whose
// `trigger` matches `name`. The ctx is threaded through (each apply may
// return a new ctx). Boosts whose canActivate(ctx) is false are skipped.
// Errors in one boost don't break the others.

export const TRIGGERS = Object.freeze({
  BEFORE_MOVE_VALIDATE: 'beforeMoveValidate',
  AFTER_MOVE_VALIDATE:  'afterMoveValidate',
  BEFORE_SCORE_COMMIT:  'beforeScoreCommit',
  AFTER_SCORE_COMMIT:   'afterScoreCommit',
  ON_TURN_START:        'onTurnStart',
  ON_TURN_END:          'onTurnEnd',
  ON_OPPONENT_MOVE:     'onOpponentMove',
});

const REGISTRY = new Map();

export function register(boost) {
  if (!boost || typeof boost.id !== 'string') {
    throw new Error('boost must have a string id');
  }
  if (REGISTRY.has(boost.id)) {
    throw new Error(`boost ${boost.id} is already registered`);
  }
  REGISTRY.set(boost.id, boost);
}

export function get(id) {
  return REGISTRY.get(id) ?? null;
}

export function has(id) {
  return REGISTRY.has(id);
}

export function listIds() {
  return [...REGISTRY.keys()];
}

export function _resetRegistry() {
  REGISTRY.clear();
}

// runHook walks ctx.activeBoosts, runs every boost whose trigger matches,
// and returns an updated ctx. Each plugin's apply(ctx, entry) is called with
// both the current ctx and the activeBoost entry that triggered it; this is
// how plugins read their own payload.
//
// If a plugin defines consume(entry), it's called after apply. The return
// value replaces the entry in activeBoosts; null removes it. Plugins
// without consume() leave their entry untouched (typical for "permanent"
// modifiers; turn-bound effects use consume to decrement / remove themselves).
//
// Errors in one plugin do not block the others.
export function runHook(name, ctx) {
  const active = Array.isArray(ctx?.activeBoosts) ? ctx.activeBoosts : [];
  if (active.length === 0) return ctx;
  const nextActive = [];
  for (const entry of active) {
    const def = REGISTRY.get(entry.boostId);
    if (!def || def.trigger !== name) {
      nextActive.push(entry);
      continue;
    }
    try {
      if (def.canActivate && !def.canActivate(ctx, entry)) {
        nextActive.push(entry);
        continue;
      }
      const next = def.apply ? def.apply(ctx, entry) : ctx;
      if (next) ctx = next;
      if (def.consume) {
        const after = def.consume(entry);
        if (after !== null && after !== undefined) nextActive.push(after);
        // null/undefined → entry is dropped
      } else {
        nextActive.push(entry);
      }
    } catch (err) {
      console.error('[boost]', entry.boostId, name, err);
      nextActive.push(entry);
    }
  }
  return { ...ctx, activeBoosts: nextActive };
}

// Replay an opponent's boost result on this client by id + payload.
// Used when receiving an OPPONENT_MOVED event.
export function applyRemote(boostId, payload, ctx) {
  const def = REGISTRY.get(boostId);
  if (!def?.applyRemote) return ctx;
  try {
    return def.applyRemote(payload, ctx) ?? ctx;
  } catch (err) {
    console.error('[boost.applyRemote]', boostId, err);
    return ctx;
  }
}
