#!/usr/bin/env python3
"""Generate web-sized WebP copies of every PNG under assets/.

The PNGs in assets/ are 1024px art masters (0.5-2.4 MB each) — they are also
the Blender input for assets/anim/ and their paths are stored in Firebase as
avatar ids, so they stay untouched. This writes a sibling `<name>.webp`
(max 512px on the long side, q82, alpha kept) next to each PNG; the service
worker serves it whenever the PNG is requested (sw.js `webImageUrl`).

Run after adding or replacing art:   python scripts/build-web-images.py
Skips a WebP that is newer than its PNG; `--force` rebuilds everything.
assets/anim/ (generated atlases) is excluded.
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / 'assets'
MAX_SIDE = 512
QUALITY = 82


def build(png: Path, force: bool) -> tuple[int, int] | None:
    out = png.with_suffix('.webp')
    if not force and out.exists() and out.stat().st_mtime >= png.stat().st_mtime:
        return None
    with Image.open(png) as im:
        im = im.convert('RGBA') if im.mode not in ('RGB', 'RGBA') else im
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        im.save(out, 'WEBP', quality=QUALITY, method=4)
    return png.stat().st_size, out.stat().st_size


def main() -> None:
    force = '--force' in sys.argv
    before = after = count = 0
    for png in sorted(ROOT.rglob('*')):
        if png.suffix.lower() != '.png' or 'anim' in png.relative_to(ROOT).parts:
            continue
        res = build(png, force)
        if res:
            count += 1
            before += res[0]
            after += res[1]
            print(f'{res[0] // 1024:>6} KB -> {res[1] // 1024:>4} KB  {png.relative_to(ROOT.parent)}')
    print(f'{count} built: {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
