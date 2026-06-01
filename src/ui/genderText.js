import { loadUiPreferences } from '../game/settings/settingsCompat.js';

export function getGender() {
  try { return loadUiPreferences(globalThis.localStorage)?.gender ?? 'זכר'; }
  catch { return 'זכר'; }
}

export function isFem(gender) {
  return (gender ?? getGender()) === 'נקבה';
}

// All gender pairs: [masculine, feminine]
export const GS = Object.freeze({
  // Game controls
  confirmBtn:            ['שבץ',          'שבצי'],
  cancelBtn:             ['בטל',           'בטלי'],
  // Continue / navigation
  continue:              ['המשך',          'המשיכי'],
  continuePlay:          ['המשך לשחק',     'המשיכי לשחק'],
  continueArrow:         ['← המשך לשחק',   '← המשיכי לשחק'],
  resumeGame:            ['▶ המשך משחק',   '▶ המשיכי משחק'],
  continueMiniGame:      ['המשך ▶',        'המשיכי ▶'],
  letsPlay:              ['בוא נשחק ▶',    'בואי נשחק ▶'],
  // Instructions
  chooseLetterJoker:     ["בחר אות לג'וקר", "בחרי אות לג'וקר"],
  chooseLetterExch:      ['בחר אות מהמגש להחלפה מהשקית (פעם אחת בתור)', 'בחרי אות מהמגש להחלפה מהשקית (פעם אחת בתור)'],
  chooseLetterBoard:     ['בחר אות מהמגש ולחץ על משבצת', 'בחרי אות מהמגש ולחצי על משבצת'],
  cancelBeforeSwap:      ['בטל את האותיות שעל הלוח לפני החלפה', 'בטלי את האותיות שעל הלוח לפני החלפה'],
  chooseToSwap:          ['בחר לפחות אות אחת להחלפה', 'בחרי לפחות אות אחת להחלפה'],
  pressConfirm:          ['לחץ "שבץ ✓" לאישור או "בטל ↩" לחזרה', 'לחצי "שבצי ✓" לאישור או "בטלי ↩" לחזרה'],
  placeOneTile:          ['שבץ לפחות אות אחת!', 'שבצי לפחות אות אחת!'],
  chooseSquare:          ['בחר משבצת על הלוח', 'בחרי משבצת על הלוח'],
  noSwapWithoutPlace:    ['אי אפשר להחליף אות בלי לשבץ אותיות חדשות', 'אי אפשר להחליף אות בלי לשבצי אותיות חדשות'],
  turnPassedDuringPlace: ['התור עבר בזמן שניסית לשבץ — האותיות הוחזרו', 'התור עבר בזמן שניסית לשבצי — האותיות הוחזרו'],
  // Stall end overlay
  youLeadScore:          ['אתה מוביל בניקוד', 'את מובילה בניקוד'],
  stallLeadDesc:         ['המשחק תקוע — אתה מוביל בניקוד וזכותך לסיים אותו עכשיו לפי כלל ההיתקעות. הניצחון יירשם לזכותך.', 'המשחק תקוע — את מובילה בניקוד וזכותך לסיים אותו עכשיו לפי כלל ההיתקעות. הניצחון יירשם לזכותך.'],
  // Bonus intro descriptions
  descB1:                ['פתור את האנגרמה בזמן וקבל עד 100 נקודות', 'פתרי את האנגרמה בזמן וקבלי עד 100 נקודות'],
  descB3:                ['פתור את האנגרמה בזמן וקבל עד 40 נקודות',  'פתרי את האנגרמה בזמן וקבלי עד 40 נקודות'],
  descB8:                ['פתור את התשבץ ב-60 שניות',                 'פתרי את התשבץ ב-60 שניות'],
  descB10:               ['בנה מילים מצטלבות וקבל בונוס על כל אחת',  'בני מילים מצטלבות וקבלי בונוס על כל אחת'],
  descB11:               ['מצא את כל המילים בתפזורת',                 'מצאי את כל המילים בתפזורת'],
  descB12:               ['בנה מילים על הכוורת',                      'בני מילים על הכוורת'],
  descB13:               ['סובב את הגלגל וקבל פרס',                   'סובבי את הגלגל וקבלי פרס'],
  // Mini-game strings
  buildWord:             ['בנה את המילה',   'בני את המילה'],
  pressWheel:            ['לחץ על הגלגל להסתובב', 'לחצי על הגלגל להסתובב'],
  spinBtn:               ['סובב',            'סובבי'],
  completeWord:          ['השלם את המילה',  'השלימי את המילה'],
  fillAllSquares:        ['מלא את כל המשבצות קודם!', 'מלאי את כל המשבצות קודם!'],
  fillMissing:           ['מלא את החסר',    'מלאי את החסר'],
  fillMissingTitle:      ['בוסט 100 — מלא את החסר', 'בוסט 100 — מלאי את החסר'],
  // Social / friends
  inviteToGame:          ['✉️ הזמן למשחק',  '✉️ הזמיני למשחק'],
  shareGameMsg:          ['בוא נשחק',       'בואי נשחק'],
  // Stats
  favBoost:              ['הבוסט שאתה הכי אוהב להשתמש בו', 'הבוסט שאת הכי אוהבת להשתמש בו'],
});

// Returns the masculine or feminine form for a given key.
export function g(key, gender) {
  const pair = GS[key];
  if (!pair) return key;
  return isFem(gender) ? pair[1] : pair[0];
}

// Updates all elements with [data-gm] or [data-gm-html] in root.
//   data-gm / data-gf      → updates textContent
//   data-gm-html / data-gf-html → updates innerHTML
export function applyGenderToRoot(root, gender) {
  const fem = isFem(gender);
  for (const el of root?.querySelectorAll?.('[data-gm]') ?? []) {
    el.textContent = fem ? (el.dataset.gf ?? el.dataset.gm) : el.dataset.gm;
  }
  for (const el of root?.querySelectorAll?.('[data-gm-html]') ?? []) {
    el.innerHTML = fem ? (el.dataset.gfHtml ?? el.dataset.gmHtml) : el.dataset.gmHtml;
  }
}
