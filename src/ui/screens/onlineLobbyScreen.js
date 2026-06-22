// onlineLobbyScreen — Phase 1 migration of #so (online lobby).
//
// Replaces inline onclicks with bus-driven listeners.

import { $, on } from '../domHelpers.js';
import { registerOnboardingContent } from '../controllers/onboardingController.js';

export const LOBBY_INTENT = Object.freeze({
  CREATE_ROOM:   'lobby/createRoom',
  JOIN_BY_CODE:  'lobby/joinByCode',
  MATCHMAKING:   'lobby/matchmaking',
  BACK:          'lobby/back',
});

const BUTTONS = [
  { sel: 'button[onclick="onlineCreateRoom()"]', intent: LOBBY_INTENT.CREATE_ROOM },
  { sel: 'button[onclick="onlineJoinByCode()"]', intent: LOBBY_INTENT.JOIN_BY_CODE },
  { sel: 'button[onclick="onlineMatchmaking()"]', intent: LOBBY_INTENT.MATCHMAKING },
  { sel: 'button[onclick="goHome()"]',            intent: LOBBY_INTENT.BACK },
];

// ---------------------------------------------------------------------------
// Screen mount
// ---------------------------------------------------------------------------
export function mountOnlineLobbyScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountOnlineLobbyScreen: bus required');

  const lobby = $('#so', root);
  if (!lobby) {
    console.warn('[onlineLobbyScreen] #so not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];

  for (const def of BUTTONS) {
    const btn = $(def.sel, lobby);
    if (!btn) continue;
    btn.removeAttribute('onclick');
    cleanups.push(on(btn, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(def.intent, { source: 'onlineLobby' });
    }));
  }

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}

// Keep this in sync with online-lobby.html.
registerOnboardingContent('so', {
  icon: '🌐',
  title: 'משחק אונליין',
  bullets: [
    '🆕 פתח משחק חדש — בחר הגדרות ושלח קוד לחבר',
    '🔑 הצטרף לפי קוד — הזן קוד שקיבלת מחבר',
    '🎲 חפש יריב אקראי — התחבר לשחקן זמין',
  ],
});
