// localSaveService — persists an in-progress offline game (offline-2p /
// offline-solo vs bot) to localStorage so the player can resume after
// returning to the menu. Online games are persisted by sessionPersistence;
// this module is the offline counterpart.
//
// The saved payload is the full engine state plus the metadata needed to
// rebuild the session shell (bot flag + difficulty + display names).
// state.bonusBoard is a Map and is converted to/from a plain object when
// crossing the JSON boundary.

export const LOCAL_SAVED_GAME_KEY = 'spine.localSavedGame';
export const LOCAL_SAVED_GAME_VERSION = 1;

function serializeBonusBoard(bonusBoard) {
  if (!bonusBoard) return {};
  if (bonusBoard instanceof Map) return Object.fromEntries(bonusBoard.entries());
  if (typeof bonusBoard === 'object') return { ...bonusBoard };
  return {};
}

function deserializeBonusBoard(raw) {
  if (raw && typeof raw === 'object') return new Map(Object.entries(raw));
  return new Map();
}

function serializeState(state) {
  if (!state) return null;
  return { ...state, bonusBoard: serializeBonusBoard(state.bonusBoard) };
}

function deserializeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return { ...raw, bonusBoard: deserializeBonusBoard(raw.bonusBoard) };
}

export function saveLocalGame(storage, payload = {}, now = Date.now()) {
  if (!storage) return false;
  const state = payload.state;
  if (!state || state.status !== 'playing') return false;
  // turnDeadlineMs is an absolute timestamp at runtime. Storing it raw to
  // localStorage means the saved snapshot goes stale the moment the user
  // walks away — on reload, (deadline - now) is negative or much smaller
  // than the remaining time the player paused on. We convert to REMAINING
  // ms on save and re-anchor on load so the saved clock survives any wait.
  const stateForSave = { ...state };
  const deadline = Number(stateForSave.turnDeadlineMs) || 0;
  if (deadline > 0) {
    stateForSave.turnDeadlineMs = Math.max(0, deadline - now);
  }
  const record = {
    version: LOCAL_SAVED_GAME_VERSION,
    savedAt: now,
    mode: payload.mode ?? state.mode ?? 'offline-2p',
    bot: !!payload.bot,
    difficulty: Number.isFinite(payload.difficulty) ? Number(payload.difficulty) : 1,
    state: serializeState(stateForSave),
  };
  try {
    storage.setItem(LOCAL_SAVED_GAME_KEY, JSON.stringify(record));
    return true;
  } catch (e) {
    console.warn('[localSaveService] save failed', e);
    return false;
  }
}

export function loadLocalGame(storage, now = Date.now()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LOCAL_SAVED_GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== LOCAL_SAVED_GAME_VERSION) return null;
    const state = deserializeState(parsed.state);
    if (!state || state.schemaVersion !== 2 || state.status !== 'playing') return null;
    // While serialised, turnDeadlineMs holds REMAINING ms (see saveLocalGame).
    // Re-anchor to an absolute timestamp anchored at `now` so the engine and
    // the turn-timer controller see the same value type they always do.
    const remaining = Number(state.turnDeadlineMs) || 0;
    if (remaining > 0) state.turnDeadlineMs = now + remaining;
    return {
      version: parsed.version,
      savedAt: Number(parsed.savedAt) || 0,
      mode: parsed.mode ?? state.mode ?? 'offline-2p',
      bot: !!parsed.bot,
      difficulty: Number.isFinite(parsed.difficulty) ? Number(parsed.difficulty) : 1,
      state,
    };
  } catch (e) {
    console.warn('[localSaveService] load failed', e);
    return null;
  }
}

export function clearLocalGame(storage) {
  if (!storage) return;
  try { storage.removeItem(LOCAL_SAVED_GAME_KEY); }
  catch (e) { console.warn('[localSaveService] clear failed', e); }
}

export function hasLocalSavedGame(storage) {
  return loadLocalGame(storage) != null;
}
