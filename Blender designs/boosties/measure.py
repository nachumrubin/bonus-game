"""Gridded views of a raw TRELLIS mesh, for filling in a LEVELS entry in build_boostie.py.

Plain Python (needs Pillow); it runs Blender in the background for the renders.

  python measure.py sources/zapi_l3_trellis.glb               # front / side / top, 0.1 grid
  python measure.py sources/zapi_l3_trellis.glb --head -0.17 0.24   # front close-up of the
                                                                     # head, 0.02 grid (pupils)
  python measure.py sources/zapi_l4_trellis.glb --side -0.2 0.2      # side close-up (y, z) of
                                                                     # the head, 0.02 grid (mouth)
  python measure.py sources/zapi_l3_trellis.glb --spin               # 4 perspective views to
                                                                     # check for flaws first

Coordinates read off the grids are in the source mesh's own space, which is what LEVELS
uses. Front view: x right, z up (camera at -Y). Side view: y right (front = -Y on the
left), z up. Top view: x right, y up.
"""
import argparse
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw

BLENDER = r"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
HERE = os.path.dirname(os.path.abspath(__file__))

RENDER = r'''
import bpy, sys, math
from mathutils import Vector
src, out, mode, cx, cz, scale = sys.argv[sys.argv.index("--") + 1:]
cx, cz, scale = float(cx), float(cz), float(scale)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
w = bpy.data.worlds.new("W"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.52, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.5
sc.view_settings.view_transform = "Standard"
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x = sc.render.resolution_y = 600
cam = bpy.data.objects.new("C", bpy.data.cameras.new("C")); sc.collection.objects.link(cam); sc.camera = cam
if mode == "spin":
    cam.data.lens = 50
    for i, ang in enumerate((-30, 30, 90, 180)):
        a = math.radians(ang)
        cam.location = Vector((-math.sin(a), -math.cos(a), 0.25)).normalized() * 2.6
        cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = f"{out}_spin{i}.png"; bpy.ops.render.render(write_still=True)
else:
    cam.data.type = "ORTHO"; cam.data.ortho_scale = scale
    shots = {"head": [("front", (cx, -3, cz), (1.5708, 0, 0))],
             "headside": [("side", (3, cx, cz), (1.5708, 0, 1.5708))]}.get(mode, [
        ("front", (cx, -3, cz), (1.5708, 0, 0)), ("side", (3, cx, cz), (1.5708, 0, 1.5708)),
        ("top", (cx, cz, 3), (0, 0, 0))])
    for name, loc, rot in shots:
        cam.location = loc; cam.rotation_euler = rot
        sc.render.filepath = f"{out}_{name}.png"; bpy.ops.render.render(write_still=True)
'''


def grid(path, cx, cy, scale, step, label):
    im = Image.open(path).convert("RGB")
    d = ImageDraw.Draw(im)
    px_per = 600 / scale
    n = int(scale / step / 2) + 1
    for k in range(-n, n + 1):
        v = k * step
        p = 300 + v * px_per
        col = (255, 220, 0) if k == 0 else (70, 70, 70)
        d.line([(p, 0), (p, 600)], fill=col)
        d.line([(0, p), (600, p)], fill=col)
        d.text((p + 2, 2), f"{cx + v:+.2f}", fill=(0, 0, 0))
        d.text((2, p + 2), f"{cy - v:+.2f}", fill=(0, 0, 0))
    d.text((5, 585), label, fill=(0, 0, 0))
    return im


ap = argparse.ArgumentParser()
ap.add_argument("glb")
ap.add_argument("--head", nargs=2, type=float, metavar=("X", "Z"), help="front close-up centred here")
ap.add_argument("--side", nargs=2, type=float, metavar=("Y", "Z"), help="side close-up centred here")
ap.add_argument("--spin", action="store_true")
a = ap.parse_args()

glb = os.path.abspath(a.glb)
base = os.path.join(HERE, "out", "measure", os.path.splitext(os.path.basename(glb))[0])
os.makedirs(os.path.dirname(base), exist_ok=True)
mode = "spin" if a.spin else "head" if a.head else "headside" if a.side else "ortho"
cx, cz = a.head or a.side or (0.0, 0.0)
scale = 0.3 if (a.head or a.side) else 1.2
with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
    f.write(RENDER)
subprocess.run([BLENDER, "-b", "--factory-startup", "--python", f.name, "--", glb, base, mode,
                str(cx), str(cz), str(scale)], check=True, capture_output=True)
os.unlink(f.name)

if mode == "spin":
    ims = [Image.open(f"{base}_spin{i}.png").convert("RGB") for i in range(4)]
    out = Image.new("RGB", (2400, 600))
    for i, im in enumerate(ims):
        out.paste(im, (i * 600, 0))
    path = f"{base}_spin.png"
elif mode == "head":
    out = grid(f"{base}_front.png", cx, cz, scale, 0.02, "front (pupils)")
    path = f"{base}_head.png"
elif mode == "headside":
    out = grid(f"{base}_side.png", cx, cz, scale, 0.02, "side, front = left (mouth)")
    path = f"{base}_headside.png"
else:
    ims = [grid(f"{base}_{n}.png", 0, 0, scale, 0.1, n) for n in ("front", "side", "top")]
    out = Image.new("RGB", (1800, 600))
    for i, im in enumerate(ims):
        out.paste(im, (i * 600, 0))
    path = f"{base}_ortho.png"
out.save(path)
print(path)
