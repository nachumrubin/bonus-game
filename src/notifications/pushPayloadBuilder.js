// Pure transforms: bus event → OneSignal REST API request body.
//
// Centralised so push triggers don't sprinkle string copy ("הוזמנת למשחק!" / "תורך בבוסט!")
// across the codebase — adding a new notification kind is one change here.
// Pure means tests don't need a network or OneSignal SDK; we just diff the JSON.
//
// Output shape mirrors the legacy `_send*Notification` calls at index.html:8463-8530.

export const KIND = Object.freeze({
  INVITE:           'invite',
  INVITE_ACCEPTED:  'invite_accepted',
  INVITE_REJECTED:  'invite_rejected',
  TURN:             'turn',
  REMINDER:         'reminder',
  COMPLETED:        'completed',
  EXPIRED:          'expired',
  FRIEND_REQUEST:   'friendRequest',
  FRIEND_ACCEPTED:  'friendAccepted',
});

const TITLES = {
  [KIND.INVITE]:           'הוזמנת למשחק! 🎮',
  [KIND.INVITE_ACCEPTED]:  'ההזמנה התקבלה! 🎮',
  [KIND.INVITE_REJECTED]:  'ההזמנה נדחתה',
  [KIND.TURN]:             'תורך בבוסט!',
  [KIND.REMINDER]:         'תזכורת — תורך מחכה',
  [KIND.COMPLETED]:        'המשחק הסתיים',
  [KIND.EXPIRED]:          'המשחק פג תוקף',
  [KIND.FRIEND_REQUEST]:   'בקשת חברות! 👥',
  [KIND.FRIEND_ACCEPTED]:  'בקשת החברות אושרה! 🤝',
};

function defaultBody(kind, ctx) {
  switch (kind) {
    case KIND.INVITE:           return `${ctx.inviterName ?? 'שחקן'} מזמין אותך למשחק`;
    case KIND.INVITE_ACCEPTED:  return `${ctx.opponentName ?? 'יריב'} קיבל את ההזמנה`;
    case KIND.INVITE_REJECTED:  return `${ctx.opponentName ?? 'יריב'} דחה את ההזמנה`;
    case KIND.TURN:             return `${ctx.opponentName ?? 'היריב'} סיים מהלך. עכשיו תורך.`;
    case KIND.REMINDER:         return ctx.gender === 'נקבה'
      ? `את לא משחקת כבר ${ctx.hoursIdle ?? 24} שעות`
      : `אתה לא משחק כבר ${ctx.hoursIdle ?? 24} שעות`;
    case KIND.COMPLETED:        return ctx.didWin ? 'ניצחת! 🏆' : 'המשחק הסתיים';
    case KIND.EXPIRED:          return 'המשחק פג תוקף עקב חוסר פעילות';
    case KIND.FRIEND_REQUEST:   return `${ctx.fromName ?? 'משתמש'} שלח לך בקשת חברות`;
    case KIND.FRIEND_ACCEPTED:  return `${ctx.fromName ?? 'משתמש'} קיבל את בקשת החברות שלך`;
    default: return '';
  }
}

// Build a OneSignal REST request body. Caller picks the targeting mode:
//   - { subscriptionIds: [id] }  for room-tokens-based pushes
//   - { externalIds: [uid] }     for user-id-based pushes
//
// Either one is required. The output is the JSON body for POST
// https://onesignal.com/api/v1/notifications.
export function buildPushBody({ appId, kind, ctx = {}, subscriptionIds, externalIds, title, body, data }) {
  if (!appId) throw new Error('buildPushBody: appId required');
  if (!kind) throw new Error('buildPushBody: kind required');
  if (!subscriptionIds?.length && !externalIds?.length) {
    throw new Error('buildPushBody: subscriptionIds or externalIds required');
  }

  const out = {
    app_id: appId,
    headings: { en: title ?? TITLES[kind] ?? '' },
    contents: { en: body ?? defaultBody(kind, ctx) },
    data: { type: kind, ...ctx, ...(data ?? {}) },
  };
  if (subscriptionIds?.length) out.include_subscription_ids = subscriptionIds;
  if (externalIds?.length) {
    out.include_aliases = { external_id: externalIds };
    out.target_channel = 'push';
  }
  return out;
}
