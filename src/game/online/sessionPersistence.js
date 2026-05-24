export const ACTIVE_ONLINE_SESSION_KEY = 'spine.activeOnlineSession';

export function saveActiveOnlineSession(storage, { roomId, userId } = {}) {
  if (!storage || !roomId || !userId) return false;
  storage.setItem(ACTIVE_ONLINE_SESSION_KEY, JSON.stringify({ roomId, userId }));
  return true;
}

export function readActiveOnlineSession(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ACTIVE_ONLINE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.roomId || !parsed?.userId) return null;
    return { roomId: String(parsed.roomId), userId: String(parsed.userId) };
  } catch {
    return null;
  }
}

export function clearActiveOnlineSession(storage) {
  if (!storage) return;
  storage.removeItem(ACTIVE_ONLINE_SESSION_KEY);
}
