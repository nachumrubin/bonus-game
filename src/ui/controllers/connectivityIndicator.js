// Real-time connectivity indicator (wifi icon in the game-screen top bar).
//
// Subscribes to NET_STATUS_CHANGED from connectivityService and toggles the
// #net-status element's classes: green when connected, red+blinking when
// the local WebSocket is down. Only shown during ONLINE games — offline
// solo / 2-player modes don't have a connectivity concern.
//
// Lifecycle: mounted once at app boot. Visibility is gated on the active
// game's mode. The controller listens for GAME_STARTED / GAME_COMPLETED
// to show/hide.

import { EV } from '../../events/eventTypes.js';
import { NET_STATUS_CHANGED } from '../../game/online/connectivityService.js';
import { modeDescriptor } from '../../game/sessions/modes.js';

export function createConnectivityIndicator({
  bus,
  doc = (typeof document !== 'undefined' ? document : null),
  elementId = 'net-status',
  sessionRef = () => null,
} = {}) {
  if (!bus) throw new Error('createConnectivityIndicator: bus required');

  const cleanups = [];
  let currentConnected = true;

  function el() {
    return doc ? doc.getElementById(elementId) : null;
  }

  function applyClass(node, connected) {
    if (!node) return;
    if (connected) {
      node.classList.remove('is-offline');
      node.classList.add('is-online');
      node.setAttribute('title', 'חיבור לאינטרנט תקין');
      node.setAttribute('aria-label', 'חיבור לאינטרנט תקין');
    } else {
      node.classList.remove('is-online');
      node.classList.add('is-offline');
      node.setAttribute('title', 'אין חיבור — מנסה להתחבר מחדש');
      node.setAttribute('aria-label', 'אין חיבור');
    }
  }

  function showFor(modeStr) {
    const node = el();
    if (!node) return;
    const desc = modeDescriptor(modeStr);
    if (desc?.online) {
      node.classList.add('is-visible');
      // Repaint connected state — the indicator may have been hidden during
      // a prior offline blip and the user should see the current truth.
      applyClass(node, currentConnected);
    } else {
      node.classList.remove('is-visible', 'is-online', 'is-offline');
    }
  }

  function hide() {
    const node = el();
    if (!node) return;
    node.classList.remove('is-visible', 'is-online', 'is-offline');
  }

  cleanups.push(bus.on(NET_STATUS_CHANGED, ({ connected }) => {
    currentConnected = !!connected;
    const node = el();
    if (node && node.classList.contains('is-visible')) {
      applyClass(node, currentConnected);
    }
  }));

  cleanups.push(bus.on(EV.GAME_STARTED, ({ mode } = {}) => {
    const session = sessionRef();
    showFor(mode ?? session?.state?.mode ?? session?.mode);
  }));

  cleanups.push(bus.on(EV.GAME_COMPLETED, () => {
    hide();
  }));

  function dispose() {
    for (const off of cleanups.splice(0)) {
      try { off(); } catch { /* swallow */ }
    }
    hide();
  }

  return { dispose, _hideForTests: hide };
}
