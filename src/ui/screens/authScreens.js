// authScreens — wires #sauth-signup, #sauth-login, and #ov-guest-upgrade.
//
// It pushes intents on the bus with form payloads. main.js wires those to
// Firebase auth through the compat SDK.
//
// Pure helpers (tested):
//   validateSignupForm({ name, email, password })
//   validateLoginForm({ email, password })
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
};

// Public mounter. Returns an object with `unmount()` and `showError(scope, msg)`
// for main.js to surface backend errors.
export function mountAuthScreens({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountAuthScreens: bus required');

  const cleanups = [];

  // ── Signup ─────────────────────────────────
  const suSubmit = $('#su-submit-btn',     root);
  const suError  = $('#su-error',          root);
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

  if (liSubmit) {
    liSubmit.removeAttribute?.('onclick');
    cleanups.push(on(liSubmit, 'click', (e) => {
      e?.preventDefault?.();
      const v = validateLoginForm({ email: liEmail?.value, password: liPass?.value });
      if (!v.ok) {
        paintLogin(AUTH_ERROR_HE[v.reason] ?? v.reason);
        return;
      }
      paintLogin('');
      bus.emit(AUTH_INTENT.LOG_IN, v.payload);
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
    cleanups.push(on(btn, 'click', () => bus.emit(AUTH_INTENT.DISMISS_UPGRADE, {})));
  }

  // ── Show/hide password toggles ─────────────
  // Any button with class `pw-toggle` and `data-pw-target="<input id>"`
  // flips that input between type=password and type=text.
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
      btn.textContent = shown ? '👁' : '🙈';
    }));
  }

  function showError(scope, msg) {
    if (scope === 'signup' && suError) setText(suError, msg ?? '');
    if (scope === 'login') paintLogin(msg ?? '');
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
  };
}
