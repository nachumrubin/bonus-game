"""Convert the stills from render_stills.py into the app's WebP files.

    python stills_to_webp.py              every out/<char>_l<N>/still_*.png
    python stills_to_webp.py zapi_l3      only these keys

Writes assets/avatars/boosties/<char>/l<N>_bust.webp (256 px) and l<N>_full.webp (512 px).
Bots (single level, bot_easy etc.) go to assets/avatars/bots/<key>_{bust,full}.webp.
"""
import os
import re
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DST = os.path.join(REPO, "assets", "avatars", "boosties")
SIZES = {"bust": 256, "full": 512}
KEY = re.compile(r"^([a-z]+)_l(\d)$")
BOT = re.compile(r"^bot_[a-z]+$")
BOT_DST = os.path.join(REPO, "assets", "avatars", "bots")

keys = sys.argv[1:] or sorted(d for d in os.listdir(os.path.join(HERE, "out")) if KEY.match(d) or BOT.match(d))
for key in keys:
    if BOT.match(key):
        folder, name = BOT_DST, key + "_{kind}.webp"
    else:
        char, lvl = KEY.match(key).groups()
        folder, name = os.path.join(DST, char), f"l{lvl}_" + "{kind}.webp"
    os.makedirs(folder, exist_ok=True)
    for kind, px in SIZES.items():
        src = os.path.join(HERE, "out", key, f"still_{kind}.png")
        if not os.path.exists(src):
            print("missing", src)
            continue
        im = Image.open(src).convert("RGBA").resize((px, px), Image.LANCZOS)
        out = os.path.join(folder, name.format(kind=kind))
        im.save(out, "WEBP", quality=88, method=6)
        print(out, os.path.getsize(out) // 1024, "KB")
