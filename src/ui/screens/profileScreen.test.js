import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountProfileScreen, deriveStats, avatarEmoji,
  PROFILE_INTENT, PROFILE_RENDER,
} from './profileScreen.js';

function makeBtn({ onclick } = {}) {
  const listeners = [];
  return {
    style: { display: '' },
    getAttribute(n) { return n === 'onclick' ? (onclick ?? null) : null; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeEl(initial = {}) {
  const listeners = [];
  return {
    textContent: initial.textContent ?? '',
    value:       initial.value       ?? '',
    style: { display: '' },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({}); },
    focus() {},
  };
}

function makeDom() {
  const els = {
    screen:  makeEl(),
    avatar:  makeEl(),
    name:    makeEl(),
    editWrap:makeEl(),
    nameInp: makeEl(),
    nameErr: makeEl(),
    upgrade: makeBtn(),
    email:   makeEl(),
    played:  makeEl(),
    wins:    makeEl(),
    winrate: makeEl(),
    high:    makeEl(),
    long:    makeEl(),
    streak:  makeEl(),
    saveBtn:    makeBtn({ onclick: 'saveDisplayName()' }),
    cancelBtn:  makeBtn({ onclick: 'cancelNameEdit()' }),
    avatarBtn:  makeBtn({ onclick: 'showAvatarStore()' }),
    friendsBtn: makeBtn({ onclick: 'showFriendsScreen()' }),
    statsBtn:   makeBtn({ onclick: 'showStatsScreen()' }),
    logoutBtn:  makeBtn({ onclick: 'logoutUser()' }),
    backBtn:    makeBtn({ onclick: 'goHome()' }),
  };
  const root = {
    querySelector(sel) {
      switch (sel) {
        case '#sprofile':                return els.screen;
        case '#profile-avatar-display':  return els.avatar;
        case '#profile-name-display':    return els.name;
        case '#profile-name-edit':       return els.editWrap;
        case '#profile-name-input':      return els.nameInp;
        case '#profile-name-error':      return els.nameErr;
        case '#btn-upgrade-account':     return els.upgrade;
        case '#profile-email-display':   return els.email;
        case '#stat-played':             return els.played;
        case '#stat-wins':               return els.wins;
        case '#stat-winrate':            return els.winrate;
        case '#stat-highscore':          return els.high;
        case '#stat-longeststreak':      return els.long;
        case '#stat-streak':             return els.streak;
        case 'button[onclick="saveDisplayName()"]':  return els.saveBtn;
        case 'button[onclick="cancelNameEdit()"]':   return els.cancelBtn;
        case 'button[onclick="showAvatarStore()"]':  return els.avatarBtn;
        case 'button[onclick="showFriendsScreen()"]':return els.friendsBtn;
        case 'button[onclick="showStatsScreen()"]':  return els.statsBtn;
        case 'button[onclick="logoutUser()"]':       els.logoutBtn; return els.logoutBtn;
        case 'button[onclick="goHome()"]':           return els.backBtn;
        default: return null;
      }
    },
  };
  return { root, els };
}

test('avatarEmoji: known + fallback', () => {
  assert.equal(avatarEmoji('crown'),   '👑');
  assert.equal(avatarEmoji('dragon'),  '🐉');
  assert.equal(avatarEmoji('mystery'), '👑');
});

test('avatarEmoji: pass-through for already-resolved emoji values', () => {
  // Some legacy paths (room players, queue entries, invites) store the raw
  // emoji character instead of the id — both should render the same icon.
  assert.equal(avatarEmoji('💎'), '💎');
  assert.equal(avatarEmoji('🐉'), '🐉');
  assert.equal(avatarEmoji(null), '👑');
  assert.equal(avatarEmoji(undefined), '👑');
});

test('avatarEmoji: passes store-avatar ids through (room/queue boundary)', () => {
  // Store avatars are image-only; the id must survive into player.avatar so the
  // opponent resolves it to a PNG. Without this it would collapse to 👑.
  assert.equal(avatarEmoji('rare_3'), 'rare_3');
  assert.equal(avatarEmoji('legendary_1'), 'legendary_1');
  assert.equal(avatarEmoji('common_16'), 'common_16');
});

test('deriveStats: empty profile → all zeros', () => {
  assert.deepEqual(deriveStats({}), {
    gamesPlayed: 0, gamesWon: 0, winRate: 0,
    highScore: 0, longestStreak: 0, currentStreak: 0,
  });
});

test('deriveStats: computes win rate', () => {
  const s = deriveStats({ stats: { gamesPlayed: 10, gamesWon: 7 } });
  assert.equal(s.winRate, 70);
});

test('PROFILE_RENDER paints avatar/name/stats and toggles upgrade button', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountProfileScreen({ root, bus });
  bus.emit(PROFILE_RENDER, {
    profile: { displayName: 'נחום', equippedAvatar: 'dragon', stats: { gamesPlayed: 10, gamesWon: 4, highScore: 200 } },
    isAnonymous: true,
    email: 'me@example.com',
  });
  // 'dragon' is the veteran achievement reward → avatar renders as its trophy
  // icon (an <img>), not the legacy 🐉 emoji.
  assert.match(els.avatar.innerHTML ?? '', /images\/icons\/acheivements\//);
  assert.equal(els.name.textContent,   'נחום');
  assert.equal(els.played.textContent, '10');
  assert.equal(els.wins.textContent,   '4');
  assert.equal(els.winrate.textContent,'40%');
  assert.equal(els.high.textContent,   '200');
  assert.equal(els.email.textContent,  'me@example.com');
  assert.equal(els.upgrade.style.display, '');
});

test('non-anonymous user hides upgrade button', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountProfileScreen({ root, bus });
  bus.emit(PROFILE_RENDER, { profile: { displayName: 'X' }, isAnonymous: false });
  assert.equal(els.upgrade.style.display, 'none');
});

test('PROFILE_RENDER clears stale email when no email is supplied', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountProfileScreen({ root, bus });
  bus.emit(PROFILE_RENDER, { profile: { displayName: 'Signed in' }, email: 'me@example.com' });
  bus.emit(PROFILE_RENDER, { profile: { displayName: 'Guest' }, isAnonymous: true });
  assert.equal(els.email.textContent, '');
});

test('clicking name emits EDIT_NAME and shows the edit input', () => {
  bus._reset();
  const { root, els } = makeDom();
  els.name.textContent = 'נחום';
  let fired = 0;
  bus.on(PROFILE_INTENT.EDIT_NAME, () => { fired++; });
  mountProfileScreen({ root, bus });
  els.name.fireClick();
  assert.equal(fired, 1);
  assert.equal(els.editWrap.style.display, '');
  assert.equal(els.nameInp.value, 'נחום');
});

test('save / cancel / store / friends / stats / logout / back all emit intents', () => {
  bus._reset();
  const { root, els } = makeDom();
  const got = [];
  bus.on(PROFILE_INTENT.SAVE_NAME,        () => got.push('save'));
  bus.on(PROFILE_INTENT.CANCEL_EDIT_NAME, () => got.push('cancel'));
  // The avatar ring now opens the store (not the achievements gallery).
  bus.on(PROFILE_INTENT.OPEN_STORE,       () => got.push('store'));
  bus.on(PROFILE_INTENT.OPEN_FRIENDS,     () => got.push('friends'));
  bus.on(PROFILE_INTENT.OPEN_STATS,       () => got.push('stats'));
  bus.on(PROFILE_INTENT.LOGOUT,           () => got.push('logout'));
  bus.on(PROFILE_INTENT.BACK,             () => got.push('back'));
  bus.on(PROFILE_INTENT.UPGRADE_ACCOUNT,  () => got.push('upgrade'));
  mountProfileScreen({ root, bus });
  els.saveBtn.fireClick();
  els.cancelBtn.fireClick();
  els.avatarBtn.fireClick();
  els.friendsBtn.fireClick();
  els.statsBtn.fireClick();
  els.logoutBtn.fireClick();
  els.backBtn.fireClick();
  els.upgrade.fireClick();
  assert.deepEqual(got, ['save','cancel','store','friends','stats','logout','back','upgrade']);
});

test('showError paints the error label', () => {
  bus._reset();
  const { root, els } = makeDom();
  const screen = mountProfileScreen({ root, bus });
  screen.showError('שם תפוס');
  assert.equal(els.nameErr.textContent, 'שם תפוס');
  screen.showError('');
  assert.equal(els.nameErr.textContent, '');
});

test('throws if bus missing', () => {
  assert.throws(() => mountProfileScreen({}), /bus required/);
});
