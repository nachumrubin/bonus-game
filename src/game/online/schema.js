// Schema constants + shape helpers for the new room/invite/queue paths.
//
// Stored room shape (see plan §4.2):
//   {
//     roomId, mode, status, schemaVersion: 2, createdAt, updatedAt,
//     players: { 0: {...}, 1: {...} },
//     version, tileBagSeed, bag, currentTurnSlot, turnNumber, turnDeadlineMs,
//     missedTurns, scores, racks, board, bonusBoard, lastMove, moveHistory, activeBoosts,
//     lockedCells, lockInventory, bonusAssignment, bonusSqUsed, pendingBonuses,
//     ready, settings, livePreview,
//   }
//
// Field names live here so callers don't sprinkle string literals through
// the codebase — a future rename is one change.

export const PATH = Object.freeze({
  rooms:              'rooms',
  invites:            'invites',
  inviteAcks:         'inviteAcks',
  users:              'users',
  presence:           'presence',
  matchmakingQueue:   'matchmakingQueue',
  usernames:          'usernames',
  // Per-user async-room index — flat map { roomId: { mode, createdAt } }.
  // Written by roomService.createRoom for async modes only; read by
  // asyncSessionService.listAsyncSessions; cleared by setStatus on
  // completed/abandoned/expired transitions.
  usersAsyncRooms:    'asyncRooms',
});

export const FIELD = Object.freeze({
  schemaVersion:      'schemaVersion',
  version:            'version',
  status:             'status',
  mode:               'mode',
  players:            'players',
  tileBagSeed:        'tileBagSeed',
  bag:                'bag',
  currentTurnSlot:    'currentTurnSlot',
  turnNumber:         'turnNumber',
  turnDeadlineMs:     'turnDeadlineMs',
  missedTurns:        'missedTurns',
  scores:             'scores',
  racks:              'racks',
  board:              'board',
  bonusBoard:         'bonusBoard',
  moveHistory:        'moveHistory',
  activeBoosts:       'activeBoosts',
  lockedCells:        'lockedCells',
  lockInventory:      'lockInventory',
  bonusAssignment:    'bonusAssignment',
  bonusSqUsed:        'bonusSqUsed',
  pendingBonuses:     'pendingBonuses',
  ready:              'ready',
  settings:           'settings',
  livePreview:        'livePreview',
  liveBonus:          'liveBonus',
  liveReaction:       'liveReaction',
});

export const STATUS = Object.freeze({
  WAITING:    'waiting',
  PLAYING:    'playing',
  COMPLETED:  'completed',
  ABANDONED:  'abandoned',
  EXPIRED:    'expired',
});

export const INVITE_STATUS = Object.freeze({
  PENDING:    'pending',
  ACCEPTED:   'accepted',
  REJECTED:   'rejected',
  EXPIRED:    'expired',
  CANCELLED:  'cancelled',
});

// Build a fresh new-shape room document. The engine state (board/racks/etc.)
// is added by roomService.createRoom from the engine's createInitialState
// output; this helper wraps the metadata around it.
export function buildRoomDoc({ roomId, mode, players, settings = {}, engineState, createdAt }) {
  return {
    roomId,
    mode,
    status: STATUS.WAITING,
    schemaVersion: 2,
    createdAt,
    updatedAt: createdAt,
    players,
    version: 1,
    tileBagSeed: engineState.tileBagSeed,
    bag: [...(engineState.bag ?? [])],
    currentTurnSlot: engineState.currentTurnSlot,
    turnNumber: engineState.turnNumber,
    turnDeadlineMs: null,
    missedTurns: { 0: 0, 1: 0 },
    scores: engineState.scores,
    racks: engineState.racks,
    board: serializeBoard(engineState.board),
    bonusBoard: serializeBonusBoard(engineState.bonusBoard),
    moveHistory: [],
    activeBoosts: [],
    lockedCells: normalizeLockedCells(engineState.lockedCells),
    lockInventory: normalizeLockInventory(engineState.lockInventory),
    bonusAssignment: normalizeBonusAssignment(engineState.bonusAssignment),
    bonusSqUsed: normalizeBonusSqUsed(engineState.bonusSqUsed),
    pendingBonuses: normalizePendingBonuses(engineState.pendingBonuses),
    ready: { 0: false, 1: false },
    settings,
    livePreview: null,
  };
}

export function normalizeLockInventory(lockInventory) {
  return {
    0: Array.isArray(lockInventory?.[0]) ? lockInventory[0].map(Number).filter(n => Number.isInteger(n) && n > 0) : [3, 3, 5],
    1: Array.isArray(lockInventory?.[1]) ? lockInventory[1].map(Number).filter(n => Number.isInteger(n) && n > 0) : [3, 3, 5],
  };
}

export function normalizeBonusAssignment(bonusAssignment) {
  return Array.isArray(bonusAssignment) ? bonusAssignment.map(entry => {
    if (!entry || typeof entry !== 'object') return entry;
    return { ...entry };
  }) : [];
}

export function normalizeBonusSqUsed(bonusSqUsed) {
  const out = {};
  for (const [key, value] of Object.entries(bonusSqUsed ?? {})) {
    out[key] = !!value;
  }
  return out;
}

export function normalizePendingBonuses(pendingBonuses) {
  return Array.isArray(pendingBonuses) ? pendingBonuses.map(entry => ({ ...(entry ?? {}) })) : [];
}

export function normalizeLockedCells(lockedCells) {
  if (!Array.isArray(lockedCells)) return [];
  return lockedCells.map(lock => ({
    id: String(lock.id ?? `${lock.ownerSlot ?? 0}:${lock.r}:${lock.c}:${lock.remainingTurns}`),
    r: Number(lock.r),
    c: Number(lock.c),
    ownerSlot: lock.ownerSlot === 1 ? 1 : 0,
    remainingTurns: Number(lock.remainingTurns ?? 0),
  })).filter(lock =>
    Number.isInteger(lock.r) &&
    Number.isInteger(lock.c) &&
    Number.isInteger(lock.remainingTurns) &&
    lock.remainingTurns > 0
  );
}

// 2D 10x10 board → flat 100-cell array for Firebase. Empty cells become null.
export function serializeBoard(board2d) {
  const flat = new Array(100).fill(null);
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const t = board2d[r][c];
      if (t) flat[r * 10 + c] = { letter: t.letter, val: t.val, isJoker: !!t.isJoker };
    }
  }
  return flat;
}

export function deserializeBoard(flat) {
  const board = Array.from({ length: 10 }, () => Array(10).fill(null));
  if (!flat) return board;
  for (let i = 0; i < 100; i++) {
    const t = flat[i];
    if (t) board[Math.floor(i / 10)][i % 10] = t;
  }
  return board;
}

export function serializeBonusBoard(bonusBoard) {
  if (bonusBoard instanceof Map) return Object.fromEntries(bonusBoard.entries());
  return { ...(bonusBoard ?? {}) };
}

export function deserializeBonusBoard(value) {
  return new Map(Object.entries(value ?? {}));
}
