// Achievements: definitions and pure checks. Shared by the screens (avatarScreens.js
// re-exports these) and the coin worker (worker/src/economy.js), which checks that an
// achievement is really complete before paying its reward. No DOM, no Firebase.

import { BOOSTIES } from './boostieCatalog.js';
import { normalizeBoosties } from './boostieXp.js';

export const ACHIEVEMENTS = [
  { id: 'first_steps',  titleHe: 'צעדים ראשונים', descHe: 'שחק 5 משחקים',                                       condition: { stat: 'gamesPlayed',      min: 5    }, emoji: '🔥',      tier: 'bronze' },
  { id: 'winner',       titleHe: 'מנצח',           descHe: 'ניצח 5 משחקים',                                       condition: { stat: 'gamesWon',         min: 5    }, emoji: '🦈',     tier: 'bronze' },
  { id: 'seasoned',     titleHe: 'שחקן מנוסה',     descHe: 'שחק 25 משחקים',                                       condition: { stat: 'gamesPlayed',      min: 25   }, emoji: '💎',   tier: 'silver' },
  { id: 'streaker',     titleHe: 'רצף מנצחים',     descHe: 'הגע לרצף של 5 ניצחונות',                             condition: { stat: 'longestStreak',    min: 5    }, emoji: '🐯',     tier: 'silver' },
  { id: 'clean_winner', titleHe: 'שועל ותיק',      descHe: 'צא לניצחון בלי להשתמש בריבוע מיוחד',                 condition: { stat: 'cleanWins',        min: 1    }, emoji: '🦊',       tier: 'silver' },
  { id: 'word_genius',  titleHe: 'גאון מילים',     descHe: 'צבור 100 נקודות במהלך אחד',                          condition: { stat: 'highestMoveScore', min: 100  }, emoji: '💡',      tier: 'silver' },
  { id: 'social',       titleHe: 'חבר של כולם',    descHe: 'הגע ל-20 חברים',                                      condition: { stat: 'friendsCount',     min: 20   }, emoji: '🤝', tier: 'silver' },
  { id: 'veteran',      titleHe: 'ותיק',            descHe: 'שחק 40 משחקים',                                       condition: { stat: 'gamesPlayed',      min: 40   }, emoji: '🐉',    tier: 'gold'   },
  { id: 'wordsmith',    titleHe: 'אמן המילים',      descHe: 'הגע לשיא של 250 נקודות',                              condition: { stat: 'highScore',        min: 250  }, emoji: '🧙',    tier: 'gold'   },
  { id: 'undefeated',   titleHe: 'בלתי מנוצח',     descHe: 'רצף של 15 ניצחונות',                                  condition: { stat: 'longestStreak',    min: 15   }, emoji: '🛡️',    tier: 'gold'   },
  { id: 'lightning',    titleHe: 'ברק חי',         descHe: 'שחק משחק במהירות ממוצעת מתחת ל-3 שניות למהלך',     condition: { stat: 'fastGamePlayed',   min: 1    }, emoji: '⚡',      tier: 'gold'   },
  { id: 'legend',       titleHe: 'אגדה',            descHe: 'שחק 100 משחקים',                                      condition: { stat: 'gamesPlayed',      min: 100  }, emoji: '👾',     tier: 'legend' },
  { id: 'champion',     titleHe: 'אלוף',            descHe: 'ניצח 50 משחקים',                                      condition: { stat: 'gamesWon',         min: 50   }, emoji: '🤖',     tier: 'legend' },
  { id: 'untouchable',  titleHe: 'בלתי נתפס',      descHe: 'נצח 25 משחקים ברצף',                                  condition: { stat: 'longestStreak',    min: 25   }, emoji: '🏆',    tier: 'legend' },
  { id: 'dictionary',   titleHe: 'מילון מהלך',      descHe: 'השתמש ב-1000 מילים שונות',                            condition: { stat: 'uniqueWordsCount', min: 1000 }, emoji: '📚',     tier: 'legend' },
  { id: 'superhuman',   titleHe: 'על-אנושי',        descHe: 'שבוע שלם בלי הפסד',                                   condition: { stat: 'noLossWeekStreaks',min: 1    }, emoji: '🦸',      tier: 'legend' },
  { id: 'the_one',      titleHe: 'האחד',            descHe: 'נצח את שחקן המקום הראשון',                            condition: { stat: 'beatNumberOne',    min: 1    }, emoji: '🎯',     tier: 'legend' },
  { id: 'recruiter',   titleHe: 'חבר מביא חבר',  descHe: 'הזמן 5 חברים לבוסט',                                  condition: { stat: 'invitesSent',      min: 5    }, emoji: '🤩', tier: 'gold'   },
  // Boostie achievements (October 2026, D-boostie-xp).
  { id: 'boostie_grown',  titleHe: 'מתפתח',       descHe: 'הבא בוסטי לשלב 4',      condition: { type: 'boostieLevel', min: 4 },     emoji: '🌱', tier: 'silver' },
  { id: 'new_boostie',    titleHe: 'בוסטי חדש',   descHe: 'פתח בוסטי חדש',          condition: { type: 'boostiesUnlocked', min: 1 }, emoji: '✨', tier: 'gold'   },
  { id: 'reaction_fan',   titleHe: 'מלך התגובות', descHe: 'פתח 2 תגובות בחנות',     condition: { type: 'reactionsOwned', min: 2 },   emoji: '🎭', tier: 'silver' },
  { id: 'word_contributor', titleHe: 'תורם מילים', descHe: 'הצע 20 מילים שהתקבלו למילון', condition: { stat: 'wordsAccepted', min: 20 }, emoji: '📖', tier: 'gold' },
];

// ── Achievement evaluation (trophy-centric) ─────────
// `data` is achievementSnapshot(profile) = { stats, boosties, ownedReactions }.
// Returns { current, target } for the achievement's condition.
export function achievementSnapshot(profile) {
  return {
    stats: profile?.stats ?? {},
    boosties: profile?.boosties ?? null,
    ownedReactions: Array.isArray(profile?.ownedReactions) ? profile.ownedReactions : [],
  };
}

export function achievementMetric(ach, data = {}) {
  const c = ach?.condition ?? {};
  if (c.stat) {
    return { current: data.stats?.[c.stat] ?? 0, target: c.min ?? 0 };
  }
  if (c.type === 'boostieLevel') {
    const levels = Object.values(normalizeBoosties(data.boosties)).map(b => b.level);
    return { current: Math.max(1, ...levels), target: c.min ?? 1 };
  }
  if (c.type === 'boostiesUnlocked') {
    const extra = Object.keys(normalizeBoosties(data.boosties)).filter(id => BOOSTIES[id]?.unlock !== 'starter');
    return { current: extra.length, target: c.min ?? 1 };
  }
  if (c.type === 'reactionsOwned') {
    return { current: Array.isArray(data.ownedReactions) ? data.ownedReactions.length : 0, target: c.min ?? 1 };
  }
  return { current: 0, target: 1 };
}

export function isAchievementComplete(ach, data = {}) {
  const { current, target } = achievementMetric(ach, data);
  return current >= target;
}

