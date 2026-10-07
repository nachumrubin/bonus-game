// homeAvatarLive — the player's Boostie, alive in the home screen's top-bar avatar
// (.em-avatar-wrap around #home-avatar-ic). Same live 3D as the scoreboard (one slot of
// scoreboardLive), in lively mode: the eyes keep looking around and the head follows,
// and every few seconds it does a gesture (yawn, stare, its signature move…). The 3D
// runs only while the home screen (#sh) is showing, and is torn down (WebGL freed) as
// soon as it hides; the still <img> underneath is the fallback and what every other
// screen shows.
//
// The avatar is only 34px here, so the gestures are frequent on purpose. They are idle
// moves on the player's own avatar on their own screen, not reactions sent to anyone
// (D-boostie-reactions still holds for the game).

import { createScoreboardLive, canUseLive3d } from './scoreboardLive.js';

const GESTURE_FIRST_MS = 1200;                // a hello soon after the home screen shows
const GESTURE_EVERY_MS = [5000, 9000];         // then every few seconds (random in range)
// Clips every Boostie has; a model without one is skipped (play() returns false).
export const HOME_GESTURES = Object.freeze(['yawn', 'signature', 'stare', 'wow', 'wink', 'laugh']);
const LOOK = { lively: true, yaw: 0.3 };       // nearly facing the viewer, so the eyes read

export function mountHomeAvatarLive({
  doc = globalThis.document,
  getAvatar = () => null,                     // the equipped avatar value ('zapi:4' …) or null
  prefersReducedMotion = () => false,
  enabled = canUseLive3d(),
  createLive = (opts) => createScoreboardLive(opts),
  random = Math.random,
} = {}) {
  const screen = doc?.getElementById?.('sh');
  const icon = doc?.getElementById?.('home-avatar-ic');
  const host = icon?.closest?.('.em-avatar-wrap') ?? null;
  if (!enabled || !screen || !host) return { refresh() {}, unmount() {} };

  let live = null;
  let timer = 0;
  let last = null;
  const win = doc.defaultView ?? globalThis;

  const homeShowing = () => !screen.classList.contains('hidden') && !doc.hidden;

  function stop() {
    win.clearTimeout(timer);
    timer = 0;
    live?.dispose();
    live = null;
  }

  // A different gesture from the last one; the first the model has.
  function gesture() {
    const order = HOME_GESTURES.filter((g) => g !== last);
    const start = Math.floor(random() * order.length);
    for (let k = 0; k < order.length; k++) {
      const g = order[(start + k) % order.length];
      if (live.play(0, g)) { last = g; return; }
    }
  }

  function scheduleGesture(ms) {
    win.clearTimeout(timer);
    timer = win.setTimeout(() => {
      if (!live || !homeShowing()) return;
      gesture();
      const [a, b] = GESTURE_EVERY_MS;
      scheduleGesture(a + random() * (b - a));
    }, ms);
  }

  // Start, stop or re-sync to the current avatar and screen.
  function refresh() {
    const value = getAvatar();
    if (!value || !homeShowing() || prefersReducedMotion()) { stop(); return; }
    const fresh = !live;
    live ??= createLive({ hosts: () => [host], prefersReducedMotion, look: LOOK });
    live.sync([value]);
    if (fresh) scheduleGesture(GESTURE_FIRST_MS);
  }

  // The home screen shows / hides by its `hidden` class; the menu rewrites the icon when
  // the avatar changes (equip, sign-in, sign-out).
  const Observer = win.MutationObserver;
  const observers = [];
  if (Observer) {
    const screenObs = new Observer(refresh);
    screenObs.observe(screen, { attributes: true, attributeFilter: ['class'] });
    const iconObs = new Observer(refresh);
    iconObs.observe(icon, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    observers.push(screenObs, iconObs);
  }
  doc.addEventListener?.('visibilitychange', refresh);
  refresh();

  return {
    refresh,
    unmount() {
      observers.forEach((o) => o.disconnect());
      doc.removeEventListener?.('visibilitychange', refresh);
      stop();
    },
  };
}
