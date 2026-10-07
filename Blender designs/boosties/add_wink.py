"""Add the `wink` clip to already-built Boosties and re-export their .glb.

New builds get it from build_boostie.py (CLIPS["wink"] + LID_CLIPS). This patches the
saved out/<key>/<key>.blend files so the 14 existing models don't need a full rebuild.

    blender -b "out/zapi_l4/zapi_l4.blend" --python add_wink.py -- [--check]

--check also renders out/<key>/wink_check.png (the bust at the wink's hold frame).
Then run scripts/optimize-boosties.mjs to refresh assets/boosties/.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

# Keep in sync with build_boostie.py CLIPS["wink"] / LID_CLIPS["wink"].
WINK_END = 22
WINK_BODY = {
    "head": [(1, (0, 0, 0)), (4, (3, 0, 9)), (13, (3, 0, 8)), (22, (0, 0, 0))],
    "jaw": [(1, (0, 0, 0)), (4, (-6, 0, 0)), (13, (-6, 0, 0)), (20, (0, 0, 0))],   # a sly grin
    "ear.L": [(1, (0, 0, 0)), (4, (-8, 0, 0)), (13, (-8, 0, 0)), (22, (0, 0, 0))],
    "tail.3": [(1, (0, 0, 0)), (6, (0, 0, 8)), (14, (0, 0, -4)), (22, (0, 0, 0))],
}
WINK_LIDS = {   # lid.* rotate about X from the build's rest opening; -82 = shut
    "lid.L": [(1, (0, 0, 0)), (4, (-82, 0, 0)), (13, (-82, 0, 0)), (19, (0, 0, 0)), (22, (0, 0, 0))],
    "lid.R": [(1, (0, 0, 0)), (4, (-10, 0, 0)), (13, (-10, 0, 0)), (19, (0, 0, 0)), (22, (0, 0, 0))],
}

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
CHECK = "--check" in args
blend = bpy.data.filepath
KEY = os.path.splitext(os.path.basename(blend))[0]
OUT = os.path.dirname(blend)
OUT_ROOT = os.path.dirname(OUT)
scene = bpy.context.scene
RIG = next(o for o in scene.objects if o.type == "ARMATURE")
PB = RIG.pose.bones


def head_yaw():
    # build_boostie adds CFG["head_yaw"] to the head's Y in every clip; read it back from idle
    idle = bpy.data.actions.get("idle")
    for fc in getattr(idle, "fcurves", []) or []:
        if fc.data_path == 'pose.bones["head"].rotation_euler' and fc.array_index == 1:
            return math.degrees(fc.evaluate(1))
    RIG.animation_data.action = idle
    scene.frame_set(1)
    return math.degrees(PB["head"].rotation_euler[1])


YAW = head_yaw()
if "wink" in bpy.data.actions:
    bpy.data.actions.remove(bpy.data.actions["wink"])
for pb in PB:
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (0, 0, 0)
act = bpy.data.actions.new("wink")
act.use_fake_user = True
RIG.animation_data.action = act
for pb in PB:
    if pb.name == "root" or pb.name.startswith(("eye.", "lidlow.")):
        continue
    if pb.name.startswith("lid."):
        tracks = WINK_LIDS.get(pb.name)
    else:
        mirror = pb.name.startswith("tailb.")
        tracks = WINK_BODY.get(pb.name.replace("tailb.", "tail.") if mirror else pb.name) or [(1, (0, 0, 0))]
        if mirror:
            tracks = [(f, (v[0], -v[1], -v[2])) for f, v in tracks]
    if not tracks:
        continue
    for f, v in tracks:
        if pb.name == "head":
            v = (v[0], v[1] + YAW, v[2])
        pb.rotation_euler = [math.radians(a) for a in v]
        pb.keyframe_insert("rotation_euler", frame=f, group=pb.name)
act.frame_range = (1, WINK_END)
for pb in PB:
    pb.rotation_euler = (0, 0, 0)

if CHECK:
    scene.frame_set(8)
    bpy.context.view_layer.update()
    cam = scene.camera
    arm = RIG.data
    head = RIG.matrix_world @ arm.bones["head"].tail_local
    tgt = head - Vector((0, 0, 0.12))
    body = max((o for o in RIG.children if o.type == "MESH"), key=lambda o: len(o.data.vertices))
    pts = [body.matrix_world @ v.co for v in body.data.vertices]
    size = max(max(q[i] for q in pts) - min(q[i] for q in pts) for i in range(3))
    view = Vector((-0.35, -1.0, 0.18)).normalized()
    cam.location = tgt + view * size * 1.25
    cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.filepath = os.path.join(OUT, "wink_check.png")
    bpy.ops.render.render(write_still=True)

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
print("WINK", KEY, "yaw", round(YAW, 1), os.path.getsize(glb) // 1024, "KB")
