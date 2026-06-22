// inviteFriends — drives the "invite contacts to Boost" flow from the friends
// screen's referral card (חבר מביא חבר).
//
// Strategy (chosen June 2026 — "Contacts API + fallback"):
//   1. Contact Picker API (navigator.contacts.select) where supported
//      (Android Chrome/Edge over HTTPS): the user picks real contacts in the
//      OS dialog; we then open an SMS draft pre-filled with the Play Store
//      link. The invite requires at least INVITE_REQUIRED contacts.
//   2. Fallback: Web Share API (navigator.share) — the OS share sheet. We
//      can't count recipients there, so a completed share counts as a full
//      invite batch (best-effort).
//   3. Last resort: copy the link to the clipboard.
//
// The "חבר מביא חבר" achievement is granted once the player invites
// INVITE_REQUIRED contacts (decoupled from real signups). The caller bumps the
// `invitesSent` profile stat by the returned `count`; the achievement engine
// (avatarScreens.js) unlocks the `ambassador` avatar at invitesSent >= 5.

// Replace with the real Play Store listing URL when the app is published.
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.boost.shavetzna';

export const INVITE_REQUIRED = 5;

export function buildInviteMessage(url = PLAY_STORE_URL) {
  return `בוא לשחק איתי בּוּסט! 🎯\n${url}`;
}

// sms: deep link. Android accepts comma-separated numbers and a ?body= query.
export function buildSmsHref(numbers = [], body = '') {
  const list = (numbers || []).filter(Boolean).join(',');
  const q = body ? `?body=${encodeURIComponent(body)}` : '';
  return `sms:${list}${q}`;
}

export function contactsSupported(nav = globalThis.navigator) {
  return !!(nav && nav.contacts && typeof nav.contacts.select === 'function');
}

export function shareSupported(nav = globalThis.navigator) {
  return !!(nav && typeof nav.share === 'function');
}

// Flatten a Contact Picker result into a list of phone numbers (first tel per
// contact). Contacts without a number are skipped.
export function extractNumbers(contacts = []) {
  const nums = [];
  for (const c of contacts || []) {
    const tels = Array.isArray(c?.tel) ? c.tel : [];
    if (tels.length) nums.push(String(tels[0]));
  }
  return nums;
}

// Orchestrate the invite. Returns one of:
//   { status: 'sent',        count }  — picked >= required, SMS draft opened
//   { status: 'too-few',     count }  — picked > 0 but < required, nothing sent
//   { status: 'shared',      count }  — fallback share sheet completed
//   { status: 'copied',      count }  — fallback clipboard copy
//   { status: 'cancelled',   count: 0 } — user dismissed the picker / share
//   { status: 'unsupported', count: 0 } — no channel available
//
// Dependencies are injected so the flow is unit-testable without a browser.
export async function runInviteFlow({
  nav = globalThis.navigator,
  open = (href) => { try { globalThis.location.href = href; } catch {} },
  url = PLAY_STORE_URL,
  required = INVITE_REQUIRED,
} = {}) {
  const message = buildInviteMessage(url);

  if (contactsSupported(nav)) {
    let contacts;
    try {
      contacts = await nav.contacts.select(['name', 'tel'], { multiple: true });
    } catch {
      return { status: 'cancelled', count: 0 };
    }
    const count = Array.isArray(contacts) ? contacts.length : 0;
    if (count === 0) return { status: 'cancelled', count: 0 };
    if (count < required) return { status: 'too-few', count };
    open(buildSmsHref(extractNumbers(contacts), message));
    return { status: 'sent', count };
  }

  if (shareSupported(nav)) {
    try {
      await nav.share({ title: 'בוסט', text: message, url });
      return { status: 'shared', count: required };
    } catch {
      return { status: 'cancelled', count: 0 };
    }
  }

  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(message);
      return { status: 'copied', count: required };
    }
  } catch { /* fall through */ }

  return { status: 'unsupported', count: 0 };
}
