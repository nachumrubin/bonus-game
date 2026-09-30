import bpy, sys, math
out = sys.argv[sys.argv.index("--")+1]
sc = bpy.context.scene
root = next(o for o in sc.objects if o.name.endswith("_root"))
root.animation_data.action = None
root.rotation_euler = (math.radians(90), 0, math.radians(60))
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
