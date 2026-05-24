// Tiny pub/sub used by core engine, sessions, online layer, notifications, UI.
//
// Two flavors of message flow through this bus:
//   - commands (intent: PLACE_TILES, CONFIRM_MOVE, ...) — dispatched by UI/sessions
//   - events   (fact:    MOVE_CONFIRMED, TURN_CHANGED, ...) — emitted by the engine
//
// Subscribers register with on(type, fn) and receive payloads in emit order.
// A subscriber that throws does not block other subscribers.

const subs = new Map();

/**
 * Subscribe to a command or event type.
 * @param {string} type
 * @param {(payload: any) => void} fn
 * @returns {() => void} Unsubscribe callback.
 */
export function on(type, fn) {
  let set = subs.get(type);
  if (!set) {
    set = new Set();
    subs.set(type, set);
  }
  set.add(fn);
  return () => off(type, fn);
}

/**
 * Remove a previously registered subscriber.
 * @param {string} type
 * @param {(payload: any) => void} fn
 * @returns {void}
 */
export function off(type, fn) {
  subs.get(type)?.delete(fn);
}

/**
 * Emit a payload to every subscriber for a type.
 * Subscriber errors are logged and do not stop later subscribers.
 * @param {string} type
 * @param {any} [payload]
 * @returns {void}
 */
export function emit(type, payload) {
  const set = subs.get(type);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch (err) {
      console.error('[bus]', type, err);
    }
  }
}

/**
 * Clear all subscriptions. Intended for tests.
 * @returns {void}
 */
export function _reset() {
  subs.clear();
}
