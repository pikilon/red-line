"""ua-patriot: towed launcher with four big square canisters, dug in (spec 43)."""

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drones  # noqa: E402
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box (footprint 3x3): 3.00 wide (x), 1.60 high (z), 3.00 deep (y); front is -Y.
pad = lib.box("pad", (2.9, 2.9, 0.05), (0, 0, 0.025), dark)
chassis = lib.box("chassis", (0.66, 2.1, 0.12), (0, 0.1, 0.36), body)
neck = lib.box("gooseneck", (0.3, 0.5, 0.1), (0, -1.1, 0.42), body)
wheels = lib.join(
    [lib.cylinder(f"wheel_{s}_{y}", 0.17, 0.14, (s * 0.36, y, 0.22), dark, 10, "X") for s in (-1, 1) for y in (0.5, 0.85)],
    "wheels",
)
generator = lib.box("generator", (0.56, 0.42, 0.34), (0, -0.72, 0.59), body)
vent = lib.box("vent", (0.4, 0.3, 0.02), (0, -0.72, 0.77), dark, bevel=0)
team_panels = lib.join(
    [lib.box(f"panel_{s}", (0.02, 0.28, 0.2), (s * 0.285, -0.72, 0.58), team, bevel=0) for s in (-1, 1)], "panels"
)
# Outrigger jacks.
jacks = []
for i, (x, y) in enumerate(((-0.62, -0.5), (0.62, -0.5), (-0.62, 0.95), (0.62, 0.95))):
    jacks.append(infantry.rod(f"jack_{i}", 0.02, (x * 0.5, y, 0.36), (x, y, 0.09), dark))
    jacks.append(lib.box(f"jack_foot_{i}", (0.18, 0.18, 0.04), (x, y, 0.07), dark, bevel=0))
# Sandbag berm on two sides, hastily stacked, and a generator cable mast.
bags = drones.row("bag_back", 8, (0.34, 0.26, 0.2), (-1.2, 1.32, 0.15), (0.34, 0, 0), body)
bags += drones.row("bag_back_hi", 6, (0.34, 0.26, 0.17), (-0.9, 1.32, 0.33), (0.34, 0, 0), body)
bags += drones.row("bag_left", 7, (0.26, 0.34, 0.2), (-1.32, -1.0, 0.15), (0, 0.34, 0), body)
bags += drones.row("bag_right", 3, (0.26, 0.34, 0.2), (1.32, 0.4, 0.15), (0, 0.34, 0), body)
mast = infantry.rod("mast", 0.015, (1.1, -1.1, 0.05), (1.1, -1.1, 1.2), dark)
dish = lib.box("mast_panel", (0.2, 0.03, 0.26), (1.1, -1.12, 1.2), body, bevel=0)
root = lib.join([pad, chassis, neck, wheels, generator, vent, team_panels, *jacks, *bags, mast, dish], "ua-patriot")

# Launcher bed: built flat around its rear hinge pointing -Y, then raised and baked
# so the exported turret node has no rotation of its own (the client yaws it).
side, gap, length = 0.28, 0.02, 1.22
cans = []
for i, x in enumerate((-(side + gap) / 2, (side + gap) / 2)):
    for j, z in enumerate((side / 2, side * 1.5 + gap)):
        cans.append(lib.box(f"can_{i}_{j}", (side, length, side), (x, -length / 2, z), body))
        cans.append(lib.box(f"can_face_{i}_{j}", (side - 0.06, 0.012, side - 0.06), (x, -length - 0.002, z), dark, bevel=0))
total = 2 * side + gap
band = lib.box("can_band", (total + 0.02, 0.2, total + 0.02), (0, -length + 0.3, total / 2), team, bevel=0)
hinge = 0.62
bed = lib.join([*cans, band], "launcher")
bpy.context.scene.cursor.location = (0, 0, 0)
bpy.ops.object.select_all(action="DESELECT")
bed.select_set(True)
bpy.context.view_layer.objects.active = bed
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bed.location = (0, hinge, 0.5)
bed.rotation_euler = (math.radians(-30), 0, 0)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)

pivot = (0, 0.1, 0.42)
ring = lib.cylinder("ring", 0.4, 0.08, (0, 0.1, 0.46), dark, 12, "Z", bevel=0)
cradle = lib.box("cradle", (0.7, 0.86, 0.1), (0, 0.2, 0.52), body)
struts = [infantry.rod(f"strut_{s}", 0.03, (s * 0.26, -0.05, 0.54), (s * 0.26, 0.0, 0.85), dark) for s in (-1, 1)]
turret = lib.turret([ring, cradle, bed, *struts], pivot)
lib.parent(turret, root)

lib.export("ua-patriot", root)
