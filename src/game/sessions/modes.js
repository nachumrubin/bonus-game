// Mode descriptor table (see plan §3.4). Centralizes behavior by mode.

export const MODES = {
  'offline-solo':  { online: false, hasTurnTimer: 'optional', pushOnMove: false,            presenceCritical: false, expiry: null },
  'offline-2p':    { online: false, hasTurnTimer: 'optional', pushOnMove: false,            presenceCritical: false, expiry: null },
  'tutorial':      { online: false, hasTurnTimer: false,      pushOnMove: false,            presenceCritical: false, expiry: null },
  'friend-live':   { online: true,  hasTurnTimer: true,       pushOnMove: 'ifBackgrounded', presenceCritical: true,  expiry: null },
  'friend-async':  { online: true,  hasTurnTimer: false,      pushOnMove: 'always',         presenceCritical: false, expiry: '7d' },
  'random-live':   { online: true,  hasTurnTimer: true,       pushOnMove: 'ifBackgrounded', presenceCritical: true,  expiry: null },
  'random-async':  { online: true,  hasTurnTimer: false,      pushOnMove: 'always',         presenceCritical: false, expiry: '7d' },
};

export function modeDescriptor(mode) {
  return MODES[mode] ?? MODES['offline-solo'];
}
