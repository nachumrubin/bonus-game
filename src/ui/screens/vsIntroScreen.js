// vsIntroScreen — "me → VS ← opponent" before an online 1v1 match (#ov-vs-intro).
//
// It lives entirely inside the pause main.js already takes between the
// matchmaking MATCHED signal and the board (VS_INTRO_MS), so matches do not get
// slower. Both 2.5D avatars slide towards the centre (pose-atlas clips
// vsEnterStart / vsEnterEnd, or a CSS slide when the atlas is not ready or
// motion is reduced), names + Elo rise underneath, and a cyan strike cuts
// through "VS".
//
//   bus.emit(VS_INTRO_INTENT.SHOW, { me: {name, avatar, rating}, opp: {name, avatar, rating | label} })
//   (`label` replaces the Elo line — e.g. the bot's level "רמה: קשה")
//   bus.emit(VS_INTRO_INTENT.RATING, { side: 'opp', rating })   // late-arriving Elo
//   bus.emit(VS_INTRO_INTENT.HIDE)

import { setAvatarEl } from './avatarScreens.js';
import { playOnHost, stopOnHost, canPlayNowOnHost, preloadFor } from '../avatarMotion/spritePlayer.js';

export const VS_INTRO_INTENT = Object.freeze({
  SHOW:   'vsIntro/show',
  RATING: 'vsIntro/rating',
  HIDE:   'vsIntro/hide',
});

// Total on-screen time; main.js waits exactly this long before starting the game.
export const VS_INTRO_MS = 2500;
// The exit (zoom toward the board + fade) starts this long before the end.
export const VS_EXIT_MS = 320;
// Longest we hold the entrance waiting for the opponent's atlas to decode.
const ATLAS_WAIT_MS = 220;

export function formatElo(rating) {
  const n = Number(rating);
  return Number.isFinite(n) && n > 0 ? `ELO ${Math.round(n)}` : '';
}

export function mountVsIntroOverlay({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountVsIntroOverlay: bus required');
  const ov = root.getElementById?.('ov-vs-intro');
  const el = (id) => root.getElementById?.(id);
  const sides = {
    me:  { av: el('vs-my-av'),  nm: el('vs-my-name'),  elo: el('vs-my-elo'),  clip: 'vsEnterStart' },
    opp: { av: el('vs-opp-av'), nm: el('vs-opp-name'), elo: el('vs-opp-elo'), clip: 'vsEnterEnd' },
  };
  let showToken = 0;
  let exitTimer = null;
  const cleanups = [];

  function fill(side, { name, avatar, rating, label } = {}) {
    const s = sides[side];
    if (s.av) setAvatarEl(s.av, avatar ?? null, { fallback: side === 'me' ? '👑' : '👤' });
    if (s.nm) s.nm.textContent = name || 'שחקן';
    if (s.elo) s.elo.textContent = label || formatElo(rating);
  }

  async function show({ me = {}, opp = {} } = {}) {
    if (!ov) return;
    const token = ++showToken;
    fill('me', me); fill('opp', opp);
    ov.classList.remove('vs-go', 'vs-out', 'vs-3d-me', 'vs-3d-opp');
    clearTimeout(exitTimer);
    ov.classList.remove('hidden');
    ov.setAttribute('aria-hidden', 'false');
    const srcOf = (s) => s.av?.querySelector?.('img')?.getAttribute?.('src');
    await Promise.race([
      Promise.all(Object.values(sides).map(s => (srcOf(s) ? preloadFor(srcOf(s)).catch(() => false) : false))),
      new Promise(r => setTimeout(r, ATLAS_WAIT_MS)),
    ]);
    if (token !== showToken) return;
    for (const [key, s] of Object.entries(sides)) {
      const threeD = canPlayNowOnHost(s.av, s.clip);
      ov.classList.toggle(`vs-3d-${key}`, threeD);
      // After the entrance both fighters breathe through the hold.
      if (threeD) playOnHost(s.av, s.clip).then(ok => { if (ok && token === showToken) playOnHost(s.av, 'idle'); });
    }
    void ov.offsetWidth;
    ov.classList.add('vs-go'); // starts the CSS choreography (2D slides, text, strike)
    exitTimer = setTimeout(() => { if (token === showToken) ov.classList.add('vs-out'); },
      Math.max(0, VS_INTRO_MS - VS_EXIT_MS - ATLAS_WAIT_MS));
  }

  function hide() {
    showToken++;
    clearTimeout(exitTimer);
    if (!ov) return;
    for (const s of Object.values(sides)) stopOnHost(s.av);
    ov.classList.add('hidden');
    ov.classList.remove('vs-go', 'vs-out', 'vs-3d-me', 'vs-3d-opp');
    ov.setAttribute('aria-hidden', 'true');
  }

  cleanups.push(
    bus.on(VS_INTRO_INTENT.SHOW, show),
    bus.on(VS_INTRO_INTENT.HIDE, hide),
    bus.on(VS_INTRO_INTENT.RATING, ({ side, rating } = {}) => {
      const s = sides[side];
      if (s?.elo) s.elo.textContent = formatElo(rating);
    }),
  );

  return {
    unmount() {
      for (const off of cleanups) try { off?.(); } catch { /* swallow */ }
      cleanups.length = 0;
    },
  };
}
