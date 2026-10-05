import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountAuthScreens, validateSignupForm, validateLoginForm, validateResetForm,
  AUTH_ERROR_HE, AUTH_INTENT, firebaseAuthErrorHe,
  validatePickNameForm, suggestNameFromDisplayName, isSilentAuthCancel,
} from './authScreens.js';

test('firebaseAuthErrorHe: maps backend codes to Hebrew, never the raw string', () => {
  // Wrong credentials collapse to one generic message (no account enumeration).
  for (const code of ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found']) {
    assert.equal(firebaseAuthErrorHe({ code }), 'הדוא״ל או הסיסמה שגויים');
  }
  assert.equal(firebaseAuthErrorHe({ code: 'auth/invalid-email' }), 'דוא״ל לא חוקי');
  assert.equal(firebaseAuthErrorHe({ code: 'auth/email-already-in-use' }), 'הדוא״ל הזה כבר רשום');
  // Unknown code → Hebrew fallback, not the English message.
  const e = { code: 'auth/something-new', message: 'The supplied auth credential is incorrect.' };
  const msg = firebaseAuthErrorHe(e);
  assert.notEqual(msg, e.message);
  assert.match(msg, /[֐-׿]/); // contains Hebrew
});

test('validateSignupForm: rejects missing fields', () => {
  assert.equal(validateSignupForm({}).reason, 'no-name');
  assert.equal(validateSignupForm({ name: 'X' }).reason, 'bad-email');
  assert.equal(validateSignupForm({ name: 'X', email: 'x@y.com' }).reason, 'pass-too-short');
});

test('validateSignupForm: rejects weak password', () => {
  assert.equal(validateSignupForm({ name: 'X', email: 'x@y.com', password: 'aaaaaaaa' }).reason, 'pass-weak');
  assert.equal(validateSignupForm({ name: 'X', email: 'x@y.com', password: '12345678' }).reason, 'pass-weak');
});

test('validateSignupForm: accepts a strong form', () => {
  const r = validateSignupForm({ name: 'נחום ', email: ' me@x.com ', password: 'Pass1234' });
  assert.equal(r.ok, true);
  assert.equal(r.payload.name, 'נחום');
  assert.equal(r.payload.email, 'me@x.com');
});

test('validateSignupForm: rejects 16-char name', () => {
  const r = validateSignupForm({ name: 'a'.repeat(16), email: 'x@y.com', password: 'Pass1234' });
  assert.equal(r.reason, 'name-too-long');
});

test('validateLoginForm: accepts valid email + non-empty pass', () => {
  assert.equal(validateLoginForm({ email: 'x@y.com', password: 'a' }).ok, true);
});

test('validateLoginForm: rejects bad email / no pass', () => {
  assert.equal(validateLoginForm({ email: 'x' }).reason, 'bad-email');
  assert.equal(validateLoginForm({ email: 'x@y.com' }).reason, 'no-pass');
});

test('AUTH_ERROR_HE has Hebrew messages for each reason', () => {
  for (const k of ['no-name','name-too-long','bad-email','pass-too-short','pass-weak','no-pass']) {
    assert.ok(AUTH_ERROR_HE[k]?.length > 0);
  }
});

function makeBtn({ onclick } = {}) {
  const listeners = [];
  const attrs = { onclick };
  return {
    getAttribute(n) { return attrs[n] ?? null; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeInput(value = '') { return { value }; }
function makeLabel() { return { textContent: '', style: { color: '' } }; }

function makeRoot({ name = '', email = '', password = '', liEmail = '', liPass = '', pnName = '' } = {}) {
  const els = {
    suSubmit: makeBtn(),
    suError:  makeLabel(),
    suNameError: makeLabel(),
    suName:   makeInput(name),
    suEmail:  makeInput(email),
    suPass:   makeInput(password),
    liSubmit: makeBtn(),
    liError:  makeLabel(),
    liEmail:  makeInput(liEmail),
    liPass:   makeInput(liPass),
    liForgot: makeBtn(),
    goLogin:  makeBtn({ onclick: "showSc('sauth-login')" }),
    goSignup: makeBtn({ onclick: "showSc('sauth-signup')" }),
    guest:    makeBtn({ onclick: 'continueAsGuest()' }),
    upgradeOverlay: { classList: { add(){}, remove(){}, contains: () => false } },
    liGoogle: makeBtn(),
    suGoogle: makeBtn(),
    ovguGoogle: makeBtn(),
    pnOverlay: (() => { const c = new Set(['hidden']); return { _cls: c, classList: { add: x => c.add(x), remove: x => c.delete(x), contains: x => c.has(x) } }; })(),
    pnName: makeInput(pnName),
    pnError: makeLabel(),
    pnSubmit: makeBtn(),
  };
  const root = {
    querySelector(sel) {
      switch (sel) {
        case '#su-submit-btn':   return els.suSubmit;
        case '#su-error':        return els.suError;
        case '#su-name-error':   return els.suNameError;
        case '#su-name':         return els.suName;
        case '#su-email':        return els.suEmail;
        case '#su-pass':         return els.suPass;
        case '#li-submit-btn':   return els.liSubmit;
        case '#li-error':        return els.liError;
        case '#li-email':        return els.liEmail;
        case '#li-pass':         return els.liPass;
        case '#li-forgot-btn':   return els.liForgot;
        case "button[onclick=\"showSc('sauth-login')\"]":  return els.goLogin;
        case "button[onclick=\"showSc('sauth-signup')\"]": return els.goSignup;
        case '#ov-guest-upgrade': return els.upgradeOverlay;
        case '#li-google-btn':   return els.liGoogle;
        case '#su-google-btn':   return els.suGoogle;
        case '#ovgu-google-btn': return els.ovguGoogle;
        case '#ov-pick-name':    return els.pnOverlay;
        case '#pn-name':         return els.pnName;
        case '#pn-error':        return els.pnError;
        case '#pn-submit':       return els.pnSubmit;
        default: return null;
      }
    },
    querySelectorAll(sel) {
      if (sel === 'button[onclick="continueAsGuest()"]') return [els.guest];
      return [];
    },
  };
  return { root, els };
}

test('signup submit: valid → SIGN_UP intent with payload; clears error', () => {
  bus._reset();
  const { root, els } = makeRoot({ name: 'דני', email: 'd@y.com', password: 'Pass1234' });
  const events = [];
  bus.on(AUTH_INTENT.SIGN_UP, (p) => events.push(p));
  mountAuthScreens({ root, bus });
  els.suSubmit.fireClick();
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'דני');
  assert.equal(els.suError.textContent, '');
});

test('signup submit: invalid → paints error, no intent fired', () => {
  bus._reset();
  const { root, els } = makeRoot({ name: '', email: 'no', password: 'short' });
  let n = 0;
  bus.on(AUTH_INTENT.SIGN_UP, () => { n++; });
  mountAuthScreens({ root, bus });
  els.suSubmit.fireClick();
  assert.equal(n, 0);
  assert.match(els.suError.textContent, /שם/);
});

test('login submit: valid → LOG_IN intent', () => {
  bus._reset();
  const { root, els } = makeRoot({ liEmail: 'me@x.com', liPass: 'Pass1234' });
  const events = [];
  bus.on(AUTH_INTENT.LOG_IN, (p) => events.push(p));
  mountAuthScreens({ root, bus });
  els.liSubmit.fireClick();
  assert.equal(events.length, 1);
  assert.equal(events[0].email, 'me@x.com');
});

test('go-signup / go-login / continue-as-guest emit intents', () => {
  bus._reset();
  const { root, els } = makeRoot();
  const got = [];
  bus.on(AUTH_INTENT.GO_LOGIN,        () => got.push('login'));
  bus.on(AUTH_INTENT.GO_SIGNUP,       () => got.push('signup'));
  bus.on(AUTH_INTENT.CONTINUE_GUEST,  () => got.push('guest'));
  mountAuthScreens({ root, bus });
  els.goLogin.fireClick();
  els.goSignup.fireClick();
  els.guest.fireClick();
  assert.deepEqual(got, ['login','signup','guest']);
});

test('showError surfaces an arbitrary message under the right scope', () => {
  bus._reset();
  const { root, els } = makeRoot();
  const screen = mountAuthScreens({ root, bus });
  screen.showError('signup', 'דוא״ל בשימוש');
  screen.showError('login',  'סיסמה שגויה');
  screen.showError('signup-name', 'שם המשתמש כבר קיים');
  assert.equal(els.suError.textContent, 'דוא״ל בשימוש');
  assert.equal(els.liError.textContent, 'סיסמה שגויה');
  // The name-taken message renders under the שם תצוגה field, not the
  // form-level error row.
  assert.equal(els.suNameError.textContent, 'שם המשתמש כבר קיים');
});

test('throws if bus missing', () => {
  assert.throws(() => mountAuthScreens({}), /bus required/);
});

test('validateResetForm: accepts valid email, rejects empty/bad', () => {
  assert.equal(validateResetForm({ email: 'a@b.com' }).ok, true);
  assert.equal(validateResetForm({ email: 'a@b.com' }).payload.email, 'a@b.com');
  assert.equal(validateResetForm({}).reason, 'bad-email');
  assert.equal(validateResetForm({ email: 'nope' }).reason, 'bad-email');
});

test('forgot-password click: valid email → RESET_PASSWORD intent', () => {
  bus._reset();
  const { root, els } = makeRoot({ liEmail: 'me@x.com' });
  const events = [];
  bus.on(AUTH_INTENT.RESET_PASSWORD, (p) => events.push(p));
  mountAuthScreens({ root, bus });
  els.liForgot.fireClick();
  assert.equal(events.length, 1);
  assert.equal(events[0].email, 'me@x.com');
});

test('forgot-password click: bad email → error painted, no intent', () => {
  bus._reset();
  const { root, els } = makeRoot({ liEmail: 'not-an-email' });
  let n = 0;
  bus.on(AUTH_INTENT.RESET_PASSWORD, () => { n++; });
  mountAuthScreens({ root, bus });
  els.liForgot.fireClick();
  assert.equal(n, 0);
  assert.match(els.liError.textContent, /דוא/);
});

test('showInfo paints login status with success color', () => {
  bus._reset();
  const { root, els } = makeRoot();
  const screen = mountAuthScreens({ root, bus });
  screen.showInfo('login', 'נשלח אימייל לאיפוס הסיסמה');
  assert.equal(els.liError.textContent, 'נשלח אימייל לאיפוס הסיסמה');
  assert.equal(els.liError.style.color, '#8be38b');
});

test('google buttons emit GOOGLE with the screen scope', () => {
  bus._reset();
  const { root, els } = makeRoot();
  const events = [];
  bus.on(AUTH_INTENT.GOOGLE, (p) => events.push(p.scope));
  mountAuthScreens({ root, bus });
  els.liGoogle.fireClick();
  els.suGoogle.fireClick();
  els.ovguGoogle.fireClick();
  assert.deepEqual(events, ['login', 'signup', 'upgrade']);
});

test('pick-name: valid → PICK_NAME intent; invalid → error, no intent', () => {
  bus._reset();
  const { root, els } = makeRoot({ pnName: '  דנה  ' });
  const events = [];
  bus.on(AUTH_INTENT.PICK_NAME, (p) => events.push(p));
  const api = mountAuthScreens({ root, bus });
  els.pnSubmit.fireClick();
  assert.deepEqual(events, [{ name: 'דנה' }]);

  els.pnName.value = '';
  api.showError('pickname-name', '');
  els.pnSubmit.fireClick();
  assert.equal(events.length, 1);
  assert.equal(els.pnError.textContent, AUTH_ERROR_HE['no-name']);
});

test('showPickName opens the overlay pre-filled; hidePickName closes it', () => {
  bus._reset();
  const { root, els } = makeRoot();
  const api = mountAuthScreens({ root, bus });
  api.showPickName('נחום');
  assert.equal(els.pnOverlay.classList.contains('hidden'), false);
  assert.equal(els.pnName.value, 'נחום');
  api.showError('pickname-name', AUTH_ERROR_HE['name-taken']);
  assert.equal(els.pnError.textContent, AUTH_ERROR_HE['name-taken']);
  api.hidePickName();
  assert.equal(els.pnOverlay.classList.contains('hidden'), true);
});

test('validatePickNameForm / suggestNameFromDisplayName / isSilentAuthCancel', () => {
  assert.equal(validatePickNameForm({ name: '' }).reason, 'no-name');
  assert.equal(validatePickNameForm({ name: 'א'.repeat(16) }).reason, 'name-too-long');
  assert.equal(validatePickNameForm({ name: 'דני' }).ok, true);
  assert.equal(suggestNameFromDisplayName('Nachum Rubin'), 'Nachum');
  assert.equal(suggestNameFromDisplayName('Abcdefghijklmnopqrs'), 'Abcdefghijklmno');
  assert.equal(suggestNameFromDisplayName(null), '');
  assert.equal(isSilentAuthCancel({ code: 'auth/popup-closed-by-user' }), true);
  assert.equal(isSilentAuthCancel({ code: 'auth/popup-blocked' }), false);
  assert.notEqual(firebaseAuthErrorHe({ code: 'auth/popup-blocked' }), 'אירעה שגיאה. נסו שוב');
});
