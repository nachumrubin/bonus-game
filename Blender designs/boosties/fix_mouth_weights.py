"""Re-weight an already-built Boostie's inner mouth skin to follow its face, and re-export.

The build used to weight the dark inner skin to `head` (and `jaw`) only, while the face over
it keeps its distance weights (head, neck, …). Any head turn that is not a pure `head`-bone
turn of the whole muzzle (the app's lively head on home / profile turns the head up to 32°)
moved the face and the skin apart, and the skin showed through as black patches.
build_boostie.py now copies the face's weights onto the skin; this patches the saved
out/<key>/<key>.blend files the same way so the models don't need a full rebuild.

    blender -b "out/lumi_l1/lumi_l1.blend" --python fix_mouth_weights.py

Each skin vertex keeps its `jaw` share; the rest is spread over the bones in the proportions
of the face surface nearest to it. Then run scripts/optimize-boosties.mjs to refresh
assets/boosties/. Check with face_check.py -- magenta lively.
"""
import os

import bpy
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

blend = bpy.data.filepath
KEY = os.path.splitext(os.path.basename(blend))[0]
OUT_ROOT = os.path.dirname(os.path.dirname(blend))
scene = bpy.context.scene
RIG = next(o for o in scene.objects if o.type == "ARMATURE")
MOUTH = bpy.data.objects.get("mouth")
if MOUTH is None:
    print("MOUTHFIX", KEY, "no mouth, skipped")
    raise SystemExit
BODY = max((o for o in RIG.children if o.type == "MESH" and o is not MOUTH), key=lambda o: len(o.data.vertices))

bme = BODY.data
bw = BODY.matrix_world
verts = [bw @ v.co for v in bme.vertices]
tree = BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in bme.polygons])
names = [g.name for g in BODY.vertex_groups]
jaw_i = names.index("jaw")
vw = [{g.group: g.weight for g in v.groups if g.weight > 0 and g.group != jaw_i} for v in bme.vertices]

for n in names:
    if n not in MOUTH.vertex_groups:
        MOUTH.vertex_groups.new(name=n)
mg = {g.index: g.name for g in MOUTH.vertex_groups}
m_jaw = MOUTH.vertex_groups["jaw"]
mw = MOUTH.matrix_world
moved = 0
for v in MOUTH.data.vertices:
    wj = next((g.weight for g in v.groups if mg[g.group] == "jaw"), 0.0)
    hit, _n, pi, _d = tree.find_nearest(mw @ v.co)
    if hit is None:
        continue
    poly = bme.polygons[pi]
    bary = poly_3d_calc([verts[i] for i in poly.vertices], hit)
    acc = {}
    for i, b in zip(poly.vertices, bary):
        for gi, w in vw[i].items():
            acc[gi] = acc.get(gi, 0.0) + w * b
    tot = sum(acc.values())
    if tot <= 1e-6:
        continue
    for g in list(v.groups):
        MOUTH.vertex_groups[g.group].remove([v.index])
    for gi, w in acc.items():
        if w / tot * (1 - wj) > 1e-4:
            MOUTH.vertex_groups[names[gi]].add([v.index], w / tot * (1 - wj), "REPLACE")
    if wj > 0:
        m_jaw.add([v.index], wj, "REPLACE")
    moved += 1
# keep the glTF's 4 influences per vertex what Blender shows
bpy.context.view_layer.objects.active = MOUTH
for o in scene.objects:
    o.select_set(o is MOUTH)
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)

RIG.animation_data.action = bpy.data.actions["idle"]
scene.frame_set(1)
bpy.ops.object.select_all(action="DESELECT")
RIG.select_set(True)
for ob in RIG.children:
    ob.select_set(True)
bpy.context.view_layer.objects.active = RIG
glb = os.path.join(OUT_ROOT, f"{KEY}.glb")
bpy.ops.export_scene.gltf(
    filepath=glb, export_format="GLB", use_selection=True, export_animations=True,
    export_animation_mode="ACTIONS", export_force_sampling=True, export_image_format="WEBP",
    export_cameras=False, export_lights=False)
bpy.ops.wm.save_mainfile()
print("MOUTHFIX", KEY, moved, "of", len(MOUTH.data.vertices), "skin verts re-weighted", os.path.getsize(glb) // 1024, "KB")
