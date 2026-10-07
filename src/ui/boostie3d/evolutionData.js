// evolutionData — pure data and helpers for the level-up evolution (Phase 4). No DOM,
// no three.js, so it is unit-tested directly.
//
// What the card says comes from AVATAR_EVOLUTION.md: §1 (the level names) and the
// character sections (§5 Zapi, §6 Bubo) for what each new form adds.

import { BOOSTIE_LEVELS, isBoostieId, boostieName } from '../../game/account/boostieCatalog.js';
import { normalizeBoosties } from '../../game/account/boostieXp.js';

// Bus events. EVO_SHOW { id, from, to } replays a level-up (the store's watch button);
// EVO_CLOSED { kind, id, … } after the player closes one.
export const EVO_SHOW = 'evolution/show';
export const EVO_CLOSED = 'evolution/closed';

// §1 level names (Hatchling … Legend).
export const LEVEL_NAMES = Object.freeze(['בוקע', 'גור', 'צעיר', 'מתבגר', 'בוגר', 'אלוף', 'אגדה']);

// The headline change of each new form (index = level). Keep in step with the sheets.
export const CHANGE_LINES = Object.freeze({
  zapi: Object.freeze([null, null,
    'קצה זנב כחול וחיוך שובב',
    'גוף מתארך וצעיף ראשון',
    'עומד על שתיים! אבנט, מגינים וחצי זנב אנרגיה',
    'זנב אנרגיה מלא, אפוד וסכינים',
    'שני זנבות אנרגיה וגלימה',
    'ברדס, נזר והילה',
  ]),
  bubo: Object.freeze([null, null,
    'קצות ציציות כחולים',
    'משקפי זהב',
    'ינשוף זקוף עם תיק מגילות ונוצה',
    'ציציות אנרגיה מלאות וגלימת מלומד',
    'ציציות ארוכות ומסתעפות',
    'נזר זהב והילה',
  ]),
});

export function levelName(level) {
  return LEVEL_NAMES[Math.min(BOOSTIE_LEVELS, Math.max(1, Math.floor(level) || 1)) - 1];
}

// Card copy for a level-up: { title, levelName, change }.
export function evolutionCopy(id, to) {
  return {
    title: `${boostieName(id)} הגיע לשלב ${to}!`,
    levelName: levelName(to),
    change: CHANGE_LINES[id]?.[to] ?? '',
  };
}

// The levels this device has already celebrated, per account (localStorage), so a
// level reached on another device still plays here once, and a reload never replays.
export const SEEN_KEY_PREFIX = 'boost.boostieSeen.';

// seen: { <id>: level } or null (nothing recorded yet → record only, show nothing).
// Returns { seen, events } where events are, in order:
//   { kind: 'level', id, from, to }   one per Boostie that went up (from = last seen)
//   { kind: 'unlock', id }            a Boostie that arrived in the same update as a
//                                      top-level level-up (the chain); a store purchase
//                                      alone does not count.
export function diffEvolutions(seen, boostiesRaw) {
  const now = normalizeBoosties(boostiesRaw);
  const next = Object.fromEntries(Object.entries(now).map(([id, b]) => [id, b.level]));
  if (!seen || typeof seen !== 'object') return { seen: next, events: [] };
  const events = [];
  let reachedTop = false;
  for (const [id, level] of Object.entries(next)) {
    const before = Number(seen[id]);
    if (!Number.isFinite(before) || level <= before) continue;
    events.push({ kind: 'level', id, from: before, to: level });
    if (level >= BOOSTIE_LEVELS) reachedTop = true;
  }
  if (reachedTop) {
    for (const id of Object.keys(next)) if (!(id in seen) && isBoostieId(id)) events.push({ kind: 'unlock', id });
  }
  // Never forget a higher level (a stale snapshot must not re-arm a celebration).
  for (const [id, lv] of Object.entries(seen)) if (Number(lv) > (next[id] ?? 0)) next[id] = Number(lv);
  return { seen: next, events };
}

// Scene timeline in seconds (the 3D scene and the stills fallback share it).
export const EVO_T = Object.freeze({
  charge: 1.7,      // old form charges up (boost clip, rim + particles ramp)
  flashPeak: 1.95,  // white silhouette, models swap here
  flashEnd: 2.6,
  popEnd: 2.45,     // new form 0.9 → 1.0
  card: 3.5,        // the "reached level N" card
  orbitEnd: 4.6,    // ~30° camera orbit after the swap
});

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
export function easeOutBack(x) {
  const t = clamp01(x), c = 1.70158;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

// 0..1 brightness of the silhouette flash at time t.
export function flashAt(t) {
  if (t < EVO_T.charge) return 0.35 * smooth(t / EVO_T.charge) ** 2;
  if (t < EVO_T.flashPeak) return 0.35 + 0.65 * smooth((t - EVO_T.charge) / (EVO_T.flashPeak - EVO_T.charge));
  return 1 - smooth((t - EVO_T.flashPeak) / (EVO_T.flashEnd - EVO_T.flashPeak));
}
