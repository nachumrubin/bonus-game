// COPY of ../src/notifications/pushPayloadBuilder.js
// Keep in sync if you edit either file. The worker rebuilds notification
// bodies server-side from this template so a malicious authenticated client
// can't inject arbitrary heading/contents text.

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

// Title can depend on ctx (e.g. invite live vs async); falls back to the
// static TITLES map for kinds whose heading never varies.
function defaultTitle(kind, ctx) {
  if (kind === KIND.INVITE) {
    return ctx.isLive ? 'הוזמנת למשחק חי! ⚡' : 'הוזמנת למשחק! 📩';
  }
  return TITLES[kind] ?? '';
}

// Game-over body — names the winner from the recipient's perspective and
// appends the final score (recipient's score first). Falls back to the bare
// "game ended" line when scores weren't supplied. Keep in sync with the
// client copy in src/notifications/pushPayloadBuilder.js.
function completedBody(ctx) {
  const haveScore = typeof ctx.myScore === 'number' && typeof ctx.opponentScore === 'number';
  const score = haveScore ? ` התוצאה הסופית: ${ctx.myScore}:${ctx.opponentScore}` : '';
  if (ctx.isDraw) return `תיקו!${score}`;
  if (ctx.didWin) return `ניצחת! 🏆${score}`;
  if (haveScore || ctx.opponentName) return `${ctx.opponentName ?? 'היריב'} ניצח/ה.${score}`;
  return 'המשחק הסתיים';
}

function defaultBody(kind, ctx) {
  switch (kind) {
    case KIND.INVITE:           return ctx.isLive
      ? `${ctx.inviterName ?? 'שחקן'} מזמין אותך למשחק עכשיו`
      : `${ctx.inviterName ?? 'שחקן'} מזמין אותך למשחק תורות`;
    case KIND.INVITE_ACCEPTED:  return `${ctx.opponentName ?? 'יריב'} קיבל את ההזמנה`;
    case KIND.INVITE_REJECTED:  return `${ctx.opponentName ?? 'יריב'} דחה את ההזמנה`;
    case KIND.TURN:             return `${ctx.opponentName ?? 'היריב'} סיים מהלך. עכשיו תורך.`;
    case KIND.REMINDER:         return `אתה לא משחק כבר ${ctx.hoursIdle ?? 24} שעות`;
    case KIND.COMPLETED:        return completedBody(ctx);
    case KIND.EXPIRED:          return 'המשחק פג תוקף עקב חוסר פעילות';
    case KIND.FRIEND_REQUEST:   return `${ctx.fromName ?? 'משתמש'} שלח לך בקשת חברות`;
    case KIND.FRIEND_ACCEPTED:  return `${ctx.fromName ?? 'משתמש'} קיבל את בקשת החברות שלך`;
    default: return '';
  }
}

export function buildPushBody({ appId, kind, ctx = {}, subscriptionIds, externalIds, title, body, data }) {
  if (!appId) throw new Error('buildPushBody: appId required');
  if (!kind) throw new Error('buildPushBody: kind required');
  if (!subscriptionIds?.length && !externalIds?.length) {
    throw new Error('buildPushBody: subscriptionIds or externalIds required');
  }

  const out = {
    app_id: appId,
    headings: { en: title ?? defaultTitle(kind, ctx) },
    contents: { en: body ?? defaultBody(kind, ctx) },
    data: { type: kind, ...ctx, ...(data ?? {}) },
    // High delivery priority — tells FCM/the push service to wake the device
    // and present immediately (heads-up) rather than delivering quietly/
    // batched. Without this, Android often shows the push silently (vibrate
    // only, no screen wake or slide-down).
    priority: 10,
  };
  if (subscriptionIds?.length) out.include_subscription_ids = subscriptionIds;
  if (externalIds?.length) {
    out.include_aliases = { external_id: externalIds };
    out.target_channel = 'push';
  }
  return out;
}
