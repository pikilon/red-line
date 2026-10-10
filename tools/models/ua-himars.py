"""ua-himars: 6x6 truck, cab front, elevated launcher pod turret on the rear (spec 06)."""

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 0.60 wide (x), 0.70 high (z), 1.20 long (y); front is -Y.
wheel_r, wheel_w, half_track = 0.1, 0.09, 0.235
wheels = lib.wheels("wheels", 3, wheel_r, wheel_w, 0.72, half_track, wheel_r, m["dark"])
chassis = lib.box("chassis", (0.42, 1.02, 0.14), (0, 0.0, 0.25), m["body"])
cab = lib.box("cab", (0.46, 0.3, 0.28), (0, -0.36, 0.4), m["body"])
windshield = lib.box("windshield", (0.4, 0.03, 0.12), (0, -0.51, 0.45), m["dark"])
hood = lib.box("hood", (0.42, 0.12, 0.1), (0, -0.51, 0.3), m["body"])
bed = lib.box("bed", (0.48, 0.56, 0.08), (0, 0.24, 0.32), m["body"])
panels = lib.join(
    [lib.box(f"panel_{s}", (0.02, 0.18, 0.08), (s * 0.24, -0.36, 0.4), m["team"]) for s in (-1, 1)],
    "panels",
)
root = lib.join([chassis, cab, windshield, hood, bed, panels, wheels], "ua-himars")

# The launcher pod is the turret: built flat around a hinge, then elevated and
# baked so the exported turret node has no rotation of its own (the client yaws it).
pod = lib.box("pod", (0.5, 0.34, 0.18), (0, 0.17, 0.09), m["body"])
tubes = lib.join(
    [
        lib.cylinder(f"tube_{i}_{j}", 0.032, 0.06, (x, 0.32, z), m["dark"], 8, "Y")
        for i, x in enumerate((-0.15, 0, 0.15))
        for j, z in enumerate((0.05, 0.13))
    ],
    "tubes",
)
stripe = lib.box("pod_stripe", (0.5, 0.06, 0.03), (0, 0.08, 0.18), m["team"])
assembly = lib.join([pod, tubes, stripe], "pod_assembly")
bpy.context.scene.cursor.location = (0, 0, 0)
bpy.ops.object.select_all(action="DESELECT")
assembly.select_set(True)
bpy.context.view_layer.objects.active = assembly
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
assembly.location = (0, 0.14, 0.28)
assembly.rotation_euler = (math.radians(60), 0, 0)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)

pivot = (0, 0.14, 0.28)
turret = lib.turret([assembly], pivot)
lib.parent(turret, root)

lib.export("ua-himars", root)
