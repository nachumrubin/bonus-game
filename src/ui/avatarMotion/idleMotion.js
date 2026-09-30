// idleMotion — "alive" loop for avatars on calm screens (profile, waiting for
// an opponent). Never used on the game board: gameplay animation is
// event-driven only.
//
//   const idle = startIdle(hostEl, { secondary: true });
//   idle.stop();
//
// Runs the breathing 'idle' clip; with `secondary` it swaps in a glance or head
// tilt every 6–10 s so a long wait never looks frozen. Stops itself when the
// avatar leaves the DOM or its screen/overlay is hidden. Reduced motion or a
// missing atlas → does nothing (the static PNG stays).

import { playOnImg, stopOnImg } from './spritePlayer.js';

const SECONDARY_CLIPS = ['glance', 'headTilt'];

export function pickSecondaryDelay(rand = Math.random) {
  return 6000 + Math.round(rand() * 4000);
}

export function isShown(el) {
  if (!el?.isConnected) return false;
  if (el.offsetParent === null && globalThis.getComputedStyle?.(el)?.position !== 'fixed') return false;
  return !el.closest?.('.hidden');
}

export function startIdle(hostEl, { secondary = false, rand = Math.random } = {}) {
  const img = hostEl?.querySelector?.('img');
  let stopped = !img;
  let timer = null;
  let turn = 0;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    stopOnImg(img);
  };

  const loop = () => {
    if (stopped) return;
    if (!isShown(img)) { stop(); return; }
    playOnImg(img, 'idle').then(ok => { if (!ok && !secondaryPending) stop(); });
  };

  let secondaryPending = false;
  const scheduleSecondary = () => {
    if (!secondary || stopped) return;
    timer = setTimeout(async () => {
      if (stopped) return;
      if (!isShown(img)) { stop(); return; }
      secondaryPending = true;
      const clip = SECONDARY_CLIPS[turn++ % SECONDARY_CLIPS.length];
      await playOnImg(img, clip);
      secondaryPending = false;
      loop();
      scheduleSecondary();
    }, pickSecondaryDelay(rand));
  };

  if (!stopped) { loop(); scheduleSecondary(); }
  return { stop, get running() { return !stopped; } };
}
