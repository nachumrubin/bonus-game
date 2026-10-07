"""Render image-to-3D candidates side by side, so generators can be judged on equal terms.

    blender -b --factory-startup --python compare_models.py -- OUT.png A.glb [B.glb ...]

Each model is scaled to the same height and shown front, three-quarter, side, back and
as a bust close-up, under identical light. The text printed for each model: triangle
count, texture size and the number of loose parts (stray pieces are a common fault).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUT, MODELS = args[0], args[1:]
VIEWS = [("front", 0), ("3/4", 40), ("side", 90), ("back", 180), ("bust", 25)]
CELL = 360

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [
    e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
sc.render.resolution_x = sc.render.resolution_y = CELL
sc.render.film_transparent = False
sc.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.33, 0.36, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
sc.world = world


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.lights, bpy.data.cameras):
        for x in list(coll):
            coll.remove(x)


def light(name, energy, rot):
    d = bpy.data.lights.new(name, "SUN")
    d.energy = energy
    o = bpy.data.objects.new(name, d)
    o.rotation_euler = [math.radians(r) for r in rot]
    sc.collection.objects.link(o)


def stats(meshes):
    tris = sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes)
    parts = 0
    for m in meshes:
        bm = bmesh.new()
        bm.from_mesh(m.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)   # glTF splits verts at UV seams
        bm.verts.index_update()
        seen = set()
        for v in bm.verts:
            if v.index in seen:
                continue
            parts += 1
            stack = [v]
            while stack:
                x = stack.pop()
                if x.index in seen:
                    continue
                seen.add(x.index)
                stack.extend(e.other_vert(x) for e in x.link_edges)
        bm.free()
    texs = sorted({f"{i.size[0]}x{i.size[1]}" for i in bpy.data.images if i.size[0]})
    return tris, parts, texs


renders, lines = [], []
for path in MODELS:
    clear()
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in sc.objects if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    h = hi.z - lo.z
    mid = (lo + hi) / 2
    tris, parts, texs = stats(meshes)
    name = os.path.splitext(os.path.basename(path))[0]
    lines.append(f"{name}: {tris} tris, {parts} loose parts, textures {', '.join(texs) or 'none'}")
    light("key", 3.0, (50, 0, -35))
    light("fill", 1.0, (60, 0, 140))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 50
    # glTF imports Y-up as Z-up with the model facing -Y
    for view, yaw in VIEWS:
        a = math.radians(yaw)
        if view == "bust":
            t, dist = Vector((mid.x, mid.y, lo.z + h * 0.80)), h * 1.25
        else:
            t, dist = mid, h * 1.9
        cam.location = t + Vector((math.sin(a) * dist, -math.cos(a) * dist, h * 0.08))
        cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
        f = os.path.join(os.path.dirname(OUT), f"_cmp_{name}_{view.replace('/', '')}.png")
        sc.render.filepath = f
        bpy.ops.render.render(write_still=True)
        renders.append((name, view, f))

# contact sheet: one row per model
rows = len(MODELS)
sheet = bpy.data.images.new("sheet", CELL * len(VIEWS), CELL * rows)
px = [0.0] * (CELL * len(VIEWS) * CELL * rows * 4)
for idx, (name, view, f) in enumerate(renders):
    r, c = divmod(idx, len(VIEWS))
    img = bpy.data.images.load(f)
    src = list(img.pixels)
    row0 = rows - 1 - r                       # Blender images start at the bottom
    for y in range(CELL):
        d = ((row0 * CELL + y) * CELL * len(VIEWS) + c * CELL) * 4
        s = y * CELL * 4
        px[d:d + CELL * 4] = src[s:s + CELL * 4]
    os.remove(f)
sheet.pixels = px
sheet.filepath_raw = OUT
sheet.file_format = "PNG"
sheet.save()
print("COMPARE " + " | ".join(lines))
