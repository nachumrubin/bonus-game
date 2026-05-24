// Bonus tile types — shuffled and assigned to bonus square slots each game.
// Ported verbatim from index.html:3164.
// Each entry's `type` matches a boost id (B1-B13). The plugin objects in
// sibling files (doubleScore.js, extraTurn.js, ...) define the actual
// behavior — this file is data only.

export const BONUS_TYPES = [
  { type: 'B1',  pts: 100, ic: '⚡' },
  { type: 'B1',  pts: 100, ic: '⚡' },
  { type: 'B2',  pts: 40,  ic: '⚡' },
  { type: 'B2',  pts: 40,  ic: '⚡' },
  { type: 'B3',  pts: 40,  ic: '⚡' },
  { type: 'B4',  pts: 1,   ic: '⚡' },
  { type: 'B5',  pts: 0,   ic: '⚡' },
  { type: 'B6',  pts: 0,   ic: '⚡' },
  { type: 'B7',  pts: 0,   ic: '⚡' },
  { type: 'B8',  pts: 0,   ic: '⚡' },
  { type: 'B9',  pts: 25,  ic: '⚡' },
  { type: 'B10', pts: 40,  ic: '⚡' },
  { type: 'B11', pts: 100, ic: '⚡' },
  { type: 'B12', pts: 50,  ic: '⚡' },
  { type: 'B13', pts: 0,   ic: '⚡' },
];

// Bonus square positions (index.html:3148). Each entry says which side of the
// 10x10 board the slot is on, plus its row/col offset (negative or 10 for
// off-board positions). `bonusAssignment[idx]` is filled in at game start by
// shuffling BONUS_TYPES into these slots.
export const BDEFS = [
  { side: 'top',    br: -1, bc: 1 },
  { side: 'top',    br: -1, bc: 5 },
  { side: 'top',    br: -1, bc: 8 },
  { side: 'bottom', br: 10, bc: 2 },
  { side: 'bottom', br: 10, bc: 5 },
  { side: 'bottom', br: 10, bc: 7 },
  { side: 'left',   br: 1,  bc: -1 },
  { side: 'left',   br: 4,  bc: -1 },
  { side: 'left',   br: 7,  bc: -1 },
  { side: 'right',  br: 2,  bc: 10 },
  { side: 'right',  br: 5,  bc: 10 },
  { side: 'right',  br: 8,  bc: 10 },
];
