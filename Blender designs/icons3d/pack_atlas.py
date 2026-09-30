"""
Pack the pose-atlas frames rendered by `build_relief.py --atlas` into WebP sprite sheets for the app.

  python "Blender designs/icons3d/pack_atlas.py"          (run from the repo root)

Reads   Blender designs/icons3d/out/<category>/<name>_frames/frames.json (+ frame PNGs)
Writes  assets/anim/<source path under assets/, .webp>   e.g. assets/anim/avatars_v2/common/doctor.webp
        assets/anim/manifest.json   keyed by the source PNG path the app already uses, e.g.
        "assets/avatars_v2/common/doctor.png": {atlas, cell, cols, count, kind, frames, axes}
"""
import glob, json, math, os
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(REPO, "Blender designs", "icons3d", "out")
ANIM = os.path.join(REPO, "assets", "anim")
QUALITY = 80


def rel(p):
    return os.path.relpath(p, REPO).replace(os.sep, "/")


def main():
    manifest, total = {}, 0
    for meta_path in sorted(glob.glob(os.path.join(OUT, "*", "*_frames", "frames.json"))):
        d = os.path.dirname(meta_path)
        with open(meta_path, encoding="utf-8") as fh:
            meta = json.load(fh)
        src = rel(meta["source"])
        frames = meta["frames"]
        cw, ch = meta["cell"]
        cols = math.ceil(math.sqrt(len(frames)))
        rows = math.ceil(len(frames) / cols)
        sheet = Image.new("RGBA", (cols * cw, rows * ch), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            im = Image.open(os.path.join(d, f["file"])).convert("RGBA")
            sheet.paste(im, ((i % cols) * cw, (i // cols) * ch))
        dest = os.path.join(ANIM, os.path.splitext(os.path.relpath(os.path.join(REPO, src), os.path.join(REPO, "assets")))[0] + ".webp")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        sheet.save(dest, "WEBP", quality=QUALITY, method=6)
        total += os.path.getsize(dest)
        axes = {}
        rest = next(i for i, f in enumerate(frames) if f["name"] == "rest")
        for i, f in enumerate(frames):
            if f["axis"]:
                axes.setdefault(f["axis"], [[0, rest]]).append([f["value"], i])
        for a in axes.values():
            a.sort()
        manifest[src] = {
            "atlas": rel(dest), "cell": [cw, ch], "cols": cols, "count": len(frames), "kind": meta["kind"],
            "frames": {f["name"]: i for i, f in enumerate(frames)}, "axes": axes,
        }
        print(f"{rel(dest)}  {os.path.getsize(dest) // 1024} KB")
    with open(os.path.join(ANIM, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump({"version": 1, "atlases": manifest}, fh, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(f"{len(manifest)} atlases, {total / 1e6:.1f} MB total")


if __name__ == "__main__":
    main()
