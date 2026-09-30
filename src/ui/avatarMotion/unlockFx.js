// unlockFx — per-achievement flourishes layered behind the trophy in the
// unlock overlay (#av-unlock-ic), timed to land as the 3D trophy reaches the
// camera (poseClips 'unlockReveal' / 'unlockRevealGrand'). Pure DOM + CSS
// (styles.css "Achievement unlock specials"); skipped under reduced motion.
//
//   dictionary   → Hebrew letters orbit the trophy and snap into it
//   streaker     → cyan streaks stack up behind the badge
//   undefeated   → a shield-like pulse expands outward
//   word_genius  → a halo builds behind the trophy
//   collector    → rare / epic / legendary avatar cards sweep past behind it
//   legend_owner → the grand version: gold + cyan rays, push-in, big burst
//   other Legend-tier achievements → slow gold rays

import { getMotionPreference } from '../motionPreference.js';

export const UNLOCK_SPECIALS = Object.freeze({
  dictionary: 'letters',
  streaker: 'streaks',
  undefeated: 'shield',
  word_genius: 'halo',
  collector: 'cards',
  legend_owner: 'grand',
});

export function specialFor(achievement) {
  if (!achievement) return null;
  return UNLOCK_SPECIALS[achievement.id] ?? (achievement.tier === 'legend' ? 'rays' : null);
}

const LETTERS = ['ב', 'ו', 'ס', 'ט', 'מ', 'י', 'ל', 'ה'];
const COLLECTOR_CARDS = [
  'assets/avatars_v2/rare/golda.png',
  'assets/avatars_v2/epic/esther.PNG',
  'assets/avatars_v2/legendary/david.png',
];
const FX_LIFETIME_MS = 2600;

function motionAllowed() {
  try { return getMotionPreference().animationsEnabled(); } catch { return false; }
}

export function playUnlockSpecial(kind, iconEl, { doc = globalThis.document } = {}) {
  if (!kind || !iconEl?.insertBefore || !doc?.createElement || !motionAllowed()) return null;
  iconEl.querySelectorAll?.('.ach-fx')?.forEach(n => n.remove());
  const layer = doc.createElement('div');
  layer.className = `ach-fx ach-fx--${kind}`;
  layer.setAttribute('aria-hidden', 'true');
  const add = (tag, cls, style = '', text = '') => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (style) n.style.cssText = style;
    if (text) n.textContent = text;
    layer.appendChild(n);
    return n;
  };
  switch (kind) {
    case 'letters':
      LETTERS.forEach((ch, i) => add('span', 'ach-fx-letter', `--a:${Math.round((360 / LETTERS.length) * i)}deg;--d:${i * 30}ms`, ch));
      break;
    case 'streaks':
      for (let i = 0; i < 4; i++) add('i', 'ach-fx-streak', `--y:${-24 + i * 16}px;--d:${i * 90}ms`);
      break;
    case 'shield':
      for (let i = 0; i < 3; i++) add('i', 'ach-fx-ring', `--d:${i * 170}ms`);
      break;
    case 'halo':
      add('i', 'ach-fx-halo');
      break;
    case 'cards':
      COLLECTOR_CARDS.forEach((src, i) => {
        const card = add('span', 'ach-fx-card', `--d:${i * 140}ms;--y:${-18 + i * 18}px;--r:${-8 + i * 8}deg`);
        const img = doc.createElement('img');
        img.src = src; img.alt = '';
        card.appendChild(img);
      });
      break;
    case 'grand':
      add('i', 'ach-fx-rays ach-fx-rays--gold');
      add('i', 'ach-fx-rays ach-fx-rays--cyan');
      add('i', 'ach-fx-halo');
      break;
    case 'rays':
      add('i', 'ach-fx-rays ach-fx-rays--gold');
      break;
    default:
      return null;
  }
  iconEl.insertBefore(layer, iconEl.firstChild);
  setTimeout(() => { try { layer.remove(); } catch { /* swallow */ } }, FX_LIFETIME_MS);
  return layer;
}
