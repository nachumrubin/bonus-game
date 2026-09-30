# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: boost-electric-border.spec.js >> Boost electric square precedes bot-points in a bot game
- Location: tests\e2e\boost-electric-border.spec.js:18:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.bonus-award-positioner')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('.bonus-award-positioner')

```

```yaml
- alert
- img "בוסט"
- button "משחק ברשת שחק מול שחקנים אמיתיים ברחבי העולם ❯"
- button "נגד המחשב התאמן מול הבוט ושפר את יכולתך ❯"
- button "שני שחקנים שחק עם חבר על אותו מכשיר ❯"
- link "מדיניות פרטיות":
  - /url: privacy-policy.html
- text: "· v2.1 · build 20260907002012 Music: \"Inspire Action\" by"
- link "Yuri Megis":
  - /url: https://freemusicarchive.org/music/ura-megis/
- text: ·
- link "Free Music Archive":
  - /url: https://freemusicarchive.org/music/ura-megis/single/inspire-action-1/
- text: ·
- link "CC BY 4.0":
  - /url: https://creativecommons.org/licenses/by/4.0/
- text: משחק אונליין בחר כיצד תרצה לשחק
- button "פתח משחק חדש בחר הגדרות ושלח קוד לחבר"
- button "הצטרף לפי קוד הזן קוד שקיבלת מחבר"
- button "חפש יריב אקראי התחבר לשחקן זמין"
- button "← חזרה"
- text: 🏠 פתיחת משחק חדש בחר הגדרות ושלח את הקוד לחבר השם שלך
- textbox "השם שלך"
- text: סוג משחק
- button "⚡ לייב זמן אמת"
- button "📬 אסינכרוני לא בזמן אמת"
- text: קצב משחק
- button "⚡ בזק 20 שניות"
- button "🎯 רגיל 40 שניות"
- button "🐢 איטי 60 שניות"
- button "▶ פתח משחק"
- button "ביטול"
- text: ⏳ ממתין לשחקן שני... שתף את הקוד עם חבר ------
- button "🛡 ביטול"
- button "שתף ב-WhatsApp"
- text: הזמן שחקן לפי שם משתמש
- textbox "חפש חבר..."
- button "שלח הזמנה"
- text: 🛡 רק שחקנים ברשימת החברים שלך יכולים להצטרף 🎮 הוזמנת למשחק!
- button "הצטרף 🚀"
- button "לא עכשיו"
- text: ✋ ההזמנה נדחתה השחקן שהזמנת לא זמין כרגע.
- button "חזור לאונליין"
- text: 🔑 הצטרף למשחק הזן את הקוד שקיבלת השם שלך
- textbox: שחקן 2
- textbox "000000"
- button "→ הצטרף"
- button "ביטול"
- text: 🎲 חיפוש יריב אקראי בחר את העדפות המשחק שלך השם שלך
- textbox: שחקן
- text: סוג משחק
- button "⚡ לייב זמן אמת"
- button "📬 אסינכרוני לא בזמן אמת"
- text: קצב משחק
- button "⚡ בזק 20 שניות"
- button "🎯 רגיל 40 שניות"
- button "🐢 איטי 60 שניות"
- checkbox "חיפוש מדויק בלבד" [checked]
- text: חיפוש מדויק בלבד
- button "🎲 חפש יריב"
- button "ביטול"
- text: 🎲 מחפש יריב... 👑 שחקן את/ה VS מחפש...
- button "ביטול"
- text: 📡 היריב התנתק! ממתין לחזרה... 30 אם לא יחזור — תזכה בניצחון טכני הגדרות שם שחקן 1
- textbox: שחקן 1
- text: שם שחקן 2
- textbox: שחקן 2
- text: קצב משחק
- button "⚡ בזק 20 שנ'"
- button "🎯 רגיל 40 שנ'"
- button "🐢 איטי 60 שנ'"
- button "∞ ללא ללא הגבלה"
- text: הצג מגש שני השחקנים
- button "👁 פעיל גם מגש יריב"
- button "🔒 כבוי מגש שלי בלבד"
- button "← חזרה"
- button "▶ שחק!"
- text: הגרלת שחקן פותח מטילים מטבע... 🪙 בהצלחה!
- button "כניסה למשחק ←" [disabled]
- button "הגדרות"
- button "סיום"
- button "מוזיקה" [pressed]
- button "החלפת אות"
- button "מילון"
- text: קופה 75 שחקן 1 0 נקודות
- button "Lock duration 3, costs 10 points" [disabled]: 🔒 3
- button "Lock duration 3, costs 10 points" [disabled]: 🔒 3
- button "Lock duration 5, costs 10 points" [disabled]: 🔒 5
- text: VS 33 המחשב 4 נקודות
- button "Lock duration 3, costs 10 points" [disabled]: 🔒 3
- button "Lock duration 3, costs 10 points" [disabled]: 🔒 3
- button "Lock duration 5, costs 10 points" [disabled]: 🔒 5
- text: בחר אות מהמגש ולחץ על משבצת ⚡ ⚡ ⚡ ⚡ ⚡ ש 3 ⚡ ל 1 ו 1 ם 2 ⚡ ⚡ ⚡ ⚡ ⚡ ⚡ ש 3 א 1 ב 3 ג 5 ד 3 ה 4 ו 1 ז 8
- button "בטל ↩"
- button "שבץ ✓"
- button "חזור למשחק": ×
- text: סיום המשחק מה תרצה לעשות?
- button "חזור למשחק המשך לשחק עכשיו"
- button "השהה ושמור חזור למשחק מאוחר יותר ★ מומלץ"
- button "צא ללא שמירה ההתקדמות תאבד"
- text: סיום המשחק מה תרצה לעשות?
- button "חזור למשחק המשך לשחק עכשיו"
- button "השהה ושמור חזור למשחק מאוחר יותר ★ מומלץ"
- button "צא ללא שמירה ההתקדמות תאבד"
- text: "! לפרוש מהמשחק? היריב יקבל ניצחון מיידי."
- button "פרוש"
- button "המשך לשחק"
- text: 🏆 לסיים את המשחק ולזכות? המשחק תקוע — אתה מוביל בניקוד וזכותך לסיים אותו עכשיו לפי כלל ההיתקעות. הניצחון יירשם לזכותך.
- button "🏆 סיים וזכה"
- button "המשך לשחק"
- button "סגור": ×
- text: "הגדרות 🎵 שמע מוזיקה i הפעלת מוסיקת רקע במהלך המשחק כן לא אפקטי קול i צלילים קצרים לאירועי משחק (מילה לא תקינה, בוסט, סוף המשחק) כן לא 🎮 משחק רטט i רטט קצר במכשירים תומכים לאירועי משחק עיקריים כן לא תנועה מופחתת i צמצום אנימציות ותנועה. כברירת מחדל עוקב אחר הגדרת המערכת שלך כן לא באיזה לשון לפנות אליך? i פניות בהתראות ובמשחק יותאמו ללשון שתבחר זכר נקבה לדוגמה: \"שבץ ✓\", \"בטל ↩\", \"לחץ\" התראות משחקים i קבל התראה כשתורך במשחק אסינכרוני או כשיריב מצטרף למשחקך דלוק / אשרות דיסקן כבוי"
- button "הפעל"
- text: 🧠 כלי עזר מילון — בדיקת מילה i בדוק אם מילה קיימת במילון המשחק בלי לפתוח משחק חדש
- textbox "הקלד מילה..."
- button "בדוק ✓"
- button "אישור ✓"
- text: 🃏 בחר אות לג'וקר הג'וקר יהפוך לאות שתבחר (ללא ניקוד)
- button "ביטול"
- button "סגור": ✕
- text: 🔄 החלפת אות אחת בחר אות מהמגש להחלפה מהשקית (פעם אחת בתור)
- button "🗑 ביטול"
- text: מילון האם המילה קיימת? הטיימר ממשיך לרוץ!
- textbox "הקלד מילה..."
- button "בדוק ✓"
- button "סגור"
- text: 🎓 ברוך הבא! זו הפעם הראשונה שלך במשחק. האם תרצה לעבור את ההדרכה לפני שמתחילים?
- button "כן ✓"
- button "לא ×"
- checkbox "אל תציג שוב"
- text: אל תציג שוב 🌟 בוסט!
- button "אישור ✓"
- text: ⚡ משחקון בוסט!
- button "בוא נשחק ▶"
- text: ⚡ היריב מקבל בוסט! ⏳ ממתין לתוצאה... 🛡️ הבוסט בוטל
- button "הבנתי ✓"
- text: שחקן 1 0 שחקן 2 0 טבלת דירוגים — 10 השחקנים המובילים
- button "צפה בלוח"
- button "בית"
- button "משחק חוזר"
- text: 🏆 טבלת דירוגים
- button "סגור"
- text: 📖 מדריך בוסט
- group:
  - text: לוח המשחק, תור וניקוד ▼
  - 'figure "מסך המשחק: לוח 10×10, ניקוד, שעון תור, מגש אותיות ובוסטים סביב הלוח."':
    - img "מסך משחק עם לוח, ניקוד ומגש אותיות"
    - text: "מסך המשחק: לוח 10×10, ניקוד, שעון תור, מגש אותיות ובוסטים סביב הלוח."
  - paragraph:
    - text: בכל תור מניחים אות אחת או יותר מאותו קו - שורה או טור - ומאשרים עם
    - strong: שבץ
    - text: . אחרי המהלך הראשון, כל מהלך חייב להתחבר לאות קיימת על הלוח.
  - list:
    - listitem: כל מילה חדשה שנוצרת חייבת להיות חוקית במילון.
    - listitem: אם נוצרת יותר ממילה אחת באותו מהלך, כולן נספרות לניקוד.
    - listitem: הנחת כל 8 האותיות מהמגש במהלך אחד נותנת בונוס +50.
    - listitem: ג'וקר יכול לייצג כל אות, אבל שווה 0 נקודות.
    - listitem: שני סבבים מלאים בלי ניקוד יכולים לסגור משחק תקוע.
- group: מסך הבית והניווט ▼
- group: משחקים ברשת וחברים ▼
- group: "כלי תור: מילון, החלפה, נעילה וג'וקר ▼"
- group: בוסטים ומיני-משחקים ▼
- group: סטטיסטיקות, דירוג ותובנות ▼
- group: פרופיל, אווטארים, מטבעות והישגים ▼
- group: מילון והצעות מילים ▼
- group: הגדרות, התראות ופרטיות ▼
- group: צור קשר ודיווח על בעיה ▼
- button "סגור"
- text: "? שאלות נפוצות"
- group:
  - text: איך מתחילים משחק? ▼
  - paragraph: במסך הבית בוחרים משחק ברשת, נגד המחשב או שני שחקנים על אותו מכשיר. משחק ברשת דורש חשבון כדי לשמור דירוג, חברים והתקדמות.
- group: מה ההבדל בין משחק חי למשחק אסינכרוני? ▼
- group: למה המילה שלי נדחתה? ▼
- group: איך מציעים מילה למילון? ▼
- group: איך עובד הדירוג? ▼
- group: איפה רואים סטטיסטיקות ותובנות? ▼
- group: איך מוסיפים חברים ומזמינים למשחק? ▼
- group: מה קורה אם היריב מתנתק? ▼
- group: איך משיגים מטבעות ואווטארים? ▼
- group: מהם הישגים? ▼
- group: למה לא קיבלתי התראת push? ▼
- group: האם חייבים חשבון? ▼
- group: אפשר לבטל מהלך אחרי שאישרתי? ▼
- group: איך מדווחים על תקלה או שולחים פנייה? ▼
- button "סגור"
- text: ✨ יצירת חשבון שם תצוגה (עד 15 תווים)
- textbox "השם שיופיע במשחק"
- text: דוא"ל
- textbox "your@email.com"
- text: סיסמה (8+ תווים, אות וספרה)
- textbox "••••••••"
- button "הצג סיסמה": 👁
- text: אימות סיסמה
- textbox "••••••••"
- button "הצג סיסמה": 👁
- checkbox "אני רוצה לקבל התראות (משחקים, הזמנות, תזכורות)" [checked]
- text: אני רוצה לקבל התראות (משחקים, הזמנות, תזכורות)
- button "צור חשבון"
- button "יש לי חשבון"
- button "המשך כאורח"
- text: 🔐 כניסה דוא"ל
- textbox "your@email.com"
- text: סיסמה
- textbox "••••••••"
- button "הצג סיסמה": 👁
- button "כניסה"
- button "שכחתי סיסמה"
- button "חשבון חדש"
- button "כאורח"
- text: הפרופיל שלי 👑 לחץ לשינוי אוואטאר לחץ לעריכה אחוז ניצחון 0% רצף נוכחי 🔥 0 נצחונות 0 שיא רצף 0 משחקים 0 שיא אישי 0
- button "חנות אווטארים ‹"
- button "חברים ‹"
- button "סטטיסטיקות מלאות ‹"
- button "התנתקות ‹"
- button "סגור": ✕
- button "אפשרויות": ⋮
- text: 📊 סטטיסטיקה ביניכם ⏱ 5 המשחקים האחרונים 🎮 משחקים פעילים
- button "✉ הזמן למשחק"
- text: חברים הקוד שלי ------
- button "📤 שתף קוד"
- text: הוסף חבר
- textbox "הזן קוד חבר (6 תווים)"
- button "הוסף חבר"
- text: 👥 החברים שלי (0) אין חברים עדיין
- button "🎁 הזמן חברים 🏅 חבר מביא חבר הזמן 5 חברים לבוסט 0/5 ‹"
- button "← חזרה לפרופיל"
- banner:
  - heading "הזמנות" [level=1]
- text: אין הזמנות חדשות אתם מעודכנים ✔ 🏆 הישגים 0 מתוך 17 הושגו
- button "חזרה": ‹
- text: "חנות אווטארים 0 לרכוש את האווטאר? המחיר: 0"
- button "קנה"
- button "ביטול"
- text: מטבעות יומיים! +0
- button "איסוף"
- text: הסטטיסטיקות שלי 🏆 שחקן בוסט ⚡ זהב 0 דירוג ELO 0% אחוז ניצחון 0 🔥 רצף נוכחי 🆕 הסגנון שלך חוקר התחל לשחק כדי לפתוח את הסגנון שלך הביצועים שלי ▾ השבוע שלך 10 משחקים אחרונים ישן עדכני ניצחונות / הפסדים ניצחונות 0 הפסדים 0 תיקו 0 מגמות השיאים שלי ▾ 🏆 שיא ניקוד למשחק 0 💯 הכי הרבה נקודות במהלך אחד 0 📏 המילה הארוכה ביותר — 🔥 רצף ניצחונות שיא 0 🚀 הקאמבק הכי גדול — קלאץ׳ / קאמבק 💪 0 ניצחונות בקאמבק 🎯 0 ניצחונות במהלך אחרון 🤝 0 משחקים צמודים שניצחת
- button "📤 שתף את הסטטיסטיקות שלי"
- text: סגנון המשחק שלי ▾ סגנון משחק האות המועדפת 🔤 — טרם נמדד האות שממנה יצרת הכי הרבה מילים ניתוח מילים היריבים שלי ▾
- banner:
  - button "חזרה": ←
  - text: המשחקים שלי
- text: אין משחקים פעילים פתח משחק אסינכרוני כדי לראות אותו כאן. 🎉 הישג הושלם! 🏆
- button "המשך"
- text: ✨ שמור את ההתקדמות שלך צור חשבון חינמי כדי לשמור סטטיסטיקות ולהופיע בטבלת האלופים.
- button "צור חשבון"
- button "לא עכשיו"
- text: פאנל ניהול
- tablist:
  - tab "📊 סטטיסטיקות" [selected]
  - tab "👥 שחקנים"
  - tab "📚 מילים"
  - tab "פניות"
  - tab "🐞 דיבאג"
- tabpanel:
  - text: — שחקנים רשומים — פעילים השבוע — פעילים 30 יום
  - button "— הצעות ממתינות ›"
  - button "— מחוברים עכשיו ›"
  - text: — ממתינים לחיפוש בריאות המילון
  - button "— מילים אושרו ↗"
  - button "— מילים חסומות ↗"
  - text: התפלגות דירוגים — 🪙 — 🥈 — 🥇 — 💎
  - button "⟳ רענן נתונים"
- button "← חזרה לבית"
- text: 🔁 שחזור משחק
- button "סגור": ✕
- text: שחקן 1 שחקן 2 שרת (אמת)
- button "◀"
- button "▶"
- button "▶"
- slider: "0"
- text: ✉ צור קשר בחרו סיבה וכתבו כמה מילים. אם מדובר בתקלה במשחק, נצרף גם תמונת מצב טכנית שתעזור לבדוק מה קרה. סיבת הפנייה
- combobox "סיבת הפנייה":
  - option "דווח על בעיה במשחק" [selected]
  - option "מילון או הצעת מילה"
  - option "חשבון, חברים או התראות"
  - option "הצעת שיפור"
  - option "אחר"
- 'textbox "לדוגמה: המילה נדחתה למרות שנראית תקינה / לא קיבלתי התראה / יש לי רעיון לשיפור..."'
- button "ביטול"
- button "שלח"
```

# Test source

```ts
  1   | const { test, expect } = require('@playwright/test');
  2   | const fs = require('node:fs');
  3   | 
  4   | test.use({ viewport: { width: 430, height: 932 }, video: { mode: 'on', size: { width: 430, height: 932 } } });
  5   | 
  6   | const cases = [
  7   |   { name: 'points', type: 'B2', os: 'no-preference', setting: 'auto' },
  8   |   { name: 'badge', type: 'B6', os: 'no-preference', setting: 'auto' },
  9   |   { name: 'mini-game', type: 'B1', os: 'no-preference', setting: 'auto' },
  10  |   { name: 'wheel', type: 'B13', os: 'no-preference', setting: 'auto' },
  11  |   { name: 'reduced-badge', type: 'B6', os: 'reduce', setting: 'auto', reduced: true },
  12  |   { name: 'reduced-intro', type: 'B1', os: 'no-preference', setting: 'on', reduced: true },
  13  |   { name: 'explicit-full', type: 'B2', os: 'reduce', setting: 'off' },
  14  |   { name: 'bot-points', type: 'B2', os: 'no-preference', setting: 'auto', botMove: true },
  15  | ];
  16  | 
  17  | for (const scenario of cases) {
  18  |   test(`Boost electric square precedes ${scenario.name} in a bot game`, async ({ page }, testInfo) => {
  19  |     test.setTimeout(60000);
  20  |     await page.emulateMedia({ reducedMotion: scenario.os });
  21  |     await page.addInitScript(setting => {
  22  |       localStorage.setItem('spine.uiPreferences', JSON.stringify({ reducedMotion: setting, soundFx: false }));
  23  |     }, scenario.setting);
  24  |     await page.goto('/');
  25  |     await page.waitForFunction(() => window.__spine?.enabled);
  26  |     await page.addStyleTag({ content: '#ov-onboarding,#app-loading{display:none!important}' });
  27  |     await page.evaluate(async ({ type, botMove }) => {
  28  |       const s = window.__spine;
  29  |       await s.ensureDictionaryLoaded();
  30  |       s.bootOfflineBot({ difficulty: botMove ? 1 : 0 });
  31  |       const state = s.activeGame.session.state;
  32  |       // A reproducible late-board fixture; placement and confirmation below
  33  |       // use real UI, dictionary validation, engine events and required UI.
  34  |       state.firstMove = false;
  35  |       state.board[4][0] = { letter: 'ל', val: 1 };
  36  |       state.board[4][1] = { letter: 'ו', val: 1 };
  37  |       state.board[4][2] = { letter: 'ם', val: 2 };
  38  |       state.racks[0] = ['ש', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז'];
  39  |       if (botMove) state.racks[1] = ['ש'];
  40  |       state.bonusAssignment[7] = { type, pts: 40, ic: '⚡' };
  41  |       s.bus.emit(s.EV.GAME_STARTED, {});
  42  |       window.boostTrace = { events: [], frames: [] };
  43  |       for (const name of [s.EV.MOVE_CONFIRMED, s.EV.BOOST_ACTIVATED, s.EV.BONUS_PENDING, 'boost/result-ready']) {
  44  |         s.bus.on(name, payload => boostTrace.events.push({ name, at: performance.now(), payload }));
  45  |       }
  46  |       window.boostSampler = setInterval(() => {
  47  |         const square = document.querySelector('#bsq-7');
  48  |         const core = getComputedStyle(square, '::before');
  49  |         const sparks = getComputedStyle(square, '::after');
  50  |         const result = document.querySelector('.bonus-award-positioner') || document.querySelector('#ov-bonus-intro:not(.hidden)');
  51  |         boostTrace.frames.push({ at: performance.now(), active: square.classList.contains('bonus-activate'),
  52  |           letter: square.querySelector('.bt-l')?.textContent,
  53  |           core: core.animationName, opacity: Number(core.opacity), glow: core.boxShadow,
  54  |           sparks: sparks.animationName, transform: sparks.transform, filter: core.filter,
  55  |           result: !!result, resultOpacity: result ? getComputedStyle(result).opacity : null,
  56  |           badge: !!document.querySelector('[data-badge="multiplier"]'),
  57  |           banner: !!document.querySelector('.spine-multiplier-banner'),
  58  |           squareOpacity: getComputedStyle(square).opacity,
  59  |         });
  60  |       }, 16);
  61  |     }, scenario);
  62  |     if (scenario.botMove) {
  63  |       await page.waitForTimeout(650);
  64  |       await page.evaluate(() => window.__spine.activeGame.session.dispatch({ type: 'cmd/PASS_TURN' }));
  65  |     } else {
  66  |       await page.locator('#brack .bt2').first().click();
  67  |       await page.locator('#bsq-7').click();
  68  |       await expect(page.locator('#bsq-7 .bt-l')).toHaveText('ש');
  69  |       await page.waitForTimeout(650);
  70  |       await page.locator('#btn-play').click();
  71  |     }
  72  |     const result = scenario.type === 'B1' || scenario.type === 'B13'
  73  |       ? page.locator('#ov-bonus-intro') : page.locator('.bonus-award-positioner');
> 74  |     await expect(result).toBeVisible({ timeout: scenario.botMove ? 15000 : 5000 });
      |                          ^ Error: expect(locator).toBeVisible() failed
  75  |     await page.waitForTimeout(750);
  76  |     const trace = await page.evaluate(() => {
  77  |       clearInterval(boostSampler);
  78  |       const square = document.querySelector('#bsq-7');
  79  |       return { ...boostTrace, rect: square.getBoundingClientRect().toJSON(),
  80  |         committed: window.__spine.activeGame.session.state.bonusSqUsed[7],
  81  |         ancestors: [square, square.parentElement, square.parentElement.parentElement].map(el => ({
  82  |           id: el.id, overflow: getComputedStyle(el).overflow, zIndex: getComputedStyle(el).zIndex,
  83  |         })),
  84  |       };
  85  |     });
  86  |     fs.writeFileSync(testInfo.outputPath('trace.json'), JSON.stringify(trace, null, 2));
  87  |     const activation = trace.events.find(e => e.name === 'evt/BOOST_ACTIVATED' || e.name === 'bonus/pending');
  88  |     const ready = trace.events.find(e => e.name === 'boost/result-ready');
  89  |     expect(activation).toBeTruthy();
  90  |     expect(activation.payload.slot).toBe(scenario.botMove ? 1 : 0);
  91  |     expect(trace.committed).toBe(true);
  92  |     expect(ready).toBeTruthy();
  93  |     const lit = trace.frames.filter(f => f.active);
  94  |     expect(lit.length).toBeGreaterThan(5);
  95  |     expect(lit.every(f => f.letter === 'ש' && f.squareOpacity === '1' && f.glow !== 'none' && f.filter === 'none')).toBe(true);
  96  |     if (scenario.reduced) {
  97  |       expect(ready.at - activation.at).toBeLessThan(40);
  98  |       expect(lit.every(f => f.core === 'none' && f.sparks === 'none' && f.transform === 'none')).toBe(true);
  99  |     } else {
  100 |       expect(ready.at - activation.at).toBeGreaterThanOrEqual(400);
  101 |       expect(ready.at - activation.at).toBeLessThan(520);
  102 |       const lead = lit.filter(f => f.at < ready.at);
  103 |       expect(lead.length).toBeGreaterThan(12);
  104 |       expect(lead.every(f => !f.result && !f.badge && !f.banner && f.opacity >= .8)).toBe(true);
  105 |       expect(new Set(lead.map(f => f.transform)).size).toBeGreaterThan(2);
  106 |       expect(lead.every(f => f.core === 'boostElectricCore')).toBe(true);
  107 |     }
  108 |     if (scenario.type === 'B6') expect(trace.frames.some(f => f.result && f.badge && f.banner)).toBe(true);
  109 |     expect(trace.frames.at(-1).active).toBe(false);
  110 |     // Required result remains usable and finalizes the genuine award.
  111 |     if (scenario.type !== 'B1' && scenario.type !== 'B13') {
  112 |       await page.locator('[data-bonus-ok]').click();
  113 |       await expect(result).toHaveCount(0);
  114 |       expect(await page.evaluate(() => window.__spine.activeGame.session.state.pendingScoreCommit)).toBeFalsy();
  115 |     } else {
  116 |       await page.locator('#ov-bonus-intro button').click();
  117 |       await expect(result).toHaveClass(/hidden/);
  118 |       await expect(result).toHaveCSS('opacity', '0');
  119 |       await page.waitForTimeout(500);
  120 |     }
  121 |   });
  122 | }
  123 | 
```