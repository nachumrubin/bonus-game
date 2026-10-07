# Sound Inventory

Every audio file under `assets/sfx/` and where it came from. Cue ids, tiers, volumes,
pitch and fallback tones live in `src/ui/sfx/sfxCatalog.js`. `sfxEngine.test.js` fails if
a catalog file is missing on disk, if a file on disk is not used by any cue, or if a cue
is not played anywhere in `src/`.

**Style rule:** anything with a physical/natural element uses a realistic recording, kept
subtle so it adds to the game rather than distracting:
- wood tiles are real Scrabble tiles on a board;
- boosts are real electricity;
- the bag is cloth;
- coins, the clock, the padlock, the wheel ratchet, the coin toss and the doorbell are
  real recordings.

Designed UI sounds (Kenney) are used only for abstract moments: word accepted or
rejected, match found, Elo, jingles and button taps.

**Licensing rule:** CC0 only. Freesound filtered to CC0 for realistic foley; Kenney.nl
(all packs CC0) for UI sounds and jingles. A CC0 upload that is *built from* a CC-BY
sound counts as CC-BY: Freesound #209578 was rejected for this reason, and its CC0
source #184438 is used instead. Anything that needs attribution, or is marked
non-commercial, needs a credits line and an explicit decision before it is added.

**Format:**
- trimmed and mono, 44.1 kHz;
- short hits peak-normalised to −3 dBFS, longer clips loudness-normalised to −16 LUFS
  (true-peak −3);
- each file shipped as `.ogg` (Vorbis q6) and `.m4a` (AAC 96k, for iOS);
- about 440 KB per format, and a device only downloads one format.

**Rebuild:** `python scripts/build-sfx.py <sources-dir> assets/sfx`. The script header
says how to get the sources (Freesound HQ previews by id, plus the Kenney zips).
- Always render a 16-bit WAV first and encode from it. Encoding Vorbis straight from the
  filter chain, or at `-q:a 4`, overshoots short transients to 0 dBFS.

| File | Cues | Source | License | Edits |
|---|---|---|---|---|
| `tile_place_1..3` | tile.pick, tile.place, tile.return, opponent.tile, mg.tap, spinner.tick, spinner.stop | Freesound #131229 "scrabble.wav" by moxobna — three tile placements from a real game (63.64 s, 60.96 s, 67.26 s) | CC0 | 0.22 s each, peak −3 dB; cues vary rate/vol + ±3–4 % jitter |
| `tile_shuffle` | tile.recallAll, tile.cascade, exchange.done | Freesound #329100 "Domino pieces 2" by Macif | CC0 | 0.60–1.15 s, peak −3 dB |
| `bag_rustle` | exchange.open | Freesound #554561 "fabric rubbing / pulling" by dynamique | CC0 | 6.66–7.16 s, −16 LUFS |
| `lock_click` | lock.place | Freesound #662385 "padlock.wav" by elvish_paisley | CC0 | 1.83–2.18 s, peak −3 dB |
| `coin_single` | score.chip, mg.count | Freesound #847341 "coin-011" by ilyaShevelev | CC0 | 0.25 s, peak −3 dB |
| `coins_collect` | score.land | Freesound #368203 "Coin Dropped" by kermite607 | CC0 | 0.32 s, peak −3 dB |
| `coins_pile` | boost.points, coins.gain | Freesound #684167 "Coins Falling Into Pile" by AKkingStudio | CC0 | 0.75 s, peak −3 dB |
| `clock_tick` | timer.warn, timer.tick, mg.tick, invite.expiring | Freesound #450509 "ClockTickSound_01" by abyeditsound | CC0 | one tick at 2.15 s, 0.25 s, peak −3 dB |
| `boost_activate` | boost.activate, score.multiplier, evolve.burst | Freesound #136542 "ELECTRIC_ZAP_001" by JoelAudio | CC0 | 0.8 s, 10 ms fade-in, −16 LUFS |
| `power_up` | boost.charge, evolve.charge | Freesound #351430 "Neon Lamp, Switch On, Hum" by Kinoton | CC0 | 0.30–1.20 s, −16 LUFS |
| `short_circuit` | boost.vetoed | Freesound #205879 "Amp short circuit 1" by unreadpages | CC0 | 3.90–4.60 s, −16 LUFS |
| `wheel_click` | wheel.click | Freesound #752284 "Spin the wheel clicks" by leocb | CC0 | single click at 8.578 s, 70 ms, peak −3 dB |
| `coin_flip` | coin.flip | Freesound #181189 "coin flip.wav" by Raventhornn | CC0 | 0.07–1.47 s, peak −3 dB |
| `doorbell` | invite.received | Freesound #442280 "DoorBell Shortened" by jwheeler91 | CC0 | 1.9 s, −16 LUFS |
| `cash_register` | store.purchase | Freesound #184438 "Cash Register Fake" by CapsLok | CC0 | 1.4 s, peak −3 dB |
| `pop` | reaction.send, reaction.receive | Freesound #447910 "Plop!" by Breviceps | CC0 | 0.2 s, peak −3 dB |
| `whoosh` | turn.extra, turn.skip, boost.intro | Freesound #701104 "Whoosh stereo light (transition)" by xkeril | CC0 | 0.10–0.90 s, −16 LUFS |
| `chime_turn` | turn.yours | Freesound #773403 "Atonal Crystal Chime Transition Short x20" by newlocknew (one chime at 34.49 s) | CC0 | 0.9 s, peak −3 dB |
| `move_accepted` | move.accepted, mg.good | Kenney *Interface Sounds* `glass_001` | CC0 | 0.40 s, peak −3 dB |
| `move_invalid` | move.invalid, timer.timeout, mg.bad, store.fail | Kenney *Interface Sounds* `error_006` (soft, low) | CC0 | 0.5 s, peak −3 dB |
| `match_found` | match.found | Kenney *Interface Sounds* `confirmation_002` | CC0 | peak −3 dB |
| `elo_up` / `elo_down` | elo.up / elo.down, invite.declined | Kenney *Interface Sounds* `maximize_006` / `minimize_006` | CC0 | peak −3 dB |
| `ui_tap` / `ui_toggle` | ui.tap / ui.toggle | Kenney *Interface Sounds* `click_001` / `switch_002` | CC0 | peak −3 dB |
| `vs_clash` | vs.intro | Kenney *Impact Sounds* `impactBell_heavy_000` | CC0 | 1.2 s, peak −3 dB |
| `game_win` | game.win | Kenney *Music Jingles* `jingles_STEEL07` | CC0 | 1.55 s, −16 LUFS |
| `game_lose` | game.lose | Kenney *Music Jingles* `jingles_STEEL05` (−5 semitones, falling) | CC0 | −16 LUFS |
| `game_draw` | game.draw | Kenney *Music Jingles* `jingles_STEEL08` (level) | CC0 | −16 LUFS |
| `bingo` | bingo | Kenney *Music Jingles* `jingles_PIZZI10` (+5.5 st, rising) | CC0 | −16 LUFS |
| `achievement` | achievement.unlock, evolve.reveal | Kenney *Music Jingles* `jingles_STEEL02` (+6.9 st, rising) | CC0 | −16 LUFS |
| `mg_success` | mg.success | Kenney *Music Jingles* `jingles_PIZZI15` (+5.5 st) | CC0 | −16 LUFS |
| `mg_fail` | mg.fail | Kenney *Music Jingles* `jingles_PIZZI05` (−9.7 st, gentle fall) | CC0 | −16 LUFS |

The jingles were chosen by measuring each one's pitch contour (start vs end), not by
name: rising for rewards, falling for a loss or fail, level for a draw.
