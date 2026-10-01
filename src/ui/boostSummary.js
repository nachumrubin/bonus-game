// boostSummary — the one place that names boosts for the player.
//
// describeBoost() feeds the modal award card (the local player's own boosts).
// describeBoostSummary() turns the engine's move-history `boost` summary
// ({ bonusType, kind, extra, effects }) into the short label the status pill
// (#sbar) shows for the OPPONENT's boost — what they got and the points.
// Pure: no DOM.

import { describeBonus } from './screens/bonusIntroScreen.js';

// One-line Hebrew descriptions of every boost the player can land on. Each
// row drives the modal overlay so the player always sees what they got.
export function describeBoost(boostId, payload, extra) {
  const p = payload ?? {};
  switch (boostId) {
    case 'auto_extra_score':
      return {
        title: 'בוסט ניקוד!',
        bigText: `+${extra || p.extra || 0} נק'`,
        sub:   'הנקודות יתווספו עם אישור',
      };
    case 'extra_turn':
      return { title: 'תור נוסף!', image: 'assets/rewards/extra turn.png', sub: 'תקבל תור נוסף ברצף' };
    case 'multiply_next_turns': {
      const mult  = Number(p.multiplier ?? 2);
      const turns = Number(p.turnsRemaining ?? 1);
      return {
        title: `הכפלת ניקוד ×${mult}!`,
        bigText: `×${mult}`,
        sub: turns > 1 ? `הניקוד יוכפל ב-${turns} התורים הבאים` : 'הניקוד יוכפל בתור הבא',
      };
    }
    case 'timer_bonus':
      return {
        title: 'בוסט זמן',
        bigText: `+${Number(p.seconds ?? 0)} שניות`,
        sub: 'יתווסף לזמן התור הבא',
      };
    // The next three used bare emoji, which the overlay painted gold (see
    // showBonusAwardOverlay) — they showed up as meaningless yellow discs.
    // pause.png / rematch.png are already Boost-family art (blue sphere, cyan
    // ring, glossy 3D), so they slot in next to 'extra turn.png' cleanly.
    // Bespoke artwork is still tracked in docs/asset_inventory.md.
    case 'free_tile_swap':
      return {
        title: 'החלפת אות חינם',
        image: 'assets/ui/rematch.png',       // circular swap arrows
        bigEmoji: '🔄',
        sub: 'תוכל להחליף אותיות בלי לוותר על התור',
      };
    case 'skip_opponent_turn':
      return {
        title: 'דילוג על תור היריב',
        image: 'assets/ui/pause.png',         // the opponent's turn is halted
        bigEmoji: '⏭️',
        sub: 'היריב יפסיד את התור הבא',
      };
    case 'cancel_next_opponent_bonus':
      // No usable shield asset (the achievements shield is a multi-object sheet
      // with a baked-in background), so this stays an emoji — but as bigEmoji it
      // renders as a real colour shield instead of a gold blob.
      return { title: 'ביטול בוסט יריב', bigEmoji: '🛡️', sub: 'הבוסט הבא של היריב יבוטל' };
    default:
      return { title: 'בוסט הופעל', bigEmoji: '⚡', sub: '' };
  }
}

// Inline glyph per effect, for the one-line chip (the modal uses artwork).
const EFFECT_ICON = {
  auto_extra_score: '⚡',
  extra_turn: '🎯',
  multiply_next_turns: '✖️',
  timer_bonus: '⏱️',
  free_tile_swap: '🔄',
  skip_opponent_turn: '⏭️',
  cancel_next_opponent_bonus: '🛡️',
};

const stripBang = (s) => String(s ?? '').replace(/!$/, '');

// Pure: engine boost summary → { icon, name, extra, showPoints, text } or null.
//   - mini-game / wheel points  → the game's name ("⚡ אנגרמה +15")
//   - a future effect           → the effect ("🎯 תור נוסף", "✖️ הכפלת ניקוד ×2")
//   - a flat points square      → "⚡ בוסט ניקוד +20"
//   - a failed mini-game        → the game's name with +0, so the player still
//                                 learns the opponent tried and got nothing.
export function describeBoostSummary(boost) {
  if (!boost || typeof boost !== 'object') return null;
  const extra = Number(boost.extra) || 0;
  const effects = Array.isArray(boost.effects) ? boost.effects.filter(e => e?.boostId) : [];
  const futureEffects = effects.filter(e => e.boostId !== 'auto_extra_score');
  const isGame = boost.kind === 'minigame' || boost.kind === 'wheel';
  const bonus = boost.bonusType ? describeBonus(boost.bonusType) : null;

  let icon;
  let name;
  if (futureEffects.length) {
    icon = EFFECT_ICON[futureEffects[0].boostId] ?? '⚡';
    name = futureEffects.map(e => stripBang(describeBoost(e.boostId, e.payload, 0).title)).join(' · ');
  } else if (isGame && bonus) {
    icon = bonus.icon ?? '⚡';
    name = stripBang(bonus.title);
  } else {
    icon = '⚡';
    name = stripBang(describeBoost('auto_extra_score', null, extra).title);
  }
  // Points are shown whenever they're the point of the boost: any +N, and the
  // +0 of a mini-game / wheel the opponent played without earning anything.
  const showPoints = extra > 0 || (!futureEffects.length && isGame);
  const text = `${icon} ${name}${showPoints ? ` +${extra}` : ''}`;
  return { icon, name, extra, showPoints, text };
}
