// Browser Notification API fallback.
//
// Legacy `_showBrowserOnlyNotification` (HEAD:index.html:9063) used the
// browser Notification API as a same-device fallback when OneSignal wasn't
// loaded or the user's tab was hidden. Legacy also routed onclick into the
// right screen via `_handleBrowserNotificationClick` (line 9052): roomCode
// + type → join overlay / room resume / friends.
//
// The spine relied entirely on OneSignal until now; this module restores
// the legacy fallback so users on browsers without push (or where the
// OneSignal SDK didn't bootstrap) still get a notification.
//
// All the dom/api surface is injected so this stays unit-testable.

export const NOTIF_KIND = Object.freeze({
  INVITE: 'invite',
  TURN: 'turn',
  FRIEND_REQUEST: 'friendRequest',
  FRIEND_ACCEPTED: 'friendAccepted',
  EXPIRED: 'expired',
  COMPLETED: 'completed',
});

export function isBrowserNotificationSupported(win = globalThis) {
  return typeof win?.Notification === 'function';
}

export function getPermission(win = globalThis) {
  if (!isBrowserNotificationSupported(win)) return 'unsupported';
  return win.Notification.permission ?? 'default';
}

// Whether we should fire a browser notification right now: support + granted
// + (tab hidden OR caller explicitly opted in via `force`). Hidden-only is
// the legacy gate — if the user is actively looking at the tab, the in-app
// banner is enough.
export function shouldFire({
  win = globalThis,
  doc = globalThis.document,
  force = false,
} = {}) {
  if (!isBrowserNotificationSupported(win)) return false;
  if (getPermission(win) !== 'granted') return false;
  if (force) return true;
  const visibility = doc?.visibilityState ?? 'visible';
  return visibility === 'hidden';
}

// Map the legacy `data.type` to a spine route intent. Production wires
// these into either bus.emit(...) or the spine's service-worker postMessage
// router.
export function routeFor(data = {}) {
  if (data?.type === NOTIF_KIND.INVITE && data.roomCode) {
    return { target: 'OPEN_JOIN', roomCode: data.roomCode };
  }
  if (data?.type === NOTIF_KIND.TURN && data.roomCode) {
    return { target: 'OPEN_TURN', roomCode: data.roomCode };
  }
  if (data?.type === NOTIF_KIND.FRIEND_REQUEST || data?.type === NOTIF_KIND.FRIEND_ACCEPTED) {
    return { target: 'OPEN_FRIENDS' };
  }
  if (data?.type === NOTIF_KIND.COMPLETED && data.roomCode) {
    return { target: 'OPEN_GAME_SUMMARY', roomCode: data.roomCode };
  }
  return null;
}

/**
 * Fire a browser notification with sensible defaults and click routing.
 * Prefers ServiceWorkerRegistration.showNotification when available
 * (matches legacy preference at HEAD:index.html:9080), falls back to the
 * `new Notification(...)` constructor.
 *
 * @returns {Promise<{ shown: boolean, reason?: string, via?: 'sw' | 'constructor' }>}
 */
export async function showBrowserNotification({
  title,
  body = '',
  data = {},
  icon = './icon-512.png',
  badge = './icon-512.png',
  // Injected — production passes the actual window/doc/sw and a router fn.
  win = globalThis,
  doc = globalThis.document,
  swRegistration = null,         // promise OR registration with showNotification
  onClick = null,                // (route) => void
  force = false,
} = {}) {
  if (!shouldFire({ win, doc, force })) {
    return { shown: false, reason: 'precondition-failed' };
  }

  const options = {
    body,
    icon,
    badge,
    data,
    tag: data?.roomCode ? `bonus-${data.type ?? 'notice'}-${data.roomCode}` : `bonus-${data?.type ?? 'notice'}`,
    renotify: true,
  };

  // Try SW.showNotification first.
  if (swRegistration) {
    try {
      const reg = typeof swRegistration?.then === 'function' ? await swRegistration : swRegistration;
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        // SW notifications dispatch their click event through the SW
        // (notificationclick → postMessage → main thread). The spine's
        // serviceWorkerRouting.test.js already covers the receiver side, so
        // we just return here.
        return { shown: true, via: 'sw' };
      }
    } catch (e) {
      // Fall through to constructor fallback.
    }
  }

  try {
    const n = new win.Notification(title, options);
    if (typeof onClick === 'function') {
      n.onclick = () => {
        try { win.focus?.(); } catch { /* swallow */ }
        try { onClick(routeFor(data)); } catch (e) { console.warn('[browserNotif.onclick]', e); }
        try { n.close?.(); } catch { /* swallow */ }
      };
    }
    return { shown: true, via: 'constructor' };
  } catch (e) {
    return { shown: false, reason: 'construct-failed' };
  }
}
