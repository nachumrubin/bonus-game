"""Zapi level 4 — scripted head-and-shoulders blockout.

A look test, not a production model: is a fully scripted Boostie good enough, or
should it only be a base for hand sculpting? Builds the body from overlapping
primitives fused by a voxel remesh, paints fur regions as vertex colours, adds
eyes / brows / nose / mouth / core / sash / tails, and renders a soft and a toon
version from the 3/4 view of the evolution sheet.

Run:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
    --python "Blender designs/boosties/build_zapi_l4_blockout.py" -- "Blender designs/boosties/out"
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.join(os.path.dirname(__file__), "out")
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)


def srgb(hexstr, a=1.0):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, a)


ORANGE = srgb("E9692C")
CREAM = srgb("F6E6CC")
DARK = srgb("3E1E14")
INNER_EAR = srgb("F2C9B0")
CRIMSON = srgb("8E1E2A")
AMBER = srgb("F0A21C")
CYAN = srgb("3FE3FF")
BG = srgb("A9ABAF")

H = Vector((0, 0, 2.0))  # head centre

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = scene.collection


def link(obj):
    col.objects.link(obj)
    return obj


def mesh_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def axis_matrix(direction):
    """Rotation taking +Z to `direction`."""
    return Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4()


def ell(bm, center, radii, direction=(0, 0, 1)):
    """Ellipsoid; radii are (x, y, z) before rotating local Z onto `direction`."""
    m = Matrix.Translation(center) @ axis_matrix(direction) @ Matrix.Diagonal((*radii, 1))
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=1.0, matrix=m)


def capsule(bm, a, b, r):
    a, b = Vector(a), Vector(b)
    ell(bm, (a + b) / 2, (r, r, (b - a).length / 2 + r * 0.6), b - a)


def cone(bm, base, direction, r, length, flat=1.0):
    m = (Matrix.Translation(base) @ axis_matrix(direction) @ Matrix.Diagonal((1, flat, 1, 1))
         @ Matrix.Translation((0, 0, length / 2)))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=r, radius2=0.0, depth=length, matrix=m)


# ---------------------------------------------------------------- body (one fused surface)
bm = bmesh.new()
ell(bm, H, (0.38, 0.34, 0.35))                                   # cranium
ell(bm, (0, -0.08, 2.08), (0.30, 0.30, 0.25))                     # brow mass
for s in (1, -1):
    ell(bm, (s * 0.21, -0.14, 1.89), (0.19, 0.18, 0.15))           # cheeks
ell(bm, (0, -0.32, 1.89), (0.15, 0.22, 0.11), (0, -1, 0.10))      # muzzle base
ell(bm, (0, -0.55, 1.88), (0.075, 0.17, 0.065), (0, -1, 0.06))    # long pointed muzzle
ell(bm, (0, -0.36, 1.81), (0.10, 0.20, 0.05), (0, -1, 0.15))      # jaw
for s in (1, -1):
    cone(bm, (s * 0.31, -0.08, 1.86), (s * 1, 0.05, -0.40), 0.09, 0.19)  # cheek fluff
    cone(bm, (s * 0.29, -0.03, 1.79), (s * 0.85, 0.1, -0.85), 0.08, 0.15)
cone(bm, (0.03, -0.16, 2.29), (0.35, -0.9, 0.7), 0.06, 0.13, 0.5)  # small forelock tufts
cone(bm, (-0.05, -0.12, 2.31), (-0.3, -0.9, 0.8), 0.05, 0.11, 0.5)
ell(bm, (0, 0.02, 1.62), (0.19, 0.17, 0.22))                      # neck
cone(bm, (0, -0.13, 1.66), (0, -0.6, -1), 0.11, 0.20)             # throat ruff
for s in (1, -1):
    cone(bm, (s * 0.09, -0.11, 1.66), (s * 0.45, -0.55, -1), 0.09, 0.17)
ell(bm, (0, 0.0, 1.16), (0.29, 0.21, 0.40))                       # chest
ell(bm, (0, 0.02, 1.44), (0.33, 0.19, 0.12))                      # shoulder girdle
for s in (1, -1):
    ell(bm, (s * 0.33, 0.02, 1.43), (0.10, 0.10, 0.10))           # shoulders
    capsule(bm, (s * 0.37, 0.02, 1.40), (s * 0.45, 0.05, 1.02), 0.075)   # upper arm
    capsule(bm, (s * 0.45, 0.05, 1.00), (s * 0.30, -0.08, 0.80), 0.065)  # forearm to hip
ell(bm, (0, 0.03, 0.78), (0.27, 0.20, 0.22))                      # hips
body = mesh_obj("Zapi_Body", bm)

rem = body.modifiers.new("fuse", "REMESH")
rem.mode = "VOXEL"
rem.voxel_size = 0.009
sm = body.modifiers.new("soften", "SMOOTH")
sm.factor = 0.9
sm.iterations = 10
bpy.context.view_layer.objects.active = body
for m in list(body.modifiers):
    bpy.ops.object.modifier_apply(modifier=m.name)

bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())


def hit(x, z, y0=-3.0):
    """Ray straight back (+Y) onto the body; returns (point, normal)."""
    loc, nrm, _, _ = bvh.ray_cast(Vector((x, y0, z)), Vector((0, 1, 0)))
    if loc is None:
        raise RuntimeError(f"no surface at x={x} z={z}")
    return loc, nrm


def frame(normal, roll_deg=0.0):
    """Rotation whose Z is the surface normal and X stays horizontal, rolled about Z."""
    z = normal.normalized()
    x = Vector((0, 0, 1)).cross(z).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    return m @ Matrix.Rotation(math.radians(roll_deg), 4, "Z")


# ---------------------------------------------------------------- fur colours
BOLT = [(0.020, 0.105), (-0.055, -0.005), (-0.004, -0.005), (-0.034, -0.110),
        (0.058, 0.022), (0.008, 0.022), (0.040, 0.105)]
bolt_p, bolt_n = hit(0.0, 2.21)
bolt_m = frame(bolt_n).inverted() @ Matrix.Translation(-bolt_p)


def in_poly(u, v, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        (xi, yi), (xj, yj) = poly[i], poly[j]
        if (yi > v) != (yj > v) and u < (xj - xi) * (v - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def fur(p):
    r = p - H
    if p.z > 1.95 and r.y < -0.1:
        q = bolt_m @ p
        if abs(q.z) < 0.05 and in_poly(q.x * 1.15, q.y * 1.15, BOLT):
            return CREAM
    if p.z > 1.62:   # head
        line = -0.035 + 0.32 * max(0.0, abs(r.x) - 0.10)        # cheek line rises outwards
        if r.y < 0.06 and r.z < line:
            return CREAM
        return ORANGE
    if p.y < -0.03 and abs(p.x) < 0.15 and p.z > 1.40:          # throat
        return CREAM
    if p.y < -0.06 and (p.x / 0.20) ** 2 + ((p.z - 1.08) / 0.42) ** 2 < 1:   # chest bib
        return CREAM
    return ORANGE


me = body.data
ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
for v in me.vertices:
    ca.data[v.index].color = fur(v.co)
# soften the voxel stair-steps along colour borders
nbrs = [[] for _ in me.vertices]
for e in me.edges:
    a, b = e.vertices
    nbrs[a].append(b)
    nbrs[b].append(a)
cols = [tuple(ca.data[i].color) for i in range(len(me.vertices))]
for _ in range(3):
    cols = [tuple(sum(c) / (len(n) + 1) for c in zip(cols[i], *(cols[j] for j in n))) for i, n in enumerate(nbrs)]
for i, c in enumerate(cols):
    ca.data[i].color = c
me.color_attributes.active_color = ca
for poly in me.polygons:
    poly.use_smooth = True

# ---------------------------------------------------------------- materials


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return m, nt, out


def fur_mat(name, color=None, attr=None, rough=0.7, sheen=0.6):
    m, nt, out = new_mat(name)
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    if attr:
        a = nt.nodes.new("ShaderNodeAttribute")
        a.attribute_name = attr
        nt.links.new(a.outputs["Color"], p.inputs["Base Color"])
    else:
        p.inputs["Base Color"].default_value = color
    p.inputs["Roughness"].default_value = rough
    p.inputs["Sheen Weight"].default_value = sheen
    p.inputs["Sheen Roughness"].default_value = 0.4
    nt.links.new(p.outputs[0], out.inputs["Surface"])
    m["base"] = list(color) if color else None
    m["attr"] = attr or ""
    return m


def glow_mat(name, color, strength):
    m, nt, out = new_mat(name)
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = color
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], out.inputs["Surface"])
    m["glow"] = True
    return m


def mix(nt, fac, a, b):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    for sock, val in ((n.inputs[0], fac), (n.inputs[6], a), (n.inputs[7], b)):
        if isinstance(val, tuple):
            sock.default_value = val
        else:
            nt.links.new(val, sock)
    return n.outputs[2]


def math_node(nt, op, a, b):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    for sock, val in ((n.inputs[0], a), (n.inputs[1], b)):
        if isinstance(val, (int, float)):
            sock.default_value = val
        else:
            nt.links.new(val, sock)
    return n.outputs[0]


def eye_mat():
    """Procedural anime eye in the eye object's local space: lid, lash line, iris, pupil, glint."""
    m, nt, out = new_mat("Eye")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    x, y = sep.outputs[0], sep.outputs[1]
    d = math_node(nt, "SQRT", math_node(nt, "ADD", math_node(nt, "MULTIPLY", x, x),
                                        math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", y, -0.05),
                                                  math_node(nt, "SUBTRACT", y, -0.05))), 0)
    gx = math_node(nt, "SUBTRACT", x, -0.22)
    gy = math_node(nt, "SUBTRACT", y, 0.12)
    glint = math_node(nt, "LESS_THAN", math_node(nt, "ADD", math_node(nt, "MULTIPLY", gx, gx),
                                                  math_node(nt, "MULTIPLY", gy, gy)), 0.018)
    c = mix(nt, math_node(nt, "LESS_THAN", d, 0.70), (1, 1, 1, 1), AMBER)
    c = mix(nt, math_node(nt, "LESS_THAN", math_node(nt, "ADD", d, math_node(nt, "MULTIPLY", y, -0.35)), 0.46), c, srgb("C8700F"))
    c = mix(nt, math_node(nt, "LESS_THAN", d, 0.30), c, srgb("120806"))
    c = mix(nt, glint, c, (1, 1, 1, 1))
    c = mix(nt, math_node(nt, "GREATER_THAN", y, 0.22), c, DARK)          # lash line
    c = mix(nt, math_node(nt, "GREATER_THAN", y, 0.40), c, ORANGE)        # heavy lid: smug
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(c, p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.15
    nt.links.new(p.outputs[0], out.inputs["Surface"])
    m["eye"] = True
    return m


M_BODY = fur_mat("Fur", attr="Col")
M_DARK = fur_mat("Dark", DARK, rough=0.5, sheen=0.2)
M_INNER = fur_mat("InnerEar", INNER_EAR, sheen=0.8)
M_NOSE = fur_mat("Nose", srgb("1A0D0A"), rough=0.25, sheen=0.0)
M_SASH = fur_mat("Sash", CRIMSON, rough=0.8, sheen=0.3)
M_CORE = glow_mat("Core", CYAN, 3.5)
M_RING = glow_mat("Ring", CYAN, 3.0)
M_ENERGY = glow_mat("Energy", CYAN, 2.2)
M_EYE = eye_mat()
body.data.materials.append(M_BODY)

# ---------------------------------------------------------------- ears (tips dark via a 2-material split)
for s in (1, -1):
    for inner in (False, True):
        bm = bmesh.new()
        base = Vector((s * 0.22, 0.04 - (0.045 if inner else 0), 2.24))
        d = Vector((s * 0.36, 0.06, 1))
        if inner:
            cone(bm, base, d, 0.11, 0.44, 0.30)
        else:
            cone(bm, base, d, 0.165, 0.60, 0.48)
            bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if e.calc_length() > 0.2], cuts=8)
        ear = mesh_obj("Ear" + ("In" if inner else "") + ("R" if s > 0 else "L"), bm)
        sub = ear.modifiers.new("smooth", "SUBSURF")
        sub.levels = sub.render_levels = 2
        if inner:
            ear.data.materials.append(M_INNER)
        else:
            ear.data.materials.append(M_BODY)
            ear.data.materials.append(M_DARK)
            axis = d.normalized()
            for poly in ear.data.polygons:
                t = (poly.center - base).dot(axis) / 0.60
                poly.material_index = 1 if t > 0.55 else 0
            eca = ear.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
            for v in ear.data.vertices:
                eca.data[v.index].color = ORANGE
        for poly in ear.data.polygons:
            poly.use_smooth = True


def place(obj, loc, rot):
    obj.matrix_world = Matrix.Translation(loc) @ rot @ obj.matrix_world


# ---------------------------------------------------------------- eyes, brows, nose, mouth
for s in (1, -1):
    p, n = hit(s * 0.15, 2.04)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0)
    eye = mesh_obj("Eye", bm)
    eye.data.materials.append(M_EYE)
    for poly in eye.data.polygons:
        poly.use_smooth = True
        rot = frame(n, s * 10)
    eye.matrix_world = Matrix.Translation(p - n * 0.008) @ rot @ Matrix.Diagonal((0.105, 0.082, 0.032, 1))

    bp, bn = hit(s * 0.16, 2.165)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
    brow = mesh_obj("Brow", bm)
    brow.data.materials.append(M_DARK)
    for poly in brow.data.polygons:
        poly.use_smooth = True
    brow.matrix_world = Matrix.Translation(bp) @ frame(bn, s * 20) @ Matrix.Diagonal((0.085, 0.017, 0.016, 1))

bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
nose = mesh_obj("Nose", bm)
nose.data.materials.append(M_NOSE)
for poly in nose.data.polygons:
    poly.use_smooth = True
np_, nn = hit(0.0, 1.915)
nose.matrix_world = Matrix.Translation(np_ - nn * 0.01) @ frame(nn) @ Matrix.Diagonal((0.058, 0.042, 0.045, 1))

curve = bpy.data.curves.new("Mouth", "CURVE")
curve.dimensions = "3D"
curve.bevel_depth = 0.0065
curve.bevel_resolution = 3
spl = curve.splines.new("POLY")
pts = [(-0.11, 1.815), (-0.06, 1.80), (0.0, 1.808), (0.06, 1.80), (0.115, 1.807), (0.15, 1.835)]
spl.points.add(len(pts) - 1)
for i, (x, z) in enumerate(pts):
    q, qn = hit(x, z)
    q = q + qn * 0.004
    spl.points[i].co = (q.x, q.y, q.z, 1)
mouth = link(bpy.data.objects.new("Mouth", curve))
curve.materials.append(M_DARK)

# ---------------------------------------------------------------- chest core + sash
cp, cn = hit(0.0, 1.30)
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=0.058)
core = mesh_obj("Core", bm)
core.data.materials.append(M_CORE)
core.matrix_world = Matrix.Translation(cp + cn * 0.012)
bpy.ops.mesh.primitive_torus_add(major_radius=0.092, minor_radius=0.0055, major_segments=64, minor_segments=8)
ring = bpy.context.active_object
ring.data.materials.append(M_RING)
ring.matrix_world = Matrix.Translation(cp + cn * 0.008) @ frame(cn)

bpy.ops.mesh.primitive_cylinder_add(vertices=200, radius=0.62, depth=0.13, end_fill_type="NOTHING")
sash = bpy.context.active_object       # an open band; the shrinkwrap lays it onto the body
bm = bmesh.new()
bm.from_mesh(sash.data)
bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if e.calc_length() > 0.1], cuts=3)
bm.to_mesh(sash.data)
bm.free()
sash.matrix_world = Matrix.Translation((0, 0, 1.10)) @ Matrix.Rotation(math.radians(40), 4, "Y")
sw = sash.modifiers.new("hug", "SHRINKWRAP")
sw.target = body
sw.wrap_method = "NEAREST_SURFACEPOINT"
sw.wrap_mode = "OUTSIDE_SURFACE"
sw.offset = 0.02
so = sash.modifiers.new("thick", "SOLIDIFY")
so.thickness = 0.018
so.offset = 1.0
sash.data.materials.append(M_SASH)

# ---------------------------------------------------------------- tails (behind the right shoulder)


def tube(name, pts, mat, colors=None):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 6
    cu.resolution_u = 16
    cu.use_fill_caps = True
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(pts) - 1)
    for bp, (co, r) in zip(sp.bezier_points, pts):
        bp.co = co
        bp.radius = r
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    ob = link(bpy.data.objects.new(name, cu))
    cu.materials.append(mat)
    return ob


fur_tail = tube("Tail", [((0.12, 0.24, 0.80), 0.09), ((0.42, 0.40, 1.00), 0.19),
                         ((0.60, 0.46, 1.38), 0.19), ((0.56, 0.42, 1.74), 0.05)], M_BODY)
energy_tail = tube("EnergyTail", [((0.22, 0.34, 0.86), 0.05), ((0.66, 0.58, 1.14), 0.13),
                                  ((0.88, 0.62, 1.62), 0.11), ((0.78, 0.56, 2.12), 0.012)], M_ENERGY)
# convert the fur tail so its tip can be painted cream
bpy.context.view_layer.objects.active = fur_tail
fur_tail.select_set(True)
bpy.ops.object.convert(target="MESH")
fur_tail = bpy.context.active_object
tca = fur_tail.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
for v in fur_tail.data.vertices:
    tca.data[v.index].color = CREAM if v.co.z > 1.56 else ORANGE

# ---------------------------------------------------------------- camera, light, world
cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 70
cam = link(bpy.data.objects.new("Cam", cam_data))
target = Vector((0.12, -0.05, 1.90))
cam.location = (1.65, -3.85, 2.10)
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam


def light(name, kind, loc, energy, color=(1, 1, 1), size=1.0):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == "AREA":
        ld.size = size
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    ob.rotation_euler = (Vector((0, 0, 1.8)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return ob


light("Key", "AREA", (-2.2, -3.2, 3.6), 260, (1.0, 0.96, 0.9), 2.5)
light("Fill", "AREA", (3.0, -2.5, 1.6), 70, (0.85, 0.9, 1.0), 3.0)
light("Rim", "AREA", (1.5, 3.0, 3.0), 300, (1.0, 1.0, 1.0), 1.5)

world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = BG
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45

scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"


def setup_glow():
    try:
        tree = bpy.data.node_groups.new("Glow", "CompositorNodeTree")
        scene.compositing_node_group = tree
        rl = tree.nodes.new("CompositorNodeRLayers")
        gl = tree.nodes.new("CompositorNodeGlare")
        out = tree.nodes.new("NodeGroupOutput")
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        for k, v in (("glare_type", "BLOOM"), ("quality", "HIGH")):
            try:
                setattr(gl, k, v)
            except Exception:
                if k in gl.inputs:
                    gl.inputs[k].default_value = v.title()
        for k, v in (("Threshold", 1.5), ("Strength", 0.5), ("Size", 0.5)):
            if k in gl.inputs:
                gl.inputs[k].default_value = v
        if "Type" in gl.inputs:
            gl.inputs["Type"].default_value = "Bloom"
        tree.links.new(rl.outputs["Image"], gl.inputs["Image"])
        tree.links.new(gl.outputs["Image"], out.inputs[0])
        print("glow: compositor bloom ok;", [s.name for s in gl.inputs])
    except Exception as exc:  # noqa: BLE001
        print("glow: compositor unavailable:", exc)


setup_glow()


def toonify():
    """Swap every lit material for a 2-step cel version of itself."""
    for m in bpy.data.materials:
        if m.get("glow") or m.get("eye"):
            continue
        nt = m.node_tree
        p = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
        s2r = nt.nodes.new("ShaderNodeShaderToRGB")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.interpolation = "CONSTANT"
        ramp.color_ramp.elements[0].color = (0.55, 0.5, 0.55, 1)
        ramp.color_ramp.elements[1].position = 0.18
        ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs[0].default_value = 1.0
        src = p.inputs["Base Color"]
        if src.links:
            nt.links.new(src.links[0].from_socket, mul.inputs[6])
        else:
            mul.inputs[6].default_value = src.default_value
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(diff.outputs[0], s2r.inputs[0])
        nt.links.new(s2r.outputs["Color"], ramp.inputs[0])
        nt.links.new(ramp.outputs["Color"], mul.inputs[7])
        nt.links.new(mul.outputs[2], em.inputs["Color"])
        nt.links.new(em.outputs[0], out.inputs["Surface"])


print("body verts:", len(body.data.vertices))

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "zapi_l4_blockout.blend"))
scene.render.filepath = os.path.join(OUT, "zapi_l4_soft.png")
bpy.ops.render.render(write_still=True)
toonify()
scene.render.filepath = os.path.join(OUT, "zapi_l4_toon.png")
bpy.ops.render.render(write_still=True)
print("done")
