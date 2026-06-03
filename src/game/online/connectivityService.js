// Local-client connectivity monitor.
//
// Subscribes to Firebase RTDB's special `.info/connected` path which the
// SDK auto-maintains as `true` while the WebSocket to the server is alive
// and `false` while it is not. Each transition emits NET_STATUS_CHANGED
// on the bus so the UI (connectivityIndicator) can reflect it in real
// time — green wifi icon when good, red+blinking when bad.
//
// This is the LOCAL client's view of its own connectivity. It is distinct
// from /presence/{partnerUid} (which represents the OPPONENT's connection
// from the server's perspective) and from disconnectController (which
// surfaces the opponent's disconnect overlay).

export const NET_STATUS_CHANGED = 'evt/NET_STATUS_CHANGED';

/**
 * @param {{ db: any, bus: { emit(type: string, payload?: any): void }, now?: () => number }} options
 * @returns {{ stop(): void, current(): { connected: boolean, since: number } }}
 */
export function startConnectivityMonitor({ db, bus, now = () => Date.now() }) {
  if (!db || !bus) {
    return {
      stop() {},
      current() { return { connected: true, since: 0 }; },
    };
  }
  const ref = db.ref('.info/connected');
  // Default to "connected" until we hear otherwise — emitting "offline" at
  // boot before we've actually had a chance to connect would flash the
  // indicator red on every page load.
  let state = { connected: true, since: now() };
  const handler = (snap) => {
    const connected = snap?.val ? snap.val() === true : false;
    if (connected === state.connected) return; // dedupe
    state = { connected, since: now() };
    bus.emit(NET_STATUS_CHANGED, { ...state });
  };
  ref.on('value', handler);

  return {
    stop() {
      try { ref.off('value', handler); } catch { /* swallow */ }
    },
    current() { return { ...state }; },
  };
}
