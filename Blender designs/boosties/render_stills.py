"""Render the app's still images of a built Boostie (transparent background).

    blender -b out/<key>/<key>.blend --python render_stills.py -- <key>

Opens the scene build_boostie.py saved (lights, camera, bloom) and renders the rest pose
(idle, frame 1) from the same 3/4 view as the build previews:

    out/<key>/still_bust.png   512 px, head and shoulders (scoreboard, lists, profile)
    out/<key>/still_full.png   768 px, whole body (store, level-up fallback)

Then run  python stills_to_webp.py  to write assets/avatars/boosties/<char>/l<N>_{bust,full}.webp
(Blender's Python has no PIL).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

KEY = sys.argv[sys.argv.index("--") + 1]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", KEY)

scene = bpy.context.scene
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
cam = scene.camera
RIG = next(o for o in scene.objects if o.type == "ARMATURE")
BODY = next(o for o in scene.objects if o.type == "MESH" and o.name.endswith("_body"))

# rest pose: the idle clip's first frame
if "idle" in bpy.data.actions:
    RIG.animation_data.action = bpy.data.actions["idle"]
scene.frame_set(1)
bpy.context.view_layer.update()

pts = [RIG.matrix_world @ v.co for v in BODY.data.vertices]
lo = Vector([min(q[i] for q in pts) for i in range(3)])
hi = Vector([max(q[i] for q in pts) for i in range(3)])
ctr, size = (lo + hi) / 2, max(hi - lo)
view = Vector((-0.35, -1.0, 0.18)).normalized()   # as build_boostie.py
head = RIG.matrix_world @ RIG.data.bones["head"].tail_local


def shoot(name, target, dist, res):
    cam.location = target + view * dist
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)


# bust: fit what is above the neck (the head bone's base) and near the head, so tufts and
# ears are in, then show the same again below it for the shoulders and the chest core
neck = RIG.matrix_world @ RIG.data.bones["head"].head_local
hp = [p for p in pts if p.z > neck.z and abs(p.x - head.x) < size * 0.3 and abs(p.y - head.y) < size * 0.2]   # not the tail
top = max(p.z for p in hp)
hh = top - neck.z
# visible height; a head wider than it is tall (Rocco's horns) sets it by its width in this view
yaw = math.atan2(-view.x, -view.y)
frame = max(hh * 1.9, ((max(p.x for p in hp) - min(p.x for p in hp)) * math.cos(yaw)
                       + (max(p.y for p in hp) - min(p.y for p in hp)) * math.sin(yaw)) * 1.1)
cx = (min(p.x for p in hp) + max(p.x for p in hp)) / 2
cy = (min(p.y for p in hp) + max(p.y for p in hp)) / 2
target = Vector((cx, cy, top + hh * 0.14 - frame / 2))
shoot("still_bust.png", target, frame / (2 * math.tan(cam.data.angle / 2)), 512)
shoot("still_full.png", ctr, size * 2.2, 768)
print("stills done", KEY)
