"""
Turn flat PNG icons (achievements / avatars) into animatable 2.5D "inflated relief" models.

Run headless (does not touch any open Blender session):
  blender -b --factory-startup --python build_relief.py -- <out_dir> <png> [<png> ...]

For every PNG it writes into <out_dir>/<category>/:
  <name>.blend    editable scene (root empty + mesh + camera/lights, animations as NLA tracks)
  <name>.glb      web-ready model with animation clips: idle, reveal, celebrate
  <name>.png      preview render (transparent background)
  <name>_tex.png  the colour-bled texture used by the model
"""
import bpy, bmesh, sys, os, math, json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from neck import find_neck  # noqa: E402  (shared with offline checks)

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "neck_overrides.json"), encoding="utf-8") as _fh:
    NECK_OVERRIDES = {k: v for k, v in json.load(_fh).items() if not k.startswith("_")}

# ---------------------------------------------------------------- tunables
GRID = 180            # vertices along the long side of the image
WORLD = 2.0           # model size (world units) along the long side
EDGE_DEPTH = 0.10     # height of the rounded rim
EDGE_RADIUS = 0.07    # rim rounding radius, as a fraction of the long side
DOME_DEPTH = 0.14     # extra bulge towards the centre of each shape
DETAIL_DEPTH = 0.022  # emboss from image luminance
BACK_SCALE = 0.55     # back side is flatter than the front
MIN_ISLAND = 40       # drop islands (sparkles) smaller than this many cells
FPS = 30


# ---------------------------------------------------------------- image helpers
def load_rgba(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "sRGB"
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)  # row 0 = bottom (Blender convention)


def remove_flat_background(rgba, tol=0.12):
    """Source has no transparency: flood-fill the border colour away (e.g. a white card behind the art)."""
    if (rgba[..., 3] < 0.5).mean() > 0.02:
        return rgba
    h, w = rgba.shape[:2]
    edge = np.concatenate([rgba[0, :, :3], rgba[-1, :, :3], rgba[:, 0, :3], rgba[:, -1, :3]])
    bg = np.median(edge, axis=0)
    near = np.abs(rgba[..., :3] - bg).max(-1) < tol
    reach = np.zeros((h, w), bool)
    reach[0] = near[0]; reach[-1] = near[-1]; reach[:, 0] = near[:, 0]; reach[:, -1] = near[:, -1]
    while True:
        p = np.pad(reach, 1)
        grown = near & (p[2:, 1:-1] | p[:-2, 1:-1] | p[1:-1, 2:] | p[1:-1, :-2] | reach)
        if (grown == reach).all():
            break
        reach = grown
    out = rgba.copy()
    out[..., 3] = np.where(reach, 0.0, out[..., 3])
    print(f"[relief]   removed flat background {np.round(bg, 2)} ({reach.mean():.0%} of pixels)")
    return out


def crop_to_content(rgba, pad_frac=0.04):
    """Returns (cropped, (x0, y0)) — offset of the crop inside the original, bottom-origin pixels."""
    ys, xs = np.nonzero(rgba[..., 3] > 0.5)
    if not len(ys):
        return rgba, (0, 0)
    h, w = rgba.shape[:2]
    pad = int(pad_frac * max(np.ptp(ys), np.ptp(xs))) + 2
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad + 1)
    return rgba[y0:y1, x0:x1].copy(), (int(x0), int(y0))


def box_blur(a, r):
    if r < 1:
        return a
    k = 2 * r + 1
    p = np.pad(a, ((r + 1, r), (r + 1, r)), mode="edge")
    c = p.cumsum(0).cumsum(1)
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def bleed_colors(rgba, iters=24):
    """Push opaque colours outward into transparent pixels so mesh edges never pick up dark fringe."""
    rgb = rgba[..., :3].copy()
    a = rgba[..., 3]
    known = a > 0.5
    rgb[~known] = 0
    w = known.astype(np.float32)
    for _ in range(iters):
        if known.all():
            break
        s = np.zeros_like(rgb); n = np.zeros_like(w)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            s += np.roll(np.roll(rgb * w[..., None], dy, 0), dx, 1)
            n += np.roll(np.roll(w, dy, 0), dx, 1)
        grow = (~known) & (n > 0)
        rgb[grow] = s[grow] / n[grow][:, None]
        known = known | grow
        w = known.astype(np.float32)
    out = np.dstack([rgb, np.ones_like(a)])
    return out


def sample_grid(arr, gw, gh):
    """Box-average a 2D array onto a gw x gh grid of points."""
    h, w = arr.shape
    r = max(1, int(round(max(w / gw, h / gh) / 2)))
    b = box_blur(arr, r)
    ys = np.clip(np.round(np.linspace(0, h - 1, gh)).astype(int), 0, h - 1)
    xs = np.clip(np.round(np.linspace(0, w - 1, gw)).astype(int), 0, w - 1)
    return b[np.ix_(ys, xs)]


# ---------------------------------------------------------------- mask helpers
def label_components(mask):
    h, w = mask.shape
    lab = np.zeros((h, w), dtype=np.int32)
    sizes = [0]
    cur = 0
    for y0 in range(h):
        for x0 in range(w):
            if mask[y0, x0] and not lab[y0, x0]:
                cur += 1
                stack = [(y0, x0)]; lab[y0, x0] = cur; n = 0
                while stack:
                    y, x = stack.pop(); n += 1
                    for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                        if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                            lab[yy, xx] = cur; stack.append((yy, xx))
                sizes.append(n)
    return lab, np.array(sizes)


def clean_mask(mask):
    lab, sizes = label_components(mask)
    keep = sizes >= max(MIN_ISLAND, 0.004 * sizes[1:].max() if len(sizes) > 1 else 0)
    keep[0] = False
    mask = keep[lab]
    # fill small holes
    hl, hs = label_components(~mask)
    border = set(np.unique(np.concatenate([hl[0], hl[-1], hl[:, 0], hl[:, -1]])))
    for i in range(1, len(hs)):
        if i not in border and hs[i] < MIN_ISLAND:
            mask[hl == i] = True
    return mask


def distance(mask):
    """Approximate Euclidean distance-to-edge via alternating 4/8-neighbour erosion."""
    d = np.zeros(mask.shape, dtype=np.float32)
    cur = mask.copy(); step = 0
    while cur.any():
        step += 1
        d[cur] = step
        p = np.pad(cur, 1)
        e = p[1:-1, 1:-1] & p[2:, 1:-1] & p[:-2, 1:-1] & p[1:-1, 2:] & p[1:-1, :-2]
        if step % 2 == 0:
            e &= p[2:, 2:] & p[:-2, :-2] & p[2:, :-2] & p[:-2, 2:]
        cur = e
    return d * 0.92  # alternating erosion slightly overestimates


# ---------------------------------------------------------------- mesh build
def build_mesh(name, rgba):
    H, W = rgba.shape[:2]
    long_side = max(W, H)
    gw = max(8, int(round(GRID * W / long_side)))
    gh = max(8, int(round(GRID * H / long_side)))
    sx = WORLD * W / long_side; sy = WORLD * H / long_side

    alpha = sample_grid(rgba[..., 3], gw, gh)
    lum = rgba[..., 0] * 0.3 + rgba[..., 1] * 0.59 + rgba[..., 2] * 0.11
    lum_g = box_blur(sample_grid(lum, gw, gh), 1)
    mask = clean_mask(alpha > 0.5)
    mask[0, :] = mask[-1, :] = mask[:, 0] = mask[:, -1] = False
    d = distance(mask)

    cell = WORLD / (GRID - 1)
    R = EDGE_RADIUS * GRID
    t = np.clip(d / R, 0, 1)
    rim = np.sqrt(np.clip(1 - (1 - t) ** 2, 0, 1))
    # dome: per-component normalised so small parts still get a bulge
    lab, _ = label_components(mask)
    dome = np.zeros_like(d)
    for i in np.unique(lab[lab > 0]):
        m = lab == i
        dome[m] = (d[m] / d[m].max()) ** 0.8 * min(1.0, d[m].max() / (0.25 * GRID))
    hp = lum_g - box_blur(lum_g, max(2, GRID // 30))
    hp = np.clip(hp, -0.25, 0.25) * t
    height = EDGE_DEPTH * rim + DOME_DEPTH * dome + DETAIL_DEPTH * hp * 4

    xs = np.linspace(-sx / 2, sx / 2, gw)
    ys = np.linspace(-sy / 2, sy / 2, gh)

    bm = bmesh.new()
    vid = -np.ones((gh, gw), dtype=np.int64)
    verts = []
    # a vertex exists wherever any adjacent quad is fully inside the mask
    quad = mask[:-1, :-1] & mask[1:, :-1] & mask[:-1, 1:] & mask[1:, 1:]
    used = np.zeros_like(mask)
    used[:-1, :-1] |= quad; used[1:, :-1] |= quad; used[:-1, 1:] |= quad; used[1:, 1:] |= quad
    for y, x in zip(*np.nonzero(used)):
        vid[y, x] = len(verts)
        verts.append(bm.verts.new((xs[x], ys[y], float(height[y, x]))))
    bm.verts.ensure_lookup_table()
    for y, x in zip(*np.nonzero(quad)):
        bm.faces.new((verts[vid[y, x]], verts[vid[y, x + 1]], verts[vid[y + 1, x + 1]], verts[vid[y + 1, x]]))

    # fix non-manifold "bow-tie" vertices by removing faces that only touch diagonally
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges[:])

    # smooth the staircase outline (XY only) and pin the boundary to z=0
    boundary = [v for v in bm.verts if v.is_boundary]
    bset = set(boundary)
    for _ in range(6):
        new = {}
        for v in boundary:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary and e.other_vert(v) in bset]
            if len(nb) == 2:
                new[v] = ((v.co.x * 2 + nb[0].co.x + nb[1].co.x) / 4, (v.co.y * 2 + nb[0].co.y + nb[1].co.y) / 4)
        for v, (x, y) in new.items():
            v.co.x, v.co.y = x, y
    for v in boundary:
        v.co.z = 0.0
    # relax the first interior ring so the rim does not crease
    ring = {e.other_vert(v) for v in boundary for e in v.link_edges} - bset
    for v in ring:
        nb = [e.other_vert(v) for e in v.link_edges]
        v.co.z = 0.5 * v.co.z + 0.5 * sum(n.co.z for n in nb) / len(nb)

    # back side: duplicate, flatten, flip, weld along the outline
    front_faces = bm.faces[:]
    dup = bmesh.ops.duplicate(bm, geom=front_faces)
    back_verts = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMVert)]
    back_faces = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMFace)]
    for v in back_verts:
        v.co.z = -v.co.z * BACK_SCALE
    bmesh.ops.reverse_faces(bm, faces=back_faces)
    edge_verts = [v for v in bm.verts if v.is_boundary]
    bmesh.ops.remove_doubles(bm, verts=edge_verts, dist=cell * 0.01)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    # material index: 0 front, 1 back
    for f in back_faces:
        if f.is_valid:
            f.material_index = 1

    # planar UVs (front view)
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for l in f.loops:
            l[uv].uv = (l.vert.co.x / sx + 0.5, l.vert.co.y / sy + 0.5)

    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    return obj, (sx, sy)


# ---------------------------------------------------------------- material
def make_material(name, tex_path, back=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(tex_path, check_existing=True)
    tex.interpolation = "Linear"
    tex.location = (-500, 200)
    col = tex.outputs["Color"]
    if back:
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["B"].default_value = (0.45, 0.45, 0.5, 1)
        nt.links.new(col, mix.inputs["A"])
        col = mix.outputs["Result"]
    nt.links.new(col, bsdf.inputs["Base Color"])
    nt.links.new(col, bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 0.0 if back else 0.28
    bsdf.inputs["Roughness"].default_value = 0.42
    return mat


# ---------------------------------------------------------------- animation
def key(obj, frame, loc=None, rot=None, scl=None, interp="BEZIER"):
    if loc is not None:
        obj.location = loc; obj.keyframe_insert("location", frame=frame)
    if rot is not None:
        obj.rotation_euler = [math.radians(a) for a in rot]; obj.keyframe_insert("rotation_euler", frame=frame)
    if scl is not None:
        obj.scale = scl if isinstance(scl, (tuple, list)) else (scl, scl, scl)
        obj.keyframe_insert("scale", frame=frame)


def new_clip(obj, name, build, cyclic=False):
    obj.animation_data_create()
    obj.animation_data.action = None
    obj.location = (0, 0, 0); obj.rotation_euler = (0, 0, 0); obj.scale = (1, 1, 1)
    build(obj)
    act = obj.animation_data.action
    act.name = name
    act.use_fake_user = True
    if cyclic:
        for fc in iter_fcurves(act):
            fc.modifiers.new("CYCLES")
    track = obj.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, int(act.frame_range[0]), act)
    track.mute = True
    obj.animation_data.action = None
    return act


def iter_fcurves(act):
    if hasattr(act, "layers") and len(act.layers):
        for layer in act.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    yield from bag.fcurves
    else:
        yield from act.fcurves


def build_animations(root):
    # idle: gentle float + sway, loops over 4 s
    def idle(o):
        # (frame, lift, turn about vertical, tilt in picture plane)
        for f, z, turn, tilt in ((1, 0, -10, 1.5), (31, 0.05, 0, 0), (61, 0, 10, -1.5), (91, 0.05, 0, 0), (121, 0, -10, 1.5)):
            key(o, f, loc=(0, 0, z), rot=(90, tilt, turn), scl=1)
    # reveal: spins in from nothing, overshoots, settles (1.6 s)
    def reveal(o):
        key(o, 1, loc=(0, 0, -0.3), rot=(90, 0, -540), scl=0.01)
        key(o, 26, loc=(0, 0, 0.08), rot=(90, 0, -20), scl=1.18)
        key(o, 38, loc=(0, 0, 0), rot=(90, 0, 6), scl=0.95)
        key(o, 48, loc=(0, 0, 0), rot=(90, 0, 0), scl=1.0)
    # celebrate (root-local axes: X width, Y height, Z depth): squash, jump with full turn, land (1.2 s)
    def celebrate(o):
        key(o, 1, loc=(0, 0, 0), rot=(90, 0, 0), scl=(1, 1, 1))
        key(o, 7, loc=(0, 0, -0.04), rot=(90, 0, 0), scl=(1.15, 0.82, 1))
        key(o, 20, loc=(0, 0, 0.45), rot=(90, 0, 180), scl=(0.92, 1.12, 1))
        key(o, 30, loc=(0, 0, 0), rot=(90, 0, 360), scl=(1.12, 0.86, 1))
        key(o, 33, loc=(0, 0, 0), rot=(90, 0, 360), scl=(0.97, 1.03, 1))
        key(o, 37, loc=(0, 0, 0), rot=(90, 0, 360), scl=(1, 1, 1))
    new_clip(root, "idle", idle, cyclic=True)
    new_clip(root, "reveal", reveal)
    new_clip(root, "celebrate", celebrate)
    root.rotation_euler = (math.radians(90), 0, 0)
    # leave idle active so the .blend plays something on open
    root.animation_data.action = bpy.data.actions["idle"]
    if hasattr(root.animation_data, "action_slot") and root.animation_data.action_suitable_slots:
        root.animation_data.action_slot = root.animation_data.action_suitable_slots[0]


# ---------------------------------------------------------------- scene
def aim(obj, target=(0, 0, 0)):
    from mathutils import Vector
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_scene(size_xy):
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, 120
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = 512
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        pass
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("World"); sc.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.85, 0.87, 0.95, 1); bg.inputs["Strength"].default_value = 0.6

    cam_d = bpy.data.cameras.new("Camera"); cam_d.type = "ORTHO"
    cam_d.ortho_scale = max(size_xy) * 1.25
    cam = bpy.data.objects.new("Camera", cam_d); sc.collection.objects.link(cam)
    cam.location = (0.9, -6, 0.5)
    aim(cam)
    sc.camera = cam
    for nm, loc, e, energy in (("Key", (-3, -4, 4), None, 4.0), ("Rim", (3, 3, 2), None, 3.0)):
        ld = bpy.data.lights.new(nm, "SUN"); ld.energy = energy
        lo = bpy.data.objects.new(nm, ld); sc.collection.objects.link(lo)
        lo.location = loc
        aim(lo)


# ---------------------------------------------------------------- bust rig
def add_bust_rig(name, obj, root, alpha, size_xy, neck_rf=None):
    """2-bone rig (chest -> head) with a soft neck blend, so busts can nod, tilt, lean and breathe.
    neck_rf: optional neck height override as a fraction of the cropped image height."""
    sx, sy = size_xy
    rf, cf = find_neck(alpha)
    if neck_rf is not None:
        rf = neck_rf
    ny, cx = (rf - 0.5) * sy, (cf - 0.5) * sx
    sc = bpy.context.scene
    arm = bpy.data.armatures.new(name + "_rig")
    ao = bpy.data.objects.new(name + "_rig", arm)
    sc.collection.objects.link(ao)
    ao.parent = root
    bpy.context.view_layer.objects.active = ao
    bpy.ops.object.mode_set(mode="EDIT")
    chest = arm.edit_bones.new("chest"); chest.head = (cx, -sy / 2, 0); chest.tail = (cx, ny, 0)
    head = arm.edit_bones.new("head"); head.head = (cx, ny, 0); head.tail = (cx, sy / 2, 0)
    head.parent = chest; head.use_connect = True
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.parent = ao
    mod = obj.modifiers.new("Rig", "ARMATURE"); mod.object = ao
    g_chest = obj.vertex_groups.new(name="chest"); g_head = obj.vertex_groups.new(name="head")
    blend = 0.07 * sy
    for v in obj.data.vertices:
        t = min(1.0, max(0.0, (v.co.y - (ny - blend)) / (2 * blend)))
        wh = t * t * (3 - 2 * t)
        if wh > 0:
            g_head.add([v.index], wh, "REPLACE")
        if wh < 1:
            g_chest.add([v.index], 1 - wh, "REPLACE")
    for pb in ao.pose.bones:
        pb.rotation_mode = "XYZ"
    print(f"[relief]   neck at {rf:.2f} height")
    return ao


# ---------------------------------------------------------------- pose atlas
# (name, axis, value). Bust poses use the rig; object poses (achievements) turn + light sweep.
BUST_POSES = ([("rest", None, 0)]
              + [(f"yaw{v:+d}", "yaw", v) for v in (-12, -8, -4, 4, 8, 12)]
              + [(f"lean{v:+d}", "lean", v) for v in (-5, 5, 10)]
              + [(f"nod{v:+d}", "nod", v) for v in (6, 12)]
              + [(f"tilt{v:+d}", "tilt", v) for v in (-7, 7)]
              + [(f"breath{v:+d}", "breath", v) for v in (1, 2)])
OBJECT_POSES = ([("rest", None, 0)]
                + [(f"yaw{v:+d}", "yaw", v) for v in (-30, -25, -20, -15, -10, -5, 5, 10, 15, 20, 25, 30)]
                + [(f"sweep{v:+d}", "sweep", v) for v in range(1, 9)])
CELL_BUST, CELL_OBJECT = 320, 384


def add_sweep(mat, size_xy):
    """Diagonal metallic highlight that bends over the relief (normal term). Driven by node 'SWEEP_T'."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    sx, sy = size_xy
    N = lambda t, **kw: nt.nodes.new(t)
    tc = N("ShaderNodeTexCoord"); sep = N("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["Object"], sep.inputs[0])
    geo = N("ShaderNodeNewGeometry"); sepn = N("ShaderNodeSeparateXYZ"); nt.links.new(geo.outputs["Normal"], sepn.inputs[0])

    def math(op, a, b):
        m = N("ShaderNodeMath"); m.operation = op
        for i, v in enumerate((a, b)):
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                nt.links.new(v, m.inputs[i])
        return m.outputs[0]
    u = math("ADD", math("MULTIPLY", sep.outputs["X"], 0.5 / sx), math("MULTIPLY", sep.outputs["Y"], 0.5 / sy))
    u = math("ADD", u, math("MULTIPLY", sepn.outputs["X"], 0.12))
    u = math("ADD", u, 0.5)   # object coords are centred: shift the diagonal into 0..1
    t = N("ShaderNodeValue"); t.name = t.label = "SWEEP_T"; t.outputs[0].default_value = -9
    d = math("ABSOLUTE", math("SUBTRACT", u, t.outputs[0]), 0)
    band = math("POWER", math("MAXIMUM", math("SUBTRACT", 1.0, math("DIVIDE", d, 0.16)), 0.0), 2.0)
    add = N("ShaderNodeMix"); add.data_type = "RGBA"; add.blend_type = "ADD"
    nt.links.new(band, add.inputs["Factor"])
    nt.links.new(tex.outputs["Color"], add.inputs["A"])
    add.inputs["B"].default_value = (1.0, 0.95, 0.8, 1)
    nt.links.new(add.outputs["Result"], bsdf.inputs["Emission Color"])
    # boost emission only inside the band so the rest of the frame stays identical to 'rest'
    es = math("ADD", 0.28, math("MULTIPLY", band, 1.6))
    nt.links.new(es, bsdf.inputs["Emission Strength"])
    return t


def render_atlas(name, root, rig, obj, orig_size, crop_off, crop_size, size_xy, kind, frames_dir, source):
    sc = bpy.context.scene
    W, H = orig_size
    k = WORLD / max(crop_size)                  # world units per source pixel
    cw, ch = crop_size
    dx = (W / 2 - (crop_off[0] + cw / 2)) * k
    dy = (H / 2 - (crop_off[1] + ch / 2)) * k
    cell_long = CELL_BUST if kind == "bust" else CELL_OBJECT
    sc.render.resolution_x = max(8, round(cell_long * W / max(W, H)))
    sc.render.resolution_y = max(8, round(cell_long * H / max(W, H)))
    sc.render.resolution_percentage = 100
    # front camera framing the ORIGINAL image rectangle, so frame 'rest' lines up with the source PNG
    cam = sc.camera
    cam.data.ortho_scale = max(W, H) * k
    cam.data.clip_end = 100
    cam.location = (dx, -10, dy); cam.rotation_euler = (math.radians(90), 0, 0)
    root.animation_data.action = None
    for tr in root.animation_data.nla_tracks:
        tr.mute = True
    sweep_t = add_sweep(obj.data.materials[0], size_xy) if kind == "object" else None
    poses = BUST_POSES if kind == "bust" else OBJECT_POSES
    os.makedirs(frames_dir, exist_ok=True)
    out = []
    for i, (pname, axis, v) in enumerate(poses):
        root.location = (0, 0, 0); root.scale = (1, 1, 1)
        root.rotation_euler = (math.radians(90), 0, math.radians(v) if axis == "yaw" else 0)
        if rig:
            pc, ph = rig.pose.bones["chest"], rig.pose.bones["head"]
            pc.rotation_euler = (math.radians(v) if axis == "lean" else 0, 0, 0)
            ph.rotation_euler = (math.radians(v) if axis == "nod" else 0, 0, math.radians(v) if axis == "tilt" else 0)
            s = 1 + 0.015 * v if axis == "breath" else 1
            pc.scale = (s, 1 + (s - 1) * 0.4, s)
            ph.scale = (1 / s, 1 / (1 + (s - 1) * 0.4), 1 / s)   # keep the head its own size
        if sweep_t:
            sweep_t.outputs[0].default_value = (0.08 + 0.86 * (v - 1) / 7) if axis == "sweep" else -9
        sc.render.filepath = os.path.join(frames_dir, f"{i:02d}_{pname}.png")
        bpy.ops.render.render(write_still=True)
        out.append({"name": pname, "axis": axis, "value": v, "file": f"{i:02d}_{pname}.png"})
    meta = {"source": source, "kind": kind, "cell": [sc.render.resolution_x, sc.render.resolution_y], "frames": out}
    with open(os.path.join(frames_dir, "frames.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)


def process(png, out_root, atlas=False):
    category = os.path.basename(os.path.dirname(png))
    name = os.path.splitext(os.path.basename(png))[0]
    out_dir = os.path.join(out_root, category)
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    src = remove_flat_background(load_rgba(png))
    rgba, crop_off = crop_to_content(src)
    kind = "object" if category == "achievements" else "bust"
    tex_path = os.path.join(out_dir, f"{name}_tex.png")
    bled = bleed_colors(rgba)
    ti = bpy.data.images.new(name + "_tex", rgba.shape[1], rgba.shape[0], alpha=False)
    ti.pixels.foreach_set(bled.ravel()); ti.filepath_raw = tex_path; ti.file_format = "PNG"; ti.save()
    bpy.data.images.remove(ti)

    obj, size_xy = build_mesh(name, rgba)
    obj.data.materials.append(make_material(name + "_front", tex_path))
    obj.data.materials.append(make_material(name + "_back", tex_path, back=True))
    sc = bpy.context.scene
    root = bpy.data.objects.new(name + "_root", None)
    root.empty_display_type = "PLAIN_AXES"; root.empty_display_size = 0.3
    sc.collection.objects.link(root); sc.collection.objects.link(obj)
    obj.parent = root  # mesh lives in root's local XY; root is rotated upright
    rig = None
    if kind == "bust":
        ov = NECK_OVERRIDES.get(name)   # fraction of the ORIGINAL image height -> cropped
        neck_rf = None if ov is None else (ov * src.shape[0] - crop_off[1]) / rgba.shape[0]
        rig = add_bust_rig(name, obj, root, rgba[..., 3], size_xy, neck_rf)
    build_animations(root)
    setup_scene(size_xy)

    sc.frame_set(1)
    sc.render.filepath = os.path.join(out_dir, f"{name}.png")
    bpy.ops.render.render(write_still=True)

    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, f"{name}.blend"))
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out_dir, f"{name}.glb"),
        export_format="GLB", use_selection=False, export_cameras=False, export_lights=False,
        export_animations=True, export_animation_mode="NLA_TRACKS",
        export_image_format="JPEG", export_jpeg_quality=88,
    )
    if atlas:
        render_atlas(name, root, rig, obj, (src.shape[1], src.shape[0]), crop_off,
                     (rgba.shape[1], rgba.shape[0]), size_xy, kind,
                     os.path.join(out_dir, f"{name}_frames"), png)
    print(f"[relief] OK {category}/{name}  faces={len(obj.data.polygons)}")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:]
    # args may be PNG files, directories (recursed), or "@list.txt" (UTF-8, one path per line)
    out_root = os.path.abspath(argv[0])
    atlas = "--atlas" in argv   # also render pose-atlas frames (see pack_atlas.py)
    pngs = []
    for a in argv[1:]:
        if a == "--atlas":
            continue
        if a.startswith("@"):
            with open(a[1:], encoding="utf-8") as fh:
                pngs += [l.strip() for l in fh if l.strip()]
        elif os.path.isdir(a):
            for dp, _, fns in os.walk(a):
                pngs += [os.path.join(dp, f) for f in sorted(fns) if f.lower().endswith(".png")]
        else:
            pngs.append(a)
    pngs = [os.path.abspath(p) for p in pngs]
    failed = []
    for p in pngs:
        try:
            process(p, out_root, atlas=atlas)
        except Exception as e:
            import traceback; traceback.print_exc()
            failed.append(p)
    print(f"[relief] done {len(pngs) - len(failed)}/{len(pngs)}; failed: {failed}")
