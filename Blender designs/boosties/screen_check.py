"""Render every screen-face expression of a built bot, one bust image each.

    blender -b out/bot_easy/bot_easy.blend --python screen_check.py

Writes out/<key>/face_<expr>.png (rest pose, only that face shown). Check them with
contact sheets before shipping a bot.
"""
import os

import bpy
from mathutils import Vector

blend = bpy.data.filepath
KEY = os.path.splitext(os.path.basename(blend))[0]
OUT = os.path.dirname(blend)
scene = bpy.context.scene
RIG = next(o for o in scene.objects if o.type == "ARMATURE")
faces = [pb for pb in RIG.pose.bones if pb.name.startswith("face.")]
RIG.animation_data.action = None
for pb in RIG.pose.bones:
    pb.rotation_euler = (0, 0, 0)
scr = bpy.data.objects["screen"]
pts = [scr.matrix_world @ v.co for v in scr.data.vertices]
ctr = sum(pts, Vector()) / len(pts)
size = max(max(q[i] for q in pts) - min(q[i] for q in pts) for i in range(3))
cam = scene.camera
cam.location = ctr + Vector((-0.25, -1.0, 0.1)).normalized() * size * 3.2
cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.render.resolution_x = scene.render.resolution_y = 384
for shown in faces:
    for pb in faces:
        pb.scale = (1, 1, 1) if pb is shown else (0.001,) * 3
    bpy.context.view_layer.update()
    scene.render.filepath = os.path.join(OUT, f"face_{shown.name[5:]}.png")
    bpy.ops.render.render(write_still=True)
print("FACES", KEY, len(faces))
