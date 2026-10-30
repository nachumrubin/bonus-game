import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRewardedAds, rewardedAdIntentUrl } from './rewardedAds.js';

function fakeWin() {
  const listeners = new Set();
  const win = {
    location: { href: 'https://boost-8ef11.web.app/' },
    document: {
      visibilityState: 'visible',
      addEventListener: (t, fn) => { if (t === 'visibilitychange') listeners.add(fn); },
      removeEventListener: (t, fn) => listeners.delete(fn),
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    hide() { win.document.visibilityState = 'hidden'; for (const fn of [...listeners]) fn(); },
    listeners,
  };
  return win;
}

test('rewardedAdIntentUrl: the app\'s boost-ad scheme, uid encoded, no package (debug builds too)', () => {
  assert.equal(rewardedAdIntentUrl('a b'), 'intent://reward?uid=a%20b#Intent;scheme=boost-ad;end');
});

test('watch: opens the ad screen and resolves once the page is covered', async () => {
  const win = fakeWin();
  const ads = createRewardedAds({ win, inApp: async () => true, handoffMs: 1000 });
  const p = ads.watch('uid123');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(win.location.href, rewardedAdIntentUrl('uid123'));
  assert.equal(await ads.watch('uid123'), 'busy', 'a second tap while handing off is ignored');
  win.hide();
  assert.equal(await p, 'opened');
  assert.equal(win.listeners.size, 0);
});

test('watch: an old app that ignores the link → not-handled; outside the app → unavailable', async () => {
  const win = fakeWin();
  assert.equal(await createRewardedAds({ win, inApp: async () => true, handoffMs: 10 }).watch('uid123'), 'not-handled');
  assert.equal(win.listeners.size, 0);
  const web = fakeWin();
  assert.equal(await createRewardedAds({ win: web }).watch('uid123'), 'unavailable');
  assert.equal(web.location.href, 'https://boost-8ef11.web.app/');
  assert.equal(await createRewardedAds({ win, inApp: async () => true }).watch(''), 'unavailable');
});

test('watch: the translucent ad screen still loading (page visible but unfocused) → opened', async () => {
  const win = fakeWin();
  win.document.hasFocus = () => false;
  assert.equal(await createRewardedAds({ win, inApp: async () => true, handoffMs: 10 }).watch('uid123'), 'opened');
  assert.equal(win.listeners.size, 0);
});
