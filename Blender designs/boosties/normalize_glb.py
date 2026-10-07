"""Scale a generated mesh so its longest side is 1.0, the size TRELLIS outputs.

Meshy's models come out about twice as big. measure.py's grids and build_boostie.py's
settings (voxel size, bone radii, eye and mouth offsets) all assume the TRELLIS size,
so normalise every Meshy mesh once, before measuring:

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
    --python normalize_glb.py -- sources/meshy/zapi_l3_4view.glb sources/zapi_l3_meshy.glb

The model stays centred where the generator put it; only the scale changes.
"""
import sys

import bpy
from mathutils import Matrix, Vector

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
size = max(max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3))
k = 1.0 / size
for o in bpy.context.scene.objects:
    if o.parent is None:
        o.matrix_world = Matrix.Scale(k, 4) @ o.matrix_world
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_apply=True)
print(f"normalised {src} -> {dst}: scale {k:.4f} (longest side was {size:.3f})")
