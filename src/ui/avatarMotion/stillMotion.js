// stillMotion — game-moment reactions played on a plain still <img> (Web Animations),
// for avatars with neither a live 3D model nor a pose atlas: the bots. Each clip is a
// short squash / hop / pulse around the figure's feet, so it reads as the character
// reacting instead of a flat picture sliding.

const ORIGIN = '50% 100%';

export const STILL_CLIPS = Object.freeze({
  // your turn: rises, leans in, settles
  turn: { duration: 900, keys: [
    { transform: 'translateY(0) scale(1,1) rotate(0deg)', offset: 0 },
    { transform: 'translateY(0) scale(1.06,.92) rotate(0deg)', offset: .18 },
    { transform: 'translateY(-9%) scale(.96,1.08) rotate(-4deg)', offset: .5 },
    { transform: 'translateY(0) scale(1.04,.95) rotate(2deg)', offset: .78 },
    { transform: 'translateY(0) scale(1,1) rotate(0deg)', offset: 1 },
  ] },
  // good move: two happy hops
  good: { duration: 1000, keys: [
    { transform: 'translateY(0) scale(1,1)', offset: 0 },
    { transform: 'translateY(-12%) scale(.95,1.07)', offset: .22 },
    { transform: 'translateY(0) scale(1.06,.93)', offset: .44 },
    { transform: 'translateY(-6%) scale(.97,1.04)', offset: .68 },
    { transform: 'translateY(0) scale(1,1)', offset: 1 },
  ] },
  // boost: a quick bright jolt
  boost: { duration: 650, keys: [
    { transform: 'scale(1) rotate(0deg)', filter: 'brightness(1)', offset: 0 },
    { transform: 'scale(1.12) rotate(-3deg)', filter: 'brightness(1.5) saturate(1.3)', offset: .25 },
    { transform: 'scale(.97) rotate(3deg)', filter: 'brightness(1.2)', offset: .6 },
    { transform: 'scale(1) rotate(0deg)', filter: 'brightness(1)', offset: 1 },
  ] },
});

// Plays `kind` on the host's <img>. Returns true when a clip started.
export function playStillReaction(hostEl, kind) {
  const clip = STILL_CLIPS[kind];
  const img = hostEl?.querySelector?.('img.av-img, img');
  if (!clip || !img || typeof img.animate !== 'function') return false;
  try {
    img.getAnimations?.().forEach((a) => a.cancel());
    img.animate(
      clip.keys.map((k) => ({ ...k, transformOrigin: ORIGIN })),
      { duration: clip.duration, easing: 'ease-in-out' },
    );
    return true;
  } catch { return false; }
}
