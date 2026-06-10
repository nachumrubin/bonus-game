import { $, on } from '../domHelpers.js';

// Fired by showLegacyScreen() whenever a named screen becomes active.
export const ONBOARDING_SCREEN_ENTER = 'onboarding/screenEnter';

const STORAGE_KEY = 'spine.onboarding.dismissed';

// Per-screen content shown to first-time visitors. Screens without an entry
// are silently skipped. The game screen (sg) is intentionally excluded — the
// full tutorial covers it.
const SCREEN_CONTENT = {
  sh: {
    icon: '🏠',
    title: 'ברוך הבא לבונוס!',
    bullets: [
      '🎮 שחק נגד הבוט, מול חבר, או אונליין',
      '📊 לחץ על הפרופיל כדי לראות את הסטטיסטיקות שלך',
      '🔔 הפעמון — הזמנות למשחק ועדכונים',
      '❓ לחץ על ? לגישה להדרכה, מדריך ושאלות נפוצות',
    ],
  },
  so: {
    icon: '🌐',
    title: 'משחק אונליין',
    bullets: [
      '⚡ חי — מהלכים בזמן אמת, עם שעון לכל מהלך',
      '🔄 אסינכרוני — כל שחקן מהלך בזמנו שלו, ללא לחץ',
      '👥 הזמן חבר ישירות עם קוד משחק',
      '🎯 התאמה אוטומטית נגד יריב ברמתך',
    ],
  },
  ss: {
    icon: '⚙️',
    title: 'הגדרות המשחק',
    bullets: [
      '⏱ הגדר את הזמן המותר לכל מהלך',
      '📖 אפשר ערעורים — כל שחקן בוחר כמה ערעורים מותרים',
      '👀 הצגת שתי הסטירות — ראה גם את לוח האותיות של היריב',
    ],
  },
  sstats: {
    icon: '📊',
    title: 'הסטטיסטיקות שלך',
    bullets: [
      '💡 תובנות — ניתוח אישי של סגנון המשחק שלך',
      '📈 התקדמות — גרף דירוג ואחוז ניצחון לאורך זמן',
      '🏆 שיאים — המהלך הטוב ביותר, רצף ניצחונות ועוד',
      '🤺 יריבים — נתונים מפורטים מול כל יריב שפגשת',
    ],
  },
  sprofile: {
    icon: '👤',
    title: 'הפרופיל שלך',
    bullets: [
      '✏️ שנה שם — הכינוי שיופיע ליריבים שלך',
      '🖼 בחר אווטאר מתוך הגלריה',
      '⭐ דירוג Elo — עולה עם ניצחון, יורד עם הפסד',
      '🎖 דרגות: מטבע ← כסף ← זהב ← יהלום',
    ],
  },
  sfriends: {
    icon: '👥',
    title: 'חברים',
    bullets: [
      '🔍 חפש שחקנים לפי שם משתמש',
      '✉️ שלח בקשת חברות — הם יקבלו עדכון',
      '⚔️ אתגר חבר למשחק ישירות מהרשימה',
    ],
  },
  snotif: {
    icon: '🔔',
    title: 'עדכונים',
    bullets: [
      '📨 הזמנות למשחק — קבל או דחה ישירות מכאן',
      '🤝 בקשות חברות — אשר שחקנים חדשים לרשימה שלך',
    ],
  },
  smygames: {
    icon: '🎮',
    title: 'המשחקים שלי',
    bullets: [
      '🟢 בתורי — משחקים שמחכים לפעולה שלך',
      '⏳ בתור היריב — ממתין לתשובת הצד השני',
      '💾 משחק שמור — ממשיך משחק מקומי שנשמר במכשיר',
    ],
  },
};

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Mount the screen-by-screen onboarding system.
 *
 * @param {{ bus: object, storage?: Storage, triggerInitialScreen?: string }} opts
 *   triggerInitialScreen — screen ID to show on first load (default 'sh').
 *   The initial screen doesn't go through showLegacyScreen so we trigger it
 *   explicitly after the app loading animation clears.
 */
export function mountOnboardingController({
  bus,
  storage = globalThis.localStorage,
  triggerInitialScreen = 'sh',
} = {}) {
  if (!bus) throw new Error('mountOnboardingController: bus required');

  const dismissed = new Set(
    JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]'),
  );
  // Per-session guard: once shown in this session, don't repeat even if the
  // user navigated away and came back without dismissing with "don't show again".
  const shownThisSession = new Set();
  let pendingTimer = null;

  function saveDismissed(screenId) {
    dismissed.add(screenId);
    storage?.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
  }

  function populateAndShow(screenId) {
    const content = SCREEN_CONTENT[screenId];
    if (!content) return;

    const overlay  = $(`#ov-onboarding`);
    const iconEl   = $(`#onb-icon`);
    const titleEl  = $(`#onb-title`);
    const bodyEl   = $(`#onb-body`);
    const cbEl     = $(`#onb-noshowcb`);

    if (!overlay) return;

    if (iconEl)  iconEl.textContent = content.icon;
    if (titleEl) titleEl.textContent = content.title;
    if (bodyEl)  bodyEl.innerHTML = content.bullets
      .map(b => `<li>${escapeHtml(b)}</li>`)
      .join('');
    if (cbEl) cbEl.checked = true;

    overlay.dataset.screenId = screenId;
    overlay.classList.remove('hidden');
  }

  function maybeShow(screenId) {
    if (!SCREEN_CONTENT[screenId]) return;
    if (shownThisSession.has(screenId)) return;
    if (dismissed.has(screenId)) return;
    shownThisSession.add(screenId);
    clearTimeout(pendingTimer);
    // Delay so the screen's entrance animation finishes first.
    pendingTimer = setTimeout(() => populateAndShow(screenId), 380);
  }

  function handleDismiss() {
    const overlay  = $(`#ov-onboarding`);
    if (!overlay) return;
    const screenId = overlay.dataset.screenId;
    const cbEl     = $(`#onb-noshowcb`);
    if (cbEl?.checked && screenId) saveDismissed(screenId);
    overlay.classList.add('hidden');
  }

  const unsubEnter = bus.on(ONBOARDING_SCREEN_ENTER, ({ screenId }) => {
    maybeShow(screenId);
  });

  // Wire dismiss button and backdrop-click at mount time (DOM exists by now).
  const dismissBtn = $(`#onb-dismiss-btn`);
  const overlay    = $(`#ov-onboarding`);

  const unsubDismissBtn = dismissBtn
    ? on(dismissBtn, 'click', handleDismiss)
    : () => {};

  const unsubBackdrop = overlay
    ? on(overlay, 'click', (e) => { if (e.target === overlay) handleDismiss(); })
    : () => {};

  // Trigger the initial home screen once the app loading animation clears.
  // 1 000 ms covers the longest app-loading sequence (tile bounce + fade-out).
  if (triggerInitialScreen) {
    pendingTimer = setTimeout(() => maybeShow(triggerInitialScreen), 1000);
  }

  return {
    unmount() {
      unsubEnter();
      unsubDismissBtn();
      unsubBackdrop();
      clearTimeout(pendingTimer);
    },
  };
}
