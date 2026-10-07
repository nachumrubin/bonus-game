// boostieSources — which 3D model an avatar value plays, and which clip each game
// moment uses. Pure (no three.js, no DOM), so the game screen can decide whether a slot
// goes live without loading the 3D code.

import { parseBoostieAvatar, boostieModelSrc } from '../../game/account/boostieCatalog.js';
import { botModelSrc } from '../screens/avatarScreens.js';

// .glb for an avatar value ('zapi:4', 'zapi', { id, level }, 'bot_hard'), or null when
// the avatar has no model (emoji, the generic 'bot', old store ids) and stays a still.
export function modelSrcForAvatar(value) {
  if (typeof value === 'string') {
    const bot = botModelSrc(value);
    if (bot) return bot;
  }
  const b = parseBoostieAvatar(value);
  return b ? boostieModelSrc(b.id, b.level) : null;
}

// Game moments the scoreboard plays on its own (D-boostie-reactions: expressive clips
// such as laugh / wow are player-chosen and never auto-triggered).
export const GAME_CLIPS = Object.freeze({ turn: 'turn', good: 'good', boost: 'boost' });

// Clips that key the lids themselves; the live lid controller stands back while they play.
export const CLIPS_WITH_LIDS = Object.freeze(['wink']);

// Bot screen faces (build_boostie.py SCREEN_EXPRS). glTF node 'face.rest' loads as
// 'facerest' (three.js strips the dot).
export const SCREEN_FACES = Object.freeze(['rest', 'blink', 'happy', 'laugh', 'wow', 'stare', 'yawn', 'wink']);
export const FACE_HIDE = 0.001;

// Frame-time budget for live 3D: when the median of the first measured frames is slower
// than this, the scoreboard gives up and shows the stills (weak phones).
export const SLOW_FRAME_MS = 45;
export const SLOW_SAMPLE = 30;

export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// True once enough frames were measured and they are too slow for live 3D.
export function isTooSlow(frameMs, budget = SLOW_FRAME_MS, sample = SLOW_SAMPLE) {
  return frameMs.length >= sample && median(frameMs.slice(-sample)) > budget;
}
