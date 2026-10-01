// sfxCatalog — single source of truth for every sound-effect cue.
//
// Each entry:
//   tier       'micro' | 'ui' | 'event' | 'reward' | 'stinger' — sets
//              priority (micro cues are dropped under load) and preload order.
//   file       basename under assets/sfx/ (no extension), or null while the
//              cue is synth-only. With `variants: n` the files are
//              `<file>_1 … <file>_n` and one is picked at random per play.
//              Several cues may share a file (e.g. tile pick/place/return).
//   vol        playback gain for the sample (0–1).
//   rate       base playback rate (pitch + speed), default 1.
//   pitchJitter random ± playback-rate spread (e.g. 0.04) so a repeated
//              natural sound (tile on wood) never sounds identical twice.
//   throttleMs minimum gap between two plays of the same cue.
//   haptic     navigator.vibrate pattern, or null.
//   synth      WebAudio fallback: one tone or an array of tones (playTone
//              params). Used when the file is missing, still loading, or failed.
//
// Sound-design rules:
//   - Routine actions stay quiet, rare rewards may be louder
//     (BOOST_MOTION_SPEC §12).
//   - Anything physical gets a realistic recording that adds to the game
//     rather than distracting: wood tiles, cloth bag, coins, clock, padlock,
//     electricity, wheel ratchet, doorbell. Designed UI sounds only for
//     abstract moments.
// See docs/sound_inventory.md for every file's CC0 source.

export const TIERS = Object.freeze(['micro', 'ui', 'event', 'reward', 'stinger']);

const tone = (freq, dur, type = 'sine', gain = 0.12, slideTo = null, delay = 0) =>
  ({ freq, dur, type, gain, slideTo, delay });

export const SFX = Object.freeze({
  // ── Board play: real wooden tiles ────────────────────────
  'tile.pick': {
    tier: 'micro', file: 'tile_place', variants: 3, vol: 0.2, rate: 1.18, pitchJitter: 0.03, haptic: null, throttleMs: 40,
    synth: tone(260, 25, 'triangle', 0.04, 240),
  },
  'tile.place': {
    tier: 'micro', file: 'tile_place', variants: 3, pitchJitter: 0.03, vol: 0.45, haptic: null, throttleMs: 40,
    synth: tone(220, 35, 'triangle', 0.06, 180),
  },
  'tile.return': {
    tier: 'micro', file: 'tile_place', variants: 3, vol: 0.28, rate: 1.08, pitchJitter: 0.03, haptic: null, throttleMs: 40,
    synth: tone(240, 30, 'triangle', 0.05, 280),
  },
  'tile.recallAll': {
    tier: 'micro', file: 'tile_shuffle', vol: 0.32, rate: 1.1, haptic: null, throttleMs: 150,
    synth: tone(240, 60, 'triangle', 0.05, 300),
  },
  'tile.cascade': {
    tier: 'micro', file: 'tile_shuffle', vol: 0.25, pitchJitter: 0.04, haptic: null, throttleMs: 250,
    synth: tone(200, 60, 'triangle', 0.04, 260),
  },
  'opponent.tile': {
    tier: 'micro', file: 'tile_place', variants: 3, vol: 0.28, rate: 0.96, pitchJitter: 0.04, haptic: null, throttleMs: 40,
    synth: tone(200, 30, 'triangle', 0.04, 170),
  },
  'lock.place': {
    tier: 'event', file: 'lock_click', vol: 0.45, haptic: [15],
    synth: tone(520, 50, 'square', 0.06, 380),
  },
  'exchange.open': {
    tier: 'ui', file: 'bag_rustle', vol: 0.35, haptic: null, throttleMs: 300,
    synth: tone(180, 90, 'triangle', 0.04, 220),
  },
  'exchange.done': {
    tier: 'event', file: 'tile_shuffle', vol: 0.45, rate: 0.95, haptic: [20],
    synth: tone(200, 80, 'triangle', 0.06, 280),
  },

  // ── Move outcome + scoring ───────────────────────────────
  'move.invalid': {
    tier: 'event', file: 'move_invalid', vol: 0.4, haptic: [60],
    synth: tone(180, 140, 'square', 0.18, 120),
  },
  'move.accepted': {
    tier: 'event', file: 'move_accepted', vol: 0.45, haptic: null,
    synth: tone(360, 55, 'triangle', 0.07, 420),
  },
  'score.chip': {
    tier: 'micro', file: 'coin_single', vol: 0.28, haptic: null, throttleMs: 60,
    synth: tone(1320, 40, 'sine', 0.05),
  },
  'score.multiplier': {
    tier: 'event', file: 'boost_activate', vol: 0.3, rate: 1.25, haptic: [20],
    synth: tone(700, 90, 'sawtooth', 0.05, 1100),
  },
  'score.land': {
    tier: 'event', file: 'coins_collect', vol: 0.4, haptic: null, throttleMs: 200,
    synth: tone(990, 70, 'sine', 0.07, 1180),
  },
  'bingo': {
    tier: 'reward', file: 'bingo', vol: 0.6, haptic: [50, 40, 80],
    synth: [tone(659, 110, 'sine', 0.14), tone(784, 110, 'sine', 0.14, null, 110), tone(1047, 200, 'sine', 0.15, null, 220)],
  },
  'turn.yours': {
    tier: 'event', file: 'chime_turn', vol: 0.4, haptic: [30],
    synth: tone(523, 90, 'triangle', 0.12, 659),
  },
  'turn.extra': {
    tier: 'event', file: 'whoosh', vol: 0.4, rate: 1.1, haptic: [25],
    synth: tone(400, 160, 'sine', 0.08, 800),
  },
  'turn.skip': {
    tier: 'event', file: 'whoosh', vol: 0.35, rate: 0.8, haptic: [25],
    synth: tone(600, 160, 'sine', 0.07, 300),
  },

  // ── Turn timer: a real clock tick ────────────────────────
  'timer.warn': {
    tier: 'event', file: 'clock_tick', vol: 0.35, haptic: null,
    synth: tone(880, 50, 'sine', 0.08),
  },
  'timer.tick': {
    tier: 'event', file: 'clock_tick', vol: 0.5, haptic: [20], throttleMs: 300,
    synth: tone(880, 60, 'sine', 0.14),
  },
  'timer.timeout': {
    tier: 'event', file: 'move_invalid', vol: 0.45, rate: 0.85, haptic: [80],
    synth: tone(220, 220, 'triangle', 0.12, 140),
  },

  // ── Boosts: real electricity ─────────────────────────────
  'boost.activate': {
    tier: 'reward', file: 'boost_activate', vol: 0.55, haptic: [40, 30, 40], throttleMs: 300,
    synth: tone(660, 180, 'sine', 0.16, 990),
  },
  'boost.points': {
    tier: 'reward', file: 'coins_pile', vol: 0.5, haptic: [30], throttleMs: 300,
    synth: [tone(1320, 50, 'sine', 0.07), tone(1568, 70, 'sine', 0.07, null, 60)],
  },
  'boost.charge': {
    tier: 'reward', file: 'power_up', vol: 0.45, haptic: [30], throttleMs: 300,
    synth: tone(220, 300, 'sawtooth', 0.05, 660),
  },
  'boost.vetoed': {
    tier: 'event', file: 'short_circuit', vol: 0.5, haptic: [30, 30, 30],
    synth: tone(400, 200, 'sawtooth', 0.07, 90),
  },
  'boost.intro': {
    tier: 'event', file: 'whoosh', vol: 0.4, haptic: null, throttleMs: 300,
    synth: tone(300, 160, 'sine', 0.07, 700),
  },

  // ── Mini-games ───────────────────────────────────────────
  'mg.tap': {
    tier: 'micro', file: 'tile_place', variants: 3, vol: 0.3, rate: 1.05, pitchJitter: 0.04, haptic: null, throttleMs: 35,
    synth: tone(240, 30, 'triangle', 0.05, 200),
  },
  'mg.good': {
    tier: 'event', file: 'move_accepted', vol: 0.45, rate: 1.12, haptic: [20],
    synth: tone(660, 80, 'sine', 0.09, 880),
  },
  'mg.bad': {
    tier: 'event', file: 'move_invalid', vol: 0.35, haptic: [40],
    synth: tone(200, 120, 'square', 0.1, 140),
  },
  'mg.tick': {
    tier: 'event', file: 'clock_tick', vol: 0.4, haptic: null, throttleMs: 400,
    synth: tone(880, 50, 'sine', 0.08),
  },
  'mg.success': {
    tier: 'stinger', file: 'mg_success', vol: 0.6, haptic: [60, 40, 90], throttleMs: 1000,
    synth: [tone(523, 110, 'sine', 0.15), tone(659, 110, 'sine', 0.15, null, 110), tone(784, 220, 'sine', 0.16, null, 220)],
  },
  'mg.fail': {
    tier: 'stinger', file: 'mg_fail', vol: 0.45, haptic: [45], throttleMs: 1000,
    synth: [tone(392, 120, 'triangle', 0.09), tone(311, 200, 'triangle', 0.08, null, 120)],
  },
  'mg.count': {
    tier: 'micro', file: 'coin_single', vol: 0.18, pitchJitter: 0.05, haptic: null, throttleMs: 80,
    synth: tone(1500, 25, 'sine', 0.03),
  },
  'spinner.tick': {
    tier: 'micro', file: 'tile_place', variants: 3, vol: 0.14, rate: 1.35, pitchJitter: 0.04, haptic: null, throttleMs: 50,
    synth: tone(500, 15, 'triangle', 0.03),
  },
  'spinner.stop': {
    tier: 'event', file: 'tile_place', variants: 3, vol: 0.5, rate: 0.95, haptic: [25],
    synth: tone(220, 50, 'triangle', 0.08, 180),
  },
  'wheel.click': {
    tier: 'micro', file: 'wheel_click', vol: 0.45, pitchJitter: 0.03, haptic: null, throttleMs: 25,
    synth: tone(1800, 12, 'square', 0.03),
  },

  // ── Game lifecycle ───────────────────────────────────────
  'coin.flip': {
    tier: 'event', file: 'coin_flip', vol: 0.55, haptic: null, throttleMs: 1000,
    synth: tone(1500, 300, 'sine', 0.06, 1200),
  },
  'vs.intro': {
    tier: 'stinger', file: 'vs_clash', vol: 0.45, haptic: [60], throttleMs: 1000,
    synth: tone(110, 400, 'triangle', 0.15, 80),
  },
  'match.found': {
    tier: 'event', file: 'match_found', vol: 0.5, haptic: [40, 40, 40], throttleMs: 1000,
    synth: [tone(784, 90, 'sine', 0.12), tone(1047, 140, 'sine', 0.12, null, 100)],
  },
  'game.win': {
    tier: 'stinger', file: 'game_win', vol: 0.6, haptic: [80, 45, 110, 45, 160],
    synth: [tone(523, 130, 'sine', 0.18), tone(659, 150, 'sine', 0.19, null, 125), tone(784, 260, 'sine', 0.20, null, 270)],
  },
  'game.draw': {
    tier: 'stinger', file: 'game_draw', vol: 0.5, haptic: [55, 45, 70],
    synth: [tone(440, 130, 'sine', 0.12), tone(440, 180, 'triangle', 0.10, null, 140)],
  },
  'game.lose': {
    tier: 'stinger', file: 'game_lose', vol: 0.42, haptic: [45],
    synth: [tone(330, 110, 'triangle', 0.09), tone(262, 180, 'sine', 0.08, null, 105)],
  },

  // ── Progress, rewards, social ────────────────────────────
  'achievement.unlock': {
    tier: 'stinger', file: 'achievement', vol: 0.65, haptic: [70, 45, 110],
    synth: [tone(587, 105, 'sine', 0.15), tone(740, 120, 'sine', 0.16, null, 95), tone(880, 190, 'triangle', 0.15, null, 205)],
  },
  'elo.up': {
    tier: 'event', file: 'elo_up', vol: 0.4, haptic: [35, 30, 45],
    synth: tone(440, 105, 'triangle', 0.10, 554),
  },
  'elo.down': {
    tier: 'event', file: 'elo_down', vol: 0.32, haptic: [55],
    synth: tone(370, 105, 'triangle', 0.10, 294),
  },
  'coins.gain': {
    tier: 'reward', file: 'coins_pile', vol: 0.55, haptic: [30, 30, 30], throttleMs: 500,
    synth: [tone(1320, 50, 'sine', 0.07), tone(1568, 50, 'sine', 0.07, null, 60), tone(1760, 80, 'sine', 0.07, null, 120)],
  },
  'store.purchase': {
    tier: 'reward', file: 'cash_register', vol: 0.5, haptic: [40], throttleMs: 500,
    synth: [tone(1047, 80, 'sine', 0.1), tone(1568, 160, 'sine', 0.1, null, 90)],
  },
  'store.fail': {
    tier: 'event', file: 'move_invalid', vol: 0.35, haptic: [50],
    synth: tone(200, 140, 'square', 0.1, 140),
  },
  'invite.received': {
    tier: 'event', file: 'doorbell', vol: 0.45, haptic: [80, 60, 80], throttleMs: 1500,
    synth: [tone(784, 120, 'sine', 0.16), tone(1175, 120, 'sine', 0.16, null, 130)],
  },
  'invite.declined': {
    tier: 'event', file: 'elo_down', vol: 0.32, haptic: [40],
    synth: tone(370, 120, 'triangle', 0.08, 294),
  },
  'invite.expiring': {
    tier: 'event', file: 'clock_tick', vol: 0.3, haptic: null, throttleMs: 500,
    synth: tone(880, 40, 'sine', 0.06),
  },
  'reaction.send': {
    tier: 'ui', file: 'pop', vol: 0.35, haptic: null, throttleMs: 150,
    synth: tone(600, 40, 'sine', 0.07, 900),
  },
  'reaction.receive': {
    tier: 'event', file: 'pop', vol: 0.42, rate: 0.85, haptic: [20], throttleMs: 300,
    synth: tone(500, 50, 'sine', 0.08, 750),
  },

  // ── General UI (very quiet) ──────────────────────────────
  'ui.tap': {
    tier: 'ui', file: 'ui_tap', vol: 0.16, haptic: null, throttleMs: 60,
    synth: tone(1200, 15, 'sine', 0.025),
  },
  'ui.toggle': {
    tier: 'ui', file: 'ui_toggle', vol: 0.3, haptic: null, throttleMs: 60,
    synth: tone(900, 25, 'square', 0.03),
  },
});

export function getCue(id) {
  return Object.prototype.hasOwnProperty.call(SFX, id) ? SFX[id] : null;
}

// Every file path (without extension) a cue may request, for preload + tests.
export function cueFiles(entry) {
  if (!entry?.file) return [];
  const n = Number(entry.variants) || 0;
  if (n <= 1) return [entry.file];
  return Array.from({ length: n }, (_, i) => `${entry.file}_${i + 1}`);
}

// Every distinct file across the catalog (shared files listed once).
export function allCueFiles() {
  return [...new Set(Object.values(SFX).flatMap(cueFiles))];
}
