"""Render the home logo as separate tile layers + the loading screen's upright tiles.

Two steps, like promo/render_app_logo.py (which renders the single-image logo):

1. Blender (headless) renders transparent 1920x1080 PNGs from the final frame of the
   v9_H reveal — the same shot, camera and lights as assets/ui/boost-logo.webp:

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b "Blender designs/boost_reveal_v9_H.blend" \
        --python "Blender designs/logo/render_logo_tiles.py" -- "Blender designs/logo/render"

   logo_<key>.png    each tile at its logo pose with the shadows the other (unseen)
                     tiles cast on it; logo_<key>_bare.png without them. sam = the
                     intact ס, which the scene hides at frame 168; samL/samR = halves
   logo_all.png      everything, as render_app_logo.py renders it (alignment check)
   row_<key>.png     each tile upright, centred, for the loading screen's straight row

2. Python + Pillow crops them exactly like render_app_logo.py --crop and writes the
   web assets plus the layer boxes the app positions them with:

    python "Blender designs/logo/render_logo_tiles.py" --pack "Blender designs/logo/render"

   assets/ui/logo_tiles/logo_<key>.webp, row_<key>.webp, src/ui/logoTilesLayout.js
"""
import json
import os
import sys

KEYS = ('bet', 'vav', 'sam', 'tet')          # the word's tiles, right → left
LOGO_LAYERS = ('bet', 'vav', 'tet', 'sam', 'samL', 'samR')
BARE_LAYERS = ('bet', 'vav', 'tet')          # also shipped without neighbours' shadows (in flight)
LOGO_W = 1100                                # boost-logo.webp width
ROW_H = 220                                  # loading-row tile height (px)
OUT_DIR = 'assets/ui/logo_tiles'
LAYOUT_JS = 'src/ui/logoTilesLayout.js'


def render(out_dir):
    import bpy
    sc = bpy.context.scene
    out_dir = os.path.abspath(out_dir)       # Blender resolves bare relative paths oddly
    sc.frame_set(168)
    # Freeze frame 168: drop every action so our pose/visibility edits survive the
    # render's own frame re-evaluation.
    for o in bpy.data.objects:
        o.animation_data_clear()
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    os.makedirs(out_dir, exist_ok=True)

    obj = bpy.data.objects
    roots = {k: obj['Tile_' + k] for k in ('bet', 'vav', 'tet', 'sam', 'samL', 'samR')}
    split = obj['Tile_sam_split']
    split.hide_render = False
    obj['Background'].hide_render = True

    def subtree(o):
        yield o
        for c in o.children:
            yield from subtree(c)

    # Everything that shows up in the logo render apart from lights / camera.
    shown = [o for o in obj if not o.hide_render and o.type not in ('LIGHT', 'CAMERA')]
    tile_objs = {k: set(subtree(r)) for k, r in roots.items()}

    def shot(name, keep, ghosts=()):
        """Render `keep`; `ghosts` stay in the scene (casting their shadows) but unseen."""
        for o in shown + list(tile_objs['sam']):
            o.hide_render = o not in keep and o not in ghosts
            o.visible_camera = o not in ghosts
        split.hide_render = False
        sc.render.filepath = os.path.join(out_dir, name + '.png')
        bpy.ops.render.render(write_still=True)

    final = set().union(*(tile_objs[k] for k in ('bet', 'vav', 'tet', 'samL', 'samR')))
    shot('logo_all', set(shown) - tile_objs['sam'])
    for k in LOGO_LAYERS:
        own = tile_objs[k] | ({split} if k in ('samL', 'samR') else set())
        # logo_<k>_bare: alone (in flight). logo_<k>: with the shadows the settled
        # (split) logo casts on it, faded in once its neighbours have landed.
        shot(f'logo_{k}_bare', own)
        shot(f'logo_{k}', own, (final | {split}) - own)

    # Upright row tiles: every tile at the centre with the same gentle backward tilt the
    # logo tiles share (so the thickness shows), no sideways lean, one common scale.
    for k in KEYS:
        r = roots[k]
        r.location = (0.0, 0.0, 1.2)
        r.rotation_euler = (-0.297, 0.0, 0.0)
        r.scale = (1.65,) * 3
        shot('row_' + k, tile_objs[k])


def pack(src):
    from PIL import Image

    def load(name):
        return Image.open(os.path.join(src, name + '.png')).convert('RGBA')

    # Same crop as render_app_logo.py --crop, from the full logo render.
    full = load('logo_all')
    l, t, r, b = full.split()[3].getbbox()
    pad = 12
    box = (max(l - pad, 0), max(t - pad, 0), min(r + pad, full.width), min(b + pad, full.height))
    size = (LOGO_W, round((box[3] - box[1]) * LOGO_W / (box[2] - box[0])))

    os.makedirs(OUT_DIR, exist_ok=True)
    layers = {}
    for k in LOGO_LAYERS:
        # The intact ס is only ever seen alone (its "shadowed" render would carry the
        # hidden halves' shadow); the halves only ever appear in place, shadowed.
        src_name = 'logo_sam_bare' if k == 'sam' else 'logo_' + k
        im = load(src_name).crop(box).resize(size, Image.LANCZOS)
        bb = im.split()[3].point(lambda a: 255 if a > 2 else 0).getbbox()
        bb = (max(bb[0] - 2, 0), max(bb[1] - 2, 0), min(bb[2] + 2, size[0]), min(bb[3] + 2, size[1]))
        im.crop(bb).save(os.path.join(OUT_DIR, f'logo_{k}.webp'), 'WEBP', quality=88, method=6)
        if k in BARE_LAYERS:
            load(f'logo_{k}_bare').crop(box).resize(size, Image.LANCZOS).crop(bb).save(
                os.path.join(OUT_DIR, f'logo_{k}_bare.webp'), 'WEBP', quality=88, method=6)
        # Box as % of the logo canvas, so the layers sit on top of the logo <img>.
        layers[k] = [round(100 * bb[0] / size[0], 3), round(100 * bb[1] / size[1], 3),
                     round(100 * (bb[2] - bb[0]) / size[0], 3), round(100 * (bb[3] - bb[1]) / size[1], 3)]

    # The bolt flash: exactly the gap the strike tears through the ס (intact ס minus
    # its two halves), as a white-hot core inside a cyan glow.
    from PIL import ImageChops, ImageFilter
    cut = lambda n: load(n).crop(box).resize(size, Image.LANCZOS).split()[3]
    whole = cut('logo_sam_bare').point(lambda a: 255 if a > 128 else 0)
    halves = ImageChops.lighter(cut('logo_samL'), cut('logo_samR')).point(lambda a: 255 if a > 40 else 0)
    gap = ImageChops.subtract(whole, halves).filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(9))
    core = gap.filter(ImageFilter.GaussianBlur(1.2))
    glow = gap.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(9)).point(lambda a: min(255, a * 2))
    bolt = Image.new('RGBA', size, (40, 212, 255, 0))
    bolt.putalpha(glow)
    white = Image.new('RGBA', size, (255, 255, 255, 0))
    white.putalpha(core)
    bolt.alpha_composite(white)
    bb = bolt.split()[3].point(lambda a: 255 if a > 2 else 0).getbbox()
    bolt.crop(bb).save(os.path.join(OUT_DIR, 'logo_bolt.webp'), 'WEBP', quality=88, method=6)
    layers['bolt'] = [round(100 * bb[0] / size[0], 3), round(100 * bb[1] / size[1], 3),
                      round(100 * (bb[2] - bb[0]) / size[0], 3), round(100 * (bb[3] - bb[1]) / size[1], 3)]

    # Row tiles share one crop box (union of their alpha boxes), so they line up.
    rows = {k: load('row_' + k) for k in KEYS}
    boxes = [im.split()[3].point(lambda a: 255 if a > 2 else 0).getbbox() for im in rows.values()]
    ub = (min(b[0] for b in boxes) - 4, min(b[1] for b in boxes) - 4,
          max(b[2] for b in boxes) + 4, max(b[3] for b in boxes) + 4)
    rw = round((ub[2] - ub[0]) * ROW_H / (ub[3] - ub[1]))
    for k, im in rows.items():
        im.crop(ub).resize((rw, ROW_H), Image.LANCZOS).save(
            os.path.join(OUT_DIR, f'row_{k}.webp'), 'WEBP', quality=88, method=6)

    with open(LAYOUT_JS, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// GENERATED by "Blender designs/logo/render_logo_tiles.py --pack" — do not edit.\n')
        f.write('// Each logo layer\'s box as [left, top, width, height] in % of boost-logo.webp\n')
        f.write('// (%d×%d), so the layers stack on top of the logo <img> pixel-for-pixel.\n' % size)
        f.write('export const LOGO_TILE_LAYERS = Object.freeze(%s);\n' % json.dumps(layers, indent=2))
        f.write('export const ROW_TILE_ASPECT = %s; // width / height of row_*.webp\n' % round(rw / ROW_H, 4))
    print('WROTE', OUT_DIR, LAYOUT_JS, size, (rw, ROW_H))


if '--pack' in sys.argv:
    pack(sys.argv[sys.argv.index('--pack') + 1])
else:
    render(sys.argv[-1])
