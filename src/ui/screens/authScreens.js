// authScreens — wires #sauth-signup, #sauth-login, #ov-guest-upgrade and the
// post-Google-sign-in name picker #ov-pick-name.
//
// It pushes intents on the bus with form payloads. main.js wires those to
// Firebase auth through the compat SDK.
//
// Pure helpers (tested):
//   validateSignupForm({ name, email, password })
//   validateLoginForm({ email, password })
//   validatePickNameForm({ name })
//
// Both surface localised error strings so the screen can paint them.

import { $, on, setText } from '../domHelpers.js';

export const AUTH_INTENT = Object.freeze({
  SIGN_UP:        'auth/signUp',
  LOG_IN:         'auth/logIn',
  RESET_PASSWORD: 'auth/resetPassword',
  CONTINUE_GUEST: 'auth/continueGuest',
  GO_SIGNUP:      'auth/goSignUp',
  GO_LOGIN:       'auth/goLogIn',
  UPGRADE:        'auth/upgrade',
  DISMISS_UPGRADE:'auth/dismissUpgrade',
  GUEST_JOIN_CODE:'auth/guestJoinCode',   // the sign-up sheet's "קיבלתי קוד מחבר"
  GOOGLE:         'auth/google',
  PICK_NAME:      'auth/pickName',
});

// The guest sign-up sheet (#ov-guest-upgrade), worded for what the guest tried to do.
// `code`: show "קיבלתי קוד מחבר" (online play: a friend's invite works without an account).
export const GUEST_UPGRADE_COPY = Object.freeze({
  default: {
    title: 'שמור את ההתקדמות שלך',
    desc: 'צור חשבון חינמי כדי לשמור סטטיסטיקות, מטבעות והישגים, ולהופיע בטבלת הדירוגים.',
    code: false,
  },
  online: {
    title: 'משחק אונליין דורש חשבון',
    desc: 'לוקח 10 שניות. עם חשבון המשחקים שלך נשמרים גם בטלפון חדש, ואתה מקבל דירוג ומקום בטבלה.',
    code: true,
  },
  afterOnline: {
    title: 'משחק יפה!',
    desc: 'צור חשבון חינמי כדי לקבל דירוג, לשמור את המשחקים שלך ולשחק שוב עם חברים.',
    code: false,
  },
});

const NAME_MAX = 15;
const PASS_MIN = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASS_HAS_LETTER = /[A-Za-z]/;
const PASS_HAS_DIGIT  = /\d/;

export function validateSignupForm({ name, email, password, passwordConfirm, wantsNotifications } = {}) {
  const n = (name ?? '').trim();
  const e = (email ?? '').trim();
  if (n.length === 0) return { ok: false, reason: 'no-name' };
  if (n.length > NAME_MAX) return { ok: false, reason: 'name-too-long' };
  if (!EMAIL_RE.test(e)) return { ok: false, reason: 'bad-email' };
  if (!password || password.length < PASS_MIN) return { ok: false, reason: 'pass-too-short' };
  if (!PASS_HAS_LETTER.test(password) || !PASS_HAS_DIGIT.test(password)) return { ok: false, reason: 'pass-weak' };
  // Only enforce the confirm match when a confirm value is supplied — keeps
  // the validator backwards-compatible with callers that don't collect one.
  if (passwordConfirm != null && passwordConfirm !== password) return { ok: false, reason: 'pass-mismatch' };
  return { ok: true, payload: { name: n, email: e, password, wantsNotifications: wantsNotifications !== false } };
}

export function validateLoginForm({ email, password } = {}) {
  const e = (email ?? '').trim();
  if (!EMAIL_RE.test(e)) return { ok: false, reason: 'bad-email' };
  if (!password || password.length === 0) return { ok: false, reason: 'no-pass' };
  return { ok: true, payload: { email: e, password } };
}

export function validatePickNameForm({ name } = {}) {
  const n = (name ?? '').trim();
  if (n.length === 0) return { ok: false, reason: 'no-name' };
  if (n.length > NAME_MAX) return { ok: false, reason: 'name-too-long' };
  return { ok: true, payload: { name: n } };
}

// Pre-fill for the name picker: the first word of the Google display name,
// clipped to the game's name limit. Empty when Google gave us nothing.
export function suggestNameFromDisplayName(displayName) {
  const first = String(displayName ?? '').trim().split(/\s+/)[0] ?? '';
  return first.slice(0, NAME_MAX);
}

export function validateResetForm({ email } = {}) {
  const e = (email ?? '').trim();
  if (!EMAIL_RE.test(e)) return { ok: false, reason: 'bad-email' };
  return { ok: true, payload: { email: e } };
}

export const AUTH_ERROR_HE = {
  'no-name':        'אנא הכנס שם תצוגה',
  'name-too-long':  `שם עד ${NAME_MAX} תווים`,
  'bad-email':      'דוא״ל לא חוקי',
  'pass-too-short': `סיסמה חייבת להיות לפחות ${PASS_MIN} תווים`,
  'pass-weak':      'הסיסמה חייבת לכלול אות וספרה',
  'pass-mismatch':  'הסיסמאות אינן תואמות',
  'no-pass':        'אנא הכנס סיסמה',
  'name-taken':     'שם המשתמש כבר קיים, בחרו שם אחר',
};

// Firebase Auth backend error codes → Hebrew. Wrong-password / user-not-found
// / invalid-credential are deliberately collapsed into one generic message so
// we don't leak whether an email is registered.
export const FIREBASE_AUTH_ERROR_HE = {
  'auth/invalid-credential':        'הדוא״ל או הסיסמה שגויים',
  'auth/invalid-login-credentials': 'הדוא״ל או הסיסמה שגויים',
  'auth/wrong-password':            'הדוא״ל או הסיסמה שגויים',
  'auth/user-not-found':            'הדוא״ל או הסיסמה שגויים',
  'auth/invalid-email':             'דוא״ל לא חוקי',
  'auth/missing-password':          'אנא הכנס סיסמה',
  'auth/user-disabled':             'החשבון הזה הושבת',
  'auth/too-many-requests':         'יותר מדי ניסיונות. נסו שוב מאוחר יותר',
  'auth/network-request-failed':    'אין חיבור לאינטרנט. נסו שוב',
  'auth/email-already-in-use':      'הדוא״ל הזה כבר רשום. נרשמתם עם Google? היכנסו עם Google, או הגדירו סיסמה ב״שכחתי סיסמה״',
  'auth/credential-already-in-use': 'הדוא״ל הזה כבר רשום',   // a guest linking a taken email
  'auth/weak-password':             `סיסמה חייבת להיות לפחות ${PASS_MIN} תווים`,
  // Google popup flow
  'auth/popup-blocked':             'הדפדפן חסם את חלון ההתחברות. אפשרו חלונות קופצים ונסו שוב',
  'auth/operation-not-supported-in-this-environment': 'פתחו את המשחק בדפדפן (Chrome / Safari) כדי להתחבר עם Google',
  'auth/web-storage-unsupported':   'פתחו את המשחק בדפדפן (Chrome / Safari) כדי להתחבר עם Google',
  'auth/unauthorized-domain':       'התחברות עם Google לא זמינה בכתובת הזו',
  'auth/operation-not-allowed':     'התחברות עם Google עדיין לא הופעלה',
  'auth/account-exists-with-different-credential': 'הדוא״ל הזה כבר רשום עם סיסמה. היכנסו עם דוא״ל וסיסמה, ו-Google יחובר לחשבון',
};

// The user closed / superseded the Google popup — not an error worth showing.
export function isSilentAuthCancel(e) {
  return e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request';
}

// Resolve a thrown Firebase Auth error (or anything with a `.code`) to a
// Hebrew message, never the raw English string. Unknown codes fall back.
export function firebaseAuthErrorHe(e, fallback = 'אירעה שגיאה. נסו שוב') {
  return FIREBASE_AUTH_ERROR_HE[e?.code ?? ''] ?? fallback;
}

// Public mounter. Returns an object with `unmount()` and `showError(scope, msg)`
// for main.js to surface backend errors.
export function mountAuthScreens({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountAuthScreens: bus required');

  const cleanups = [];

  // ── Signup ─────────────────────────────────
  const suSubmit = $('#su-submit-btn',     root);
  const suError  = $('#su-error',          root);
  const suNameError = $('#su-name-error',  root);
  const suName   = $('#su-name',           root);
  const suEmail  = $('#su-email',          root);
  const suPass   = $('#su-pass',           root);
  const suPassConfirm = $('#su-pass-confirm', root);
  const suNotify = $('#su-notify',         root);
  const goLoginBtn  = $('button[onclick="showSc(\'sauth-login\')"]',  root);
  const goSignupBtn = $('button[onclick="showSc(\'sauth-signup\')"]', root);
  const guestBtns   = root?.querySelectorAll
    ? Array.from(root.querySelectorAll('button[onclick="continueAsGuest()"]'))
    : [];

  if (suSubmit) {
    suSubmit.removeAttribute?.('onclick');
    cleanups.push(on(suSubmit, 'click', (e) => {
      e?.preventDefault?.();
      const v = validateSignupForm({
        name: suName?.value,
        email: suEmail?.value,
        password: suPass?.value,
        passwordConfirm: suPassConfirm?.value,
        wantsNotifications: suNotify ? !!suNotify.checked : true,
      });
      // Fresh attempt — clear both the field-level and form-level errors.
      if (suNameError) setText(suNameError, '');
      if (!v.ok) {
        if (suError) setText(suError, AUTH_ERROR_HE[v.reason] ?? v.reason);
        return;
      }
      if (suError) setText(suError, '');
      bus.emit(AUTH_INTENT.SIGN_UP, v.payload);
    }));
  }

  // ── Login ─────────────────────────────────
  const liSubmit = $('#li-submit-btn', root);
  const liError  = $('#li-error',      root);
  const liEmail  = $('#li-email',      root);
  const liPass   = $('#li-pass',       root);
  const liForgot = $('#li-forgot-btn', root);

  function paintLogin(msg, color = '#ff8e8e') {
    if (!liError) return;
    setText(liError, msg ?? '');
    if (liError.style) liError.style.color = color;
  }

  // While a sign-in is in flight the button says so and ignores taps: the request
  // takes a second or two, and without feedback players tapped again.
  const liSubmitText = liSubmit?.textContent ?? 'כניסה';
  let loginBusy = false;
  function setLoginBusy(busy) {
    loginBusy = !!busy;
    if (!liSubmit) return;
    liSubmit.disabled = loginBusy;
    setText(liSubmit, loginBusy ? 'נכנס…' : liSubmitText);
  }

  async function submitLogin() {
    if (loginBusy) return;
    let password = liPass?.value;
    // Chrome may hand an autofilled password to the page a moment after the tap.
    if (!password) {
      await new Promise((r) => globalThis.setTimeout(r, 60));
      password = liPass?.value;
    }
    const v = validateLoginForm({ email: liEmail?.value, password });
    if (!v.ok) {
      paintLogin(AUTH_ERROR_HE[v.reason] ?? v.reason);
      return;
    }
    paintLogin('');
    setLoginBusy(true);
    bus.emit(AUTH_INTENT.LOG_IN, v.payload);
  }

  if (liSubmit) {
    liSubmit.removeAttribute?.('onclick');
    cleanups.push(on(liSubmit, 'click', (e) => {
      e?.preventDefault?.();
      submitLogin();
    }));
  }
  // The keyboard's Enter / "Go" on the password field signs in too.
  if (liPass) {
    cleanups.push(on(liPass, 'keydown', (e) => {
      if (e?.key !== 'Enter') return;
      e.preventDefault?.();
      submitLogin();
    }));
  }

  if (liForgot) {
    cleanups.push(on(liForgot, 'click', (e) => {
      e?.preventDefault?.();
      const v = validateResetForm({ email: liEmail?.value });
      if (!v.ok) {
        paintLogin(AUTH_ERROR_HE[v.reason] ?? v.reason);
        return;
      }
      paintLogin('');
      bus.emit(AUTH_INTENT.RESET_PASSWORD, v.payload);
    }));
  }

  goLoginBtn?.removeAttribute?.('onclick');
  goSignupBtn?.removeAttribute?.('onclick');
  if (goLoginBtn)  cleanups.push(on(goLoginBtn,  'click', () => bus.emit(AUTH_INTENT.GO_LOGIN,  {})));
  if (goSignupBtn) cleanups.push(on(goSignupBtn, 'click', () => bus.emit(AUTH_INTENT.GO_SIGNUP, {})));
  for (const btn of guestBtns) {
    btn.removeAttribute?.('onclick');
    cleanups.push(on(btn, 'click', () => bus.emit(AUTH_INTENT.CONTINUE_GUEST, {})));
  }

  // ── Guest-upgrade overlay (#ov-guest-upgrade) ──
  // The overlay's "create account" button is the same #sauth-signup
  // launcher we already wired above; we just add a listener to record
  // the upgrade intent (so analytics / spine flows know).
  const upgradeOverlay = $('#ov-guest-upgrade', root);
  const upgradeAcceptBtns = root?.querySelectorAll
    ? Array.from(root.querySelectorAll('#ov-guest-upgrade button[onclick*="signup"]'))
    : [];
  for (const btn of upgradeAcceptBtns) {
    btn.removeAttribute?.('onclick');
    cleanups.push(on(btn, 'click', () => {
      bus.emit(AUTH_INTENT.UPGRADE, {});
      upgradeOverlay?.classList?.add?.('hidden');
    }));
  }
  const upgradeDismissBtns = root?.querySelectorAll
    ? Array.from(root.querySelectorAll('#ov-guest-upgrade button[onclick*="ovClose"]'))
    : [];
  for (const btn of upgradeDismissBtns) {
    btn.removeAttribute?.('onclick');
    // The inline ovClose() was just stripped and nothing handles the intent,
    // so close the overlay here — "not now" used to leave it on screen
    // (full regression run, Oct 2026).
    cleanups.push(on(btn, 'click', () => {
      upgradeOverlay?.classList?.add?.('hidden');
      bus.emit(AUTH_INTENT.DISMISS_UPGRADE, {});
    }));
  }

  const upgradeTitle = $('#ovgu-title', root);
  const upgradeDesc  = $('#ovgu-desc', root);
  const upgradeCode  = $('#ovgu-code-btn', root);
  if (upgradeCode) {
    cleanups.push(on(upgradeCode, 'click', () => {
      upgradeOverlay?.classList?.add?.('hidden');
      bus.emit(AUTH_INTENT.GUEST_JOIN_CODE, {});
    }));
  }
  // Opens the sheet worded for `reason` (a GUEST_UPGRADE_COPY key).
  function showUpgrade(reason = 'default') {
    const copy = GUEST_UPGRADE_COPY[reason] ?? GUEST_UPGRADE_COPY.default;
    if (upgradeTitle) setText(upgradeTitle, copy.title);
    if (upgradeDesc) setText(upgradeDesc, copy.desc);
    if (upgradeCode?.style) upgradeCode.style.display = copy.code ? '' : 'none';
    upgradeOverlay?.classList?.remove?.('hidden');
  }

  // ── Google sign-in buttons ──
  // One intent for all three entry points; main.js decides between linking a
  // guest account and a plain sign-in. `scope` routes errors back to the
  // screen the player pressed it on.
  const googleBtns = [
    ['#li-google-btn',   'login'],
    ['#su-google-btn',   'signup'],
    ['#ovgu-google-btn', 'upgrade'],
  ];
  for (const [sel, scope] of googleBtns) {
    const btn = $(sel, root);
    if (!btn) continue;
    cleanups.push(on(btn, 'click', (e) => {
      e?.preventDefault?.();
      if (scope === 'upgrade') upgradeOverlay?.classList?.add?.('hidden');
      showError(scope, '');
      bus.emit(AUTH_INTENT.GOOGLE, { scope });
    }));
  }

  // ── Pick-name overlay (#ov-pick-name) ──
  const pnOverlay = $('#ov-pick-name', root);
  const pnName    = $('#pn-name',      root);
  const pnError   = $('#pn-error',     root);
  const pnSubmit  = $('#pn-submit',    root);
  if (pnSubmit) {
    cleanups.push(on(pnSubmit, 'click', (e) => {
      e?.preventDefault?.();
      const v = validatePickNameForm({ name: pnName?.value });
      if (!v.ok) {
        if (pnError) setText(pnError, AUTH_ERROR_HE[v.reason] ?? v.reason);
        return;
      }
      if (pnError) setText(pnError, '');
      pnSubmit.disabled = true;
      bus.emit(AUTH_INTENT.PICK_NAME, v.payload);
    }));
  }

  function showPickName(prefill = '') {
    if (!pnOverlay) return;
    if (pnName && !pnName.value) pnName.value = prefill;
    if (pnError) setText(pnError, '');
    if (pnSubmit) pnSubmit.disabled = false;
    pnOverlay.classList?.remove?.('hidden');
  }
  function hidePickName() {
    pnOverlay?.classList?.add?.('hidden');
    if (pnSubmit) pnSubmit.disabled = false;
  }

  // ── Show/hide password toggles ─────────────
  // Any button with class `pw-toggle` and `data-pw-target="<input id>"`
  // flips that input between type=password and type=text. The button text
  // stays 👁 always; CSS draws a diagonal strikethrough via .pw-shown to
  // signal the "hide" state (instead of swapping to a monkey emoji).
  const pwToggleBtns = root?.querySelectorAll
    ? Array.from(root.querySelectorAll('.pw-toggle'))
    : [];
  for (const btn of pwToggleBtns) {
    cleanups.push(on(btn, 'click', (e) => {
      e?.preventDefault?.();
      const targetId = btn.getAttribute?.('data-pw-target');
      if (!targetId) return;
      const input = root?.getElementById?.(targetId) ?? root?.querySelector?.(`#${targetId}`);
      if (!input) return;
      const shown = input.type === 'text';
      input.type = shown ? 'password' : 'text';
      btn.classList?.[shown ? 'remove' : 'add']?.('pw-shown');
      btn.setAttribute?.('aria-label', shown ? 'הצג סיסמה' : 'הסתר סיסמה');
    }));
  }

  function showError(scope, msg) {
    if (scope === 'signup' && suError) setText(suError, msg ?? '');
    // Field-level error rendered directly under the שם תצוגה input.
    if (scope === 'signup-name' && suNameError) setText(suNameError, msg ?? '');
    if (scope === 'login') { paintLogin(msg ?? ''); setLoginBusy(false); }
    if (scope === 'pickname' || scope === 'pickname-name') {
      if (pnError) setText(pnError, msg ?? '');
      if (pnSubmit) pnSubmit.disabled = false;
    }
  }

  function showInfo(scope, msg) {
    if (scope === 'login') paintLogin(msg ?? '', '#8be38b');
  }

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
    showError,
    showInfo,
    setLoginBusy,
    showUpgrade,
    showPickName,
    hidePickName,
  };
}
