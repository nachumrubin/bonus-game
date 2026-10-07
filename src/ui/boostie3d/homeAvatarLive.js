// homeAvatarLive — the player's Boostie, alive in the home screen's top-bar avatar
// (.em-avatar-wrap around #home-avatar-ic). Same live 3D as the scoreboard (one slot of
// scoreboardLive): eyes, blinks, springs, and now and then its signature move. The 3D
// runs only while the home screen (#sh) is showing, and is torn down (WebGL freed) as
// soon as it hides; the still <img> underneath is the fallback and what every other
// screen shows.
//
// Only idle life plays here (D-boostie-reactions: expressive clips are player-chosen).

import { createScoreboardLive, canUseLive3d } from './scoreboardLive.js';

const SIGNATURE_FIRST_MS = 1800;              // a little hello once the home screen shows
const SIGNATURE_EVERY_MS = [14000, 26000];    // then every so often (random in range)

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
  const win = doc.defaultView ?? globalThis;

  const homeShowing = () => !screen.classList.contains('hidden') && !doc.hidden;

  function stop() {
    win.clearTimeout(timer);
    timer = 0;
    live?.dispose();
    live = null;
  }

  function scheduleSignature(ms) {
    win.clearTimeout(timer);
    timer = win.setTimeout(() => {
      if (!live || !homeShowing()) return;
      live.play(0, 'signature');
      const [a, b] = SIGNATURE_EVERY_MS;
      scheduleSignature(a + random() * (b - a));
    }, ms);
  }

  // Start, stop or re-sync to the current avatar and screen.
  function refresh() {
    const value = getAvatar();
    if (!value || !homeShowing() || prefersReducedMotion()) { stop(); return; }
    const fresh = !live;
    live ??= createLive({ hosts: () => [host], prefersReducedMotion });
    live.sync([value]);
    if (fresh) scheduleSignature(SIGNATURE_FIRST_MS);
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
