"""Close-up face renders of a built Boostie across its clips, to catch the inner mouth skin
showing through the face.

    blender -b out/<key>/<key>.blend --python face_check.py [-- magenta] [lively]

Writes out/<key>/fcheck_<clip>_<frame>_<side>.png (256 px): the rest pose and the frames of
idle / turn / boost / signature where the head moves most, seen from both 3/4 sides. With
`magenta` the mouth skin is painted bright magenta so any poke-through stands out. With
`lively` it renders the idle pose with the head turned the way the app's lively avatar
turns it instead (fcheck_idle_31_y<yaw>p<pitch>_<side>.png).
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
blend = bpy.data.filepath
KEY = os.path.splitext(os.path.basename(blend))[0]
OUT = os.path.dirname(blend)
scene = bpy.context.scene
cam = scene.camera
RIG = next(o for o in scene.objects if o.type == "ARMATURE")
BODY = next(o for o in scene.objects if o.type == "MESH" and o.name.endswith("_body"))
MOUTH = bpy.data.objects.get("mouth")
if MOUTH is not None and "magenta" in ARGS:
    m = MOUTH.active_material
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    for lk in list(bsdf.inputs["Base Color"].links):
        nt.links.remove(lk)
    bsdf.inputs["Base Color"].default_value = (1, 0, 1, 1)
    bsdf.inputs["Emission Color"].default_value = (1, 0, 1, 1)
    bsdf.inputs["Emission Strength"].default_value = 2.0

scene.render.resolution_x = scene.render.resolution_y = 256
scene.render.film_transparent = False
SHOTS = [("idle", 1), ("idle", 31), ("idle", 61), ("turn", 9), ("turn", 15), ("turn", 26),
         ("boost", 12), ("boost", 21), ("signature", 5), ("signature", 15)]
# `lively`: the app's lively mode (home / profile avatar, boostieLive.js LIVELY) turns the
# head on top of idle, up to ±32° yaw (headYaw 18 × gazeX 1.8), +9° / −6° pitch and ±4° roll
LIVELY = [(32, 0, 0), (-32, 0, 0), (32, 9, 4), (-32, 9, -4), (32, -6, 4), (-32, -6, -4), (0, 9, 4), (0, -6, -4)]
if "lively" in ARGS:
    SHOTS = [("idle", 31, t) for t in LIVELY]
for shot in SHOTS:
    clip, f = shot[:2]
    turn = shot[2] if len(shot) > 2 else None
    act = bpy.data.actions.get(clip)
    if act is None:
        continue
    RIG.animation_data.action = act
    try:
        if act.slots:
            RIG.animation_data.action_slot = act.slots[0]
    except AttributeError:
        pass
    if f > act.frame_range[1]:
        continue
    scene.frame_set(f)
    bpy.context.view_layer.update()
    hb = RIG.pose.bones["head"]
    tag = ""
    if turn:
        yaw, pitch, roll = turn
        RIG.animation_data.action = None    # hold the frame's pose, then turn the head in world space
        r = (Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Rotation(math.radians(-pitch), 4, "X")
             @ Matrix.Rotation(math.radians(roll), 4, "Y"))
        piv = hb.head.copy()
        m = hb.matrix.copy()
        m = Matrix.Translation(piv) @ r @ Matrix.Translation(-piv) @ m
        hb.matrix = m
        bpy.context.view_layer.update()
        tag = f"_y{yaw}p{pitch}"
    head = RIG.matrix_world @ hb.tail
    neck = RIG.matrix_world @ hb.head
    hh = max(0.05, (head - neck).length)
    # aim between the head bone and the mouth, from in front of the face
    fwd = (RIG.matrix_world.to_3x3() @ hb.matrix.to_3x3() @ Vector((0, 0, -1))).normalized()
    jaw = RIG.pose.bones.get("jaw")
    target = RIG.matrix_world @ jaw.tail if jaw else head
    for side, sx in (("l", -0.45), ("r", 0.45)):
        view = Vector((sx, -1.0, 0.12)).normalized()
        cam.location = target + view * hh * 3.2
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(OUT, f"fcheck_{clip}_{f:02d}{tag}_{side}.png")
        bpy.ops.render.render(write_still=True)
print("face_check done", KEY)
