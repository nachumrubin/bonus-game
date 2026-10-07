"""Zapi level 3 — built from the free BlenderKit "Stylized fox character".

Source (Royalty Free, not redistributed — kept outside the repo):
  ~/blenderkit_data/boostie_sources/Stylized_fox_character.blend
Download it with the recipe in the boostie notes (BlenderKit add-on, logged in).

What this adds on top of the source fox (AVATAR_EVOLUTION.md §5, level 3):
  - Zapi orange (hue/saturation push), cream lightning bolt on the forehead, amber eyes
  - smug half-lidded expression (face rig), crimson neckerchief
  - chest core: a round cyan orb (level 3 of the core ladder)
  - signature: the outer part of the tail turned to cyan energy
  - clips: idle (loop), turn, good, boost — for the scoreboard test page
Everything is baked to plain glTF textures and exported with deform bones only.

Run:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
    --python "Blender designs/boosties/build_zapi_l3_blenderkit.py" -- "Blender designs/boosties/out"
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

SRC = os.path.expanduser("~/blenderkit_data/boostie_sources/Stylized_fox_character.blend")
OUT = os.path.abspath(sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else
                      os.path.join(os.path.dirname(__file__), "out"))
os.makedirs(os.path.join(OUT, "textures"), exist_ok=True)


def lin(hexstr, a=1.0):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return (*[x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c], a)


CREAM = lin("F6E6CC")
CYAN = lin("3FE3FF")
CYAN_FUR = lin("9AF4FF")
CRIMSON = lin("8E1E2A")
AMBER = lin("E8961A")
BG = lin("A9ABAF")

bpy.ops.wm.open_mainfile(filepath=SRC)
scene = bpy.context.scene
RIG = bpy.data.objects["Stylized fox character"]
BODY = bpy.data.objects["Plane"]
EYES = bpy.data.objects["Sphere"]
RIG.name, BODY.name, EYES.name = "Zapi_L3_rig", "Zapi_L3_body", "Zapi_L3_eyes"
for m in BODY.modifiers:
    if m.type == "SUBSURF":
        m.show_render = m.show_viewport = False   # ship and preview the same 5k-face mesh

RIG.data.pose_position = "REST"
dg = bpy.context.evaluated_depsgraph_get()
dg.update()
bvh = BVHTree.FromObject(BODY, dg)


def hit(origin, direction=(0, 1, 0)):
    loc, nrm, _, _ = bvh.ray_cast(Vector(origin), Vector(direction))
    if loc is None:
        raise RuntimeError(f"no surface from {origin}")
    return loc, nrm


def frame(normal, roll_deg=0.0):
    z = normal.normalized()
    x = Vector((0, 0, 1)).cross(z).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed().to_4x4() @ Matrix.Rotation(math.radians(roll_deg), 4, "Z")


def bone_parent(obj, bone):
    mw = obj.matrix_world.copy()
    obj.parent = RIG
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = mw


def link(obj):
    scene.collection.objects.link(obj)
    return obj


# ------------------------------------------------------------------ energy mask on the tail
TAIL_BONES = ["DEF-spine.003", "DEF-spine.002", "DEF-spine.001", "DEF-spine"]
chain = [RIG.data.bones[TAIL_BONES[0]].tail_local] + [RIG.data.bones[b].head_local for b in TAIL_BONES]
seg_len = [(chain[i + 1] - chain[i]).length for i in range(len(chain) - 1)]
TOTAL = sum(seg_len)
gidx = {BODY.vertex_groups[b].index for b in TAIL_BONES if b in BODY.vertex_groups}


def along_tail(p):
    best, acc, t_best = 1e9, 0.0, 0.0
    for i, L in enumerate(seg_len):
        a, b = chain[i], chain[i + 1]
        u = max(0.0, min(1.0 + (0.6 if i == len(seg_len) - 1 else 0.0), (p - a).dot(b - a) / (L * L)))
        d = (a + (b - a) * u - p).length
        if d < best:
            best, t_best = d, (acc + u * L) / TOTAL
        acc += L
    return t_best


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


me = BODY.data
energy = me.color_attributes.new("energy", "FLOAT_COLOR", "POINT")
for v in me.vertices:
    w = sum(g.weight for g in v.groups if g.group in gidx)
    m = smooth(0.40, 0.58, along_tail(v.co)) * smooth(0.3, 0.6, w)
    energy.data[v.index].color = (m, m, m, 1)

# ------------------------------------------------------------------ bolt projector
fp, fn = hit((0, -2, 0.765))
proj = link(bpy.data.objects.new("BoltProjector", None))
proj.matrix_world = Matrix.Translation(fp) @ frame(fn)
BOLT_SIZE = 0.13
BOLT = [(0.12, 0.5), (-0.30, -0.04), (-0.02, -0.04), (-0.20, -0.5), (0.32, 0.12), (0.05, 0.12), (0.26, 0.5)]


def in_poly(u, v, poly):
    inside, j = False, len(poly) - 1
    for i in range(len(poly)):
        (xi, yi), (xj, yj) = poly[i], poly[j]
        if (yi > v) != (yj > v) and u < (xj - xi) * (v - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


N = 256
mask = bpy.data.images.new("bolt_mask", N, N, alpha=False, float_buffer=False)
mask.colorspace_settings.name = "Non-Color"   # before the pixels: changing it regenerates the image
px = []
for yy in range(N):
    for xx in range(N):
        s = sum(in_poly((xx + dx) / N - 0.5, (yy + dy) / N - 0.5, BOLT) for dx in (0.25, 0.75) for dy in (0.25, 0.75)) / 4
        px += (s, s, s, 1)
mask.pixels = px
mask.pack()

# ------------------------------------------------------------------ recolour the fur material


def node(nt, kind, **props):
    n = nt.nodes.new(kind)
    for k, v in props.items():
        setattr(n, k, v)
    return n


def mix_rgb(nt, fac, a, b):
    n = node(nt, "ShaderNodeMix", data_type="RGBA")
    for sock, val in ((n.inputs[0], fac), (n.inputs[6], a), (n.inputs[7], b)):
        if isinstance(val, tuple):
            sock.default_value = val
        else:
            nt.links.new(val, sock)
    return n.outputs[2]


def math_node(nt, op, a, b=0.0):
    n = node(nt, "ShaderNodeMath", operation=op)
    for sock, val in ((n.inputs[0], a), (n.inputs[1], b)):
        if isinstance(val, (int, float)):
            sock.default_value = val
        else:
            nt.links.new(val, sock)
    return n.outputs[0]


fur = bpy.data.materials["Material.002"]
nt = fur.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
albedo = bsdf.inputs["Base Color"].links[0].from_socket
hs = node(nt, "ShaderNodeHueSaturation")
hs.inputs["Hue"].default_value = 0.485
hs.inputs["Saturation"].default_value = 1.2
nt.links.new(albedo, hs.inputs["Color"])

tc = node(nt, "ShaderNodeTexCoord", object=proj)
mp = node(nt, "ShaderNodeMapping")
mp.inputs["Scale"].default_value = (1 / BOLT_SIZE, 1 / BOLT_SIZE, 1)
mp.inputs["Location"].default_value = (0.5, 0.5, 0)
nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
mt = node(nt, "ShaderNodeTexImage", image=mask, extension="CLIP", interpolation="Linear")
nt.links.new(mp.outputs["Vector"], mt.inputs["Vector"])
sep = node(nt, "ShaderNodeSeparateXYZ")
nt.links.new(tc.outputs["Object"], sep.inputs[0])
near = math_node(nt, "LESS_THAN", math_node(nt, "ABSOLUTE", sep.outputs[2]), 0.035)
bolt_fac = math_node(nt, "MULTIPLY", near, mt.outputs["Color"])

ea = node(nt, "ShaderNodeAttribute", attribute_name="energy")
col = mix_rgb(nt, bolt_fac, hs.outputs["Color"], CREAM)
col = mix_rgb(nt, ea.outputs["Fac"], col, CYAN_FUR)
nt.links.new(col, bsdf.inputs["Base Color"])
bsdf.inputs["Emission Color"].default_value = CYAN
nt.links.new(ea.outputs["Fac"], bsdf.inputs["Emission Strength"])

bpy.data.materials["Material"].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = AMBER

# ------------------------------------------------------------------ bake to plain textures
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 4
scene.render.bake.margin = 16
uv = me.uv_layers
render_uv = next(l for l in uv if l.active_render)
uv.active = render_uv


def bake(kind, size, name, non_color=False, **kw):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    for slot in BODY.material_slots:
        t = slot.material.node_tree
        n = t.nodes.new("ShaderNodeTexImage")
        n.image = img
        n.name = "BAKE_TARGET"
        t.nodes.active = n
    bpy.ops.object.select_all(action="DESELECT")
    BODY.select_set(True)
    bpy.context.view_layer.objects.active = BODY
    bpy.ops.object.bake(type=kind, **kw)
    for slot in BODY.material_slots:
        t = slot.material.node_tree
        t.nodes.remove(t.nodes["BAKE_TARGET"])
    img.filepath_raw = os.path.join(OUT, "textures", name + ".png")
    img.file_format = "PNG"
    img.save()
    return img


img_albedo = bake("DIFFUSE", 2048, "zapi_l3_albedo", pass_filter={"COLOR"})
img_emit = bake("EMIT", 512, "zapi_l3_emit")
img_normal = bake("NORMAL", 1024, "zapi_l3_normal", non_color=True)

final = bpy.data.materials.new("Zapi_L3_fur")
final.use_nodes = True
ft = final.node_tree
p = ft.nodes["Principled BSDF"]
for img, sock in ((img_albedo, "Base Color"), (img_emit, "Emission Color")):
    n = ft.nodes.new("ShaderNodeTexImage")
    n.image = img
    ft.links.new(n.outputs["Color"], p.inputs[sock])
p.inputs["Emission Strength"].default_value = 4.0
nn = ft.nodes.new("ShaderNodeTexImage")
nn.image = img_normal
nm = ft.nodes.new("ShaderNodeNormalMap")
nm.inputs["Strength"].default_value = 0.7
ft.links.new(nn.outputs["Color"], nm.inputs["Color"])
ft.links.new(nm.outputs["Normal"], p.inputs["Normal"])
p.inputs["Roughness"].default_value = 0.85
me.materials.clear()
me.materials.append(final)
for poly in me.polygons:
    poly.material_index = 0
bpy.data.objects.remove(proj)

# ------------------------------------------------------------------ eyes follow a deform bone
bone_parent(EYES, "DEF-spine.011")


def glow_mat(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    pp = m.node_tree.nodes["Principled BSDF"]
    pp.inputs["Base Color"].default_value = color
    pp.inputs["Emission Color"].default_value = color
    pp.inputs["Emission Strength"].default_value = strength
    return m


def flat_mat(name, color, rough=0.8):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    pp = m.node_tree.nodes["Principled BSDF"]
    pp.inputs["Base Color"].default_value = color
    pp.inputs["Roughness"].default_value = rough
    return m


def mesh_obj(name, bm, mat):
    md = bpy.data.meshes.new(name)
    bm.to_mesh(md)
    bm.free()
    ob = link(bpy.data.objects.new(name, md))
    md.materials.append(mat)
    for poly in md.polygons:
        poly.use_smooth = True
    return ob


# ------------------------------------------------------------------ chest core (level 3: round orb)
cp, cn = hit((0, -2, 0.285))
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=0.030)
core = mesh_obj("Zapi_L3_core", bm, glow_mat("Zapi_core", CYAN, 6.0))
core.matrix_world = Matrix.Translation(cp - cn * 0.006)
bone_parent(core, "DEF-spine.008")

# ------------------------------------------------------------------ neckerchief
# A shell lifted off the body's own neck faces: it fits exactly and keeps the body's
# skin weights, so it bends with the neck instead of floating as a rigid ring.
SCARF = flat_mat("Zapi_scarf", CRIMSON, 0.75)
NECK_C = Vector((0, -0.235, 0.455))
NECK_N = Vector((0, -math.sin(math.radians(28)), math.cos(math.radians(28))))
band = BODY.copy()
band.data = BODY.data.copy()
band.name = band.data.name = "Zapi_L3_scarf"
link(band)
for m in list(band.modifiers):
    if m.type != "ARMATURE":
        band.modifiers.remove(m)
bm = bmesh.new()
bm.from_mesh(band.data)
keep = {f for f in bm.faces
        if all(abs((v.co - NECK_C).dot(NECK_N)) < 0.034 and (v.co - NECK_C).length < 0.27 for v in f.verts)}
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep], context="FACES")
bm.normal_update()
for v in bm.verts:
    v.co += v.normal * 0.006
bm.to_mesh(band.data)
bm.free()
band.data.materials.clear()
band.data.materials.append(SCARF)
so = band.modifiers.new("thick", "SOLIDIFY")
so.thickness = 0.012
so.offset = 1.0
band.modifiers.move(len(band.modifiers) - 1, 0)
bpy.context.view_layer.objects.active = band
bpy.ops.object.modifier_apply(modifier="thick")

# knot + flap on the character's right side (towards the camera), clear of the core
side = Vector((-0.8, -0.6, 0)).normalized()
knot_at = max((band.matrix_world @ v.co for v in band.data.vertices),
              key=lambda q: (q - NECK_C).normalized().dot(side))
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=1.0,
                          matrix=Matrix.Translation(knot_at + side * 0.012) @ Matrix.Diagonal((0.034, 0.028, 0.028, 1)))
bmesh.ops.create_cone(bm, cap_ends=True, segments=3, radius1=0.045, radius2=0.006, depth=0.13,
                      matrix=Matrix.Translation(knot_at + side * 0.02 + Vector((0, 0.01, -0.06)))
                      @ Matrix.Rotation(math.radians(-14), 4, "Y") @ Matrix.Diagonal((1, 0.35, 1, 1))
                      @ Matrix.Rotation(math.radians(180), 4, "X"))
flap = mesh_obj("Zapi_L3_scarf_knot", bm, SCARF)
bone_parent(flap, "DEF-spine.009")

# ------------------------------------------------------------------ expression + clips
RIG.data.pose_position = "POSE"
scene.render.fps = 30
PB = RIG.pose.bones
EXPR = {}
for s in ("L", "R"):
    for i, d in (("", -0.022), (".001", -0.028), (".002", -0.028), (".003", -0.02)):
        EXPR[f"lid.T.{s}{i}"] = ("loc", (0, d, 0))
    EXPR[f"brow.T.{s}.003"] = ("loc", (0, -0.012, 0))
    EXPR[f"brow.T.{s}.002"] = ("loc", (0, -0.007, 0))
    EXPR[f"brow.T.{s}.001"] = ("loc", (0, 0.003, 0))
EXPR["lips.R"] = ("loc", (0, 0.013, 0))
EXPR["lips.L"] = ("loc", (0, 0.005, 0))
EXPR = {k: v for k, v in EXPR.items() if k in PB}

# bone -> [(frame, (rx, ry, rz) degrees)] or ("loc", [(frame, (x, y, z))])
CLIPS = {
    "idle": (121, {
        "torso": {"loc": [(1, (0, 0, 0)), (31, (0, 0, 0.004)), (61, (0, 0, 0)), (91, (0, 0, 0.004)), (121, (0, 0, 0))]},
        "head": {"rot": [(1, (0, 0, 0)), (61, (-3, -2, 0)), (121, (0, 0, 0))]},
        "spine_master.003": {"rot": [(1, (0, 0, 0)), (31, (0, 0, 7)), (61, (0, 0, 0)), (91, (0, 0, -7)), (121, (0, 0, 0))]},
        "ear.L": {"rot": [(1, (0, 0, 0)), (80, (0, 0, 0)), (83, (8, 0, 0)), (87, (0, 0, 0)), (121, (0, 0, 0))]},
    }),
    "turn": (37, {
        "head": {"rot": [(1, (0, 0, 0)), (9, (-10, -12, 0)), (26, (-10, -12, 0)), (37, (0, 0, 0))]},
        "torso": {"loc": [(1, (0, 0, 0)), (9, (0, 0, 0.012)), (26, (0, 0, 0.012)), (37, (0, 0, 0))]},
        "spine_master.003": {"rot": [(1, (0, 0, 0)), (9, (18, 0, 0)), (26, (18, 0, 6)), (37, (0, 0, 0))]},
    }),
    "good": (31, {
        "head": {"rot": [(1, (0, 0, 0)), (7, (10, 0, 0)), (13, (0, 0, 0)), (19, (8, 0, 0)), (25, (0, 0, 0)), (31, (0, 0, 0))]},
        "spine_master.003": {"rot": [(1, (0, 0, 0)), (5, (8, 0, 16)), (11, (8, 0, -16)), (17, (8, 0, 16)), (23, (8, 0, -16)), (31, (0, 0, 0))]},
    }),
    "boost": (25, {
        "torso": {"loc": [(1, (0, 0, 0)), (5, (0, 0.02, 0.015)), (25, (0, 0, 0))]},
        "head": {"rot": [(1, (0, 0, 0)), (5, (-14, 0, 0)), (12, (-6, 0, 0)), (25, (0, 0, 0))]},
        "spine_master.003": {"rot": [(1, (0, 0, 0)), (5, (28, 0, 0)), (12, (14, 0, 0)), (25, (0, 0, 0))]},
    }),
}
USED = sorted({b for _, tracks in CLIPS.values() for b in tracks} | set(EXPR))
for b in USED:
    PB[b].rotation_mode = "XYZ"


def neutral():
    for pb in PB:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)


RIG.animation_data_create()
old = RIG.animation_data.action
if old:
    old.name = "walk"
    old.use_fake_user = True
for name, (end, tracks) in CLIPS.items():
    neutral()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    RIG.animation_data.action = act
    for b in USED:
        keys = tracks.get(b, {})
        expr = EXPR.get(b)
        for f in (1, end):
            if expr:
                PB[b].location = expr[1]
                PB[b].keyframe_insert("location", frame=f, group=b)
        for f, v in keys.get("loc", []):
            PB[b].location = v
            PB[b].keyframe_insert("location", frame=f, group=b)
        for f, v in keys.get("rot", []):
            PB[b].rotation_euler = [math.radians(a) for a in v]
            PB[b].keyframe_insert("rotation_euler", frame=f, group=b)
        if not keys and not expr:
            PB[b].keyframe_insert("rotation_euler", frame=1, group=b)
            PB[b].keyframe_insert("location", frame=1, group=b)
    act.frame_range = (1, end)
neutral()
RIG.animation_data.action = bpy.data.actions["idle"]
scene.frame_set(1)

# ------------------------------------------------------------------ export
for o in bpy.context.view_layer.objects:
    o.select_set(False)
ship = [RIG, BODY, EYES, core, band, flap]
for o in ship:
    o.select_set(True)
bpy.context.view_layer.objects.active = RIG
glb = os.path.join(OUT, "zapi_l3_blenderkit.glb")
bpy.ops.export_scene.gltf(
    filepath=glb, export_format="GLB", use_selection=True,
    export_def_bones=True, export_animations=True, export_animation_mode="ACTIONS",
    export_force_sampling=True, export_apply=False, export_image_format="WEBP",
    export_cameras=False, export_lights=False)
print("GLB", glb, os.path.getsize(glb) // 1024, "KB")

# ------------------------------------------------------------------ preview renders
for o in list(scene.objects):
    if o.type in {"LIGHT", "CAMERA"}:
        bpy.data.objects.remove(o)
world = bpy.data.worlds.new("Preview")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = BG
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45


def light(name, loc, energy, color=(1, 1, 1), size=1.5):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy, ld.color, ld.size = energy, color, size
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    ob.rotation_euler = (Vector((0, -0.1, 0.45)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


light("Key", (-1.6, -1.8, 1.9), 120, (1.0, 0.96, 0.9))
light("Fill", (1.6, -1.4, 0.8), 35, (0.85, 0.9, 1.0), 2.0)
light("Rim", (0.6, 1.6, 1.6), 140)
cam = link(bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")))
cam.data.lens = 70
scene.camera = cam
scene.render.engine = "BLENDER_EEVEE"
scene.view_settings.view_transform = "Standard"
scene.render.film_transparent = False

try:
    tree = bpy.data.node_groups.new("Glow", "CompositorNodeTree")
    scene.compositing_node_group = tree
    rl = tree.nodes.new("CompositorNodeRLayers")
    gl = tree.nodes.new("CompositorNodeGlare")
    out = tree.nodes.new("NodeGroupOutput")
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    gl.inputs["Type"].default_value = "Bloom"
    for k, v in (("Threshold", 1.4), ("Strength", 0.6), ("Size", 0.5)):
        gl.inputs[k].default_value = v
    tree.links.new(rl.outputs["Image"], gl.inputs["Image"])
    tree.links.new(gl.outputs["Image"], out.inputs[0])
except Exception as exc:  # noqa: BLE001
    print("glow unavailable:", exc)


def shoot(path, cam_loc, target, size, lens=70):
    cam.location = cam_loc
    cam.rotation_euler = (Vector(target) - Vector(cam_loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


HERO = ((-1.25, -2.05, 0.95), (0.02, -0.02, 0.44))
shoot(os.path.join(OUT, "zapi_l3_full.png"), *HERO, 1024)
shoot(os.path.join(OUT, "zapi_l3_bust.png"), (-0.62, -1.15, 0.78), (0.0, -0.22, 0.55), 512)
for name, frames in (("turn", (9, 26)), ("good", (7, 19)), ("boost", (5, 12))):
    RIG.animation_data.action = bpy.data.actions[name]
    for f in frames:
        scene.frame_set(f)
        shoot(os.path.join(OUT, f"anim_{name}_{f:02d}.png"), *HERO, 384)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "zapi_l3.blend"))
print("done")
