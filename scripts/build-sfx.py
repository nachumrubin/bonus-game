"""Rebuild assets/sfx/ from the CC0 source recordings.

Usage:  python scripts/build-sfx.py <sources-dir> assets/sfx

<sources-dir> layout (sources are NOT committed — fetch them first):
  fs/<id>.ogg   Freesound HQ previews, by sound id. Download each from the
                `data-ogg` URL on https://freesound.org/s/<id>/ with `-lq.ogg`
                replaced by `-hq.ogg`. Ids: see SPEC below.
  kenney/       The Kenney.nl packs, unzipped: interface-sounds, impact-sounds,
                music-jingles (https://kenney.nl/assets/<pack>).

Every source is CC0; docs/sound_inventory.md records each file's origin.
Needs ffmpeg on PATH.
"""
import glob
import os
import re
import subprocess
import sys

SRC, OUT = sys.argv[1], sys.argv[2]
K = os.path.join(SRC, 'kenney')
IF = os.path.join(K, 'interface-sounds', 'Audio')
IM = os.path.join(K, 'impact-sounds', 'Audio')


def fs(sound_id):
    return os.path.join(SRC, 'fs', f'{sound_id}.ogg')


def jingle(name):
    return glob.glob(os.path.join(K, 'music-jingles', '**', f'{name}.ogg'), recursive=True)[0]


# name, source, start s, length s, mode ('pk' = peak −3 dBFS, 'ln' = −16 LUFS),
# fade-out fraction of the length.
SPEC = [
    ('tile_place_1', fs(131229), 63.626, 0.22, 'pk', 0.4),
    ('tile_place_2', fs(131229), 60.944, 0.22, 'pk', 0.4),
    ('tile_place_3', fs(131229), 67.250, 0.22, 'pk', 0.4),
    ('tile_shuffle', fs(329100), 0.60, 0.55, 'pk', 0.4),
    ('bag_rustle', fs(554561), 6.66, 0.50, 'ln', 0.5),
    ('lock_click', fs(662385), 1.83, 0.35, 'pk', 0.5),
    ('coin_single', fs(847341), 0.00, 0.25, 'pk', 0.4),
    ('coins_collect', fs(368203), 0.00, 0.32, 'pk', 0.4),
    ('coins_pile', fs(684167), 0.00, 0.75, 'pk', 0.4),
    ('clock_tick', fs(450509), 2.15, 0.25, 'pk', 0.5),
    ('boost_activate', fs(136542), 0.00, 0.80, 'ln', 0.4),
    ('power_up', fs(351430), 0.30, 0.90, 'ln', 0.4),
    ('short_circuit', fs(205879), 3.90, 0.70, 'ln', 0.4),
    ('wheel_click', fs(752284), 8.578, 0.07, 'pk', 0.5),
    ('coin_flip', fs(181189), 0.07, 1.40, 'pk', 0.3),
    ('doorbell', fs(442280), 0.03, 1.90, 'ln', 0.35),
    ('cash_register', fs(184438), 0.00, 1.40, 'pk', 0.35),
    ('pop', fs(447910), 0.00, 0.20, 'pk', 0.4),
    ('whoosh', fs(701104), 0.10, 0.80, 'ln', 0.5),
    ('chime_turn', fs(773403), 34.49, 0.90, 'pk', 0.6),
    ('move_accepted', os.path.join(IF, 'glass_001.ogg'), 0, 0.40, 'pk', 0.4),
    ('move_invalid', os.path.join(IF, 'error_006.ogg'), 0, 0.50, 'pk', 0.4),
    ('ui_tap', os.path.join(IF, 'click_001.ogg'), 0, 0.10, 'pk', 0.4),
    ('ui_toggle', os.path.join(IF, 'switch_002.ogg'), 0, 0.15, 'pk', 0.4),
    ('match_found', os.path.join(IF, 'confirmation_002.ogg'), 0, 0.60, 'pk', 0.4),
    ('elo_up', os.path.join(IF, 'maximize_006.ogg'), 0, 0.40, 'pk', 0.4),
    ('elo_down', os.path.join(IF, 'minimize_006.ogg'), 0, 0.40, 'pk', 0.4),
    ('vs_clash', os.path.join(IM, 'impactBell_heavy_000.ogg'), 0, 1.20, 'pk', 0.6),
    ('game_win', jingle('jingles_STEEL07'), 0, 1.60, 'ln', 0.25),
    ('game_lose', jingle('jingles_STEEL05'), 0, 1.00, 'ln', 0.25),
    ('game_draw', jingle('jingles_STEEL08'), 0, 0.85, 'ln', 0.25),
    ('bingo', jingle('jingles_PIZZI10'), 0, 0.85, 'ln', 0.25),
    ('achievement', jingle('jingles_STEEL02'), 0, 1.45, 'ln', 0.25),
    ('mg_success', jingle('jingles_PIZZI15'), 0, 0.85, 'ln', 0.25),
    ('mg_fail', jingle('jingles_PIZZI05'), 0, 0.60, 'ln', 0.25),
]


def run(*args):
    subprocess.run(args, check=True)


def peak_db(src, ss, length, af):
    err = subprocess.run(
        ['ffmpeg', '-ss', str(ss), '-t', str(length), '-i', src, '-af', af + ',volumedetect', '-f', 'null', '-'],
        capture_output=True, text=True).stderr
    return float(re.search(r'max_volume: ([-\d.]+)', err).group(1))


def build(name, src, ss, length, mode, fade_frac):
    fade = round(length * fade_frac, 3)
    af = f'highpass=f=60,afade=t=in:d=0.004,afade=t=out:st={round(length - fade, 3)}:d={fade}'
    if mode == 'pk':
        af += f',volume={-3 - peak_db(src, ss, length, af)}dB'
    else:
        af += ',loudnorm=I=-16:TP=-3:LRA=11'
    wav = os.path.join(OUT, f'{name}.wav')
    # Render to 16-bit WAV first: encoding straight from the float filter
    # chain lets Vorbis overshoot short transients to 0 dBFS.
    run('ffmpeg', '-v', 'error', '-y', '-ss', str(ss), '-t', str(length), '-i', src,
        '-af', af, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', wav)
    run('ffmpeg', '-v', 'error', '-y', '-i', wav, '-c:a', 'libvorbis', '-q:a', '6', os.path.join(OUT, f'{name}.ogg'))
    run('ffmpeg', '-v', 'error', '-y', '-i', wav, '-c:a', 'aac', '-b:a', '96k', os.path.join(OUT, f'{name}.m4a'))
    os.remove(wav)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[3:])
    for spec in SPEC:
        if only and spec[0] not in only:
            continue
        build(*spec)
        print('ok', spec[0])
