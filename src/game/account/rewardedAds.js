// rewardedAds — "watch a video, get coins" (AdMob), Android app only. The web page can't
// run the native ads SDK, so it opens the app's RewardedAdActivity through an intent
// link; that screen plays the ad with the player's uid for AdMob's server-side
// verification. The coins are credited by the worker (worker/src/admobSsv.js) when
// AdMob's signed callback arrives, never by the page: the profile watch shows them.
//
// An app built before ads existed has no handler for the link, so nothing happens. If
// the page is still visible and focused a moment after the tap, watch() reports
// 'not-handled' and the store asks the player to update the app. The ad screen is
// translucent while the ad loads, so the page can stay "visible" under it: losing focus
// to it counts as opened too.

export const AD_INTENT_SCHEME = 'boost-ad';
export const HANDOFF_MS = 2500;   // how long the ad screen may take to cover the page

// No package in the link: debug builds (app id + '.debug') answer it too.
export function rewardedAdIntentUrl(uid) {
  return `intent://reward?uid=${encodeURIComponent(uid)}#Intent;scheme=${AD_INTENT_SCHEME};end`;
}

// win: the window (injectable for tests). inApp: async () => boolean — true inside the
// Android app (main.js passes "the Play Billing service exists").
export function createRewardedAds({ win = globalThis, inApp = async () => false, handoffMs = HANDOFF_MS } = {}) {
  let busy = false;

  // → 'opened' | 'not-handled' | 'unavailable' | 'busy'
  async function watch(uid) {
    if (!uid || !(await inApp())) return 'unavailable';
    if (busy) return 'busy';
    busy = true;
    const doc = win.document;
    try {
      return await new Promise((resolve) => {
        let timer = 0;
        const onHidden = () => {
          if (doc?.visibilityState !== 'hidden') return;
          win.clearTimeout(timer);
          doc.removeEventListener?.('visibilitychange', onHidden);
          resolve('opened');
        };
        doc?.addEventListener?.('visibilitychange', onHidden);
        timer = win.setTimeout(() => {
          doc?.removeEventListener?.('visibilitychange', onHidden);
          resolve(doc?.hasFocus?.() === false ? 'opened' : 'not-handled');
        }, handoffMs);
        win.location.href = rewardedAdIntentUrl(uid);
      });
    } finally {
      busy = false;
    }
  }

  return { watch, isAvailable: () => inApp() };
}
