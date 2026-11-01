"""ru-pole-21: MT-LB tracked box with one huge slab antenna on a mast (spec 43 §4.6)."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import airframe  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 0.75 wide (x), 1.10 high (z), 1.10 long (y); front is -Y.
track_w, track_h, half_track = 0.16, 0.14, 0.29
tracks = lib.tracks("tracks", 1.04, track_w, track_h, half_track, dark)
roadwheels = lib.wheels("roadwheels", 6, 0.06, track_w, 0.9, half_track, 0.07, dark)
hull = lib.wedge("hull", (0.56, 1.08, 0.2), (0, 0.0, 0.22), body, slope=0.2)
cab = lib.box("cab", (0.5, 0.3, 0.14), (0, -0.28, 0.38), body)
hatch = lib.box("visors", (0.42, 0.03, 0.05), (0, -0.43, 0.39), dark)
shelter = lib.box("shelter", (0.5, 0.56, 0.2), (0, 0.22, 0.41), body)
generator = lib.box("generator", (0.3, 0.2, 0.07), (0, 0.38, 0.54), dark)
skirts = lib.join(
    [lib.box(f"skirt_{s}", (0.03, 0.96, 0.09), (s * 0.355, 0.0, 0.22), team, bevel=0) for s in (-1, 1)],
    "skirts",
)
whips = lib.join(
    [lib.cylinder(f"whip_{s}", 0.008, 0.34, (s * 0.2, -0.3, 0.6), dark, 4, bevel=0) for s in (-1, 1)],
    "whips",
)
mast = lib.cylinder("mast", 0.04, 0.5, (0, 0.14, 0.72), dark, 8, bevel=0)
stays = lib.join(
    [lib.box(f"stay_{s}", (0.02, 0.02, 0.26), (s * 0.08, 0.14, 0.62), body, bevel=0) for s in (-1, 1)],
    "stays",
)
# The slab leans back so the black face reads from the RTS camera, not just its top edge.
slab_centre = (0, 0.14, 0.82)
slab = lib.box("antenna", (0.72, 0.05, 0.5), slab_centre, dark, bevel=0)
ribs = [lib.box(f"rib_{i}", (0.012, 0.02, 0.46), (x, 0.11, 0.82), body, bevel=0) for i, x in enumerate((-0.24, 0.0, 0.24))]
frame = lib.box("frame_top", (0.74, 0.07, 0.05), (0, 0.14, 1.07), team, bevel=0)
foot = lib.box("frame_foot", (0.74, 0.07, 0.04), (0, 0.14, 0.57), body, bevel=0)
panel = airframe.pitch(lib.join([slab, *ribs, frame, foot], "panel"), math.radians(-14), slab_centre)
root = lib.join([hull, tracks, roadwheels, cab, hatch, shelter, generator, skirts, whips, mast, stays, panel], "ru-pole-21")

lib.export("ru-pole-21", root)
