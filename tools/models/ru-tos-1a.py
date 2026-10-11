"""ru-tos-1a: T-72 chassis carrying a large boxy rocket launcher block (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 0.80 wide (x), 0.70 high (z), 1.25 long (y); front is -Y.
track_w, track_h, half_track = 0.18, 0.16, 0.31
hull_len = 0.98
tracks = lib.tracks("tracks", hull_len, track_w, track_h, half_track, m["dark"])
wheels = lib.wheels("roadwheels", 6, 0.07, track_w, hull_len - 0.16, half_track, 0.08, m["dark"])
hull = lib.wedge("hull", (0.62, hull_len, 0.14), (0, 0.12, 0.2), m["body"], slope=0.25)
skirts = lib.join(
    [lib.box(f"skirt_{s}", (0.03, hull_len - 0.1, 0.08), (s * 0.385, 0.07, 0.2), m["team"]) for s in (-1, 1)],
    "skirts",
)
fuel = lib.join(
    [lib.cylinder(f"drum_{s}", 0.05, 0.16, (s * 0.2, 0.55, 0.27), m["dark"], 8, "X") for s in (-1, 1)],
    "fuel_drums",
)
root = lib.join([hull, tracks, wheels, skirts, fuel], "ru-tos-1a")

pivot = (0, 0.1, 0.27)
block = lib.box("launcher_block", (0.62, 0.84, 0.3), (0, 0.14, 0.44), m["body"])
cap = lib.box("launcher_cap", (0.5, 0.06, 0.22), (0, 0.55, 0.46), m["body"])
tubes = []
for row, z in enumerate((0.36, 0.44, 0.52)):
    for col, x in enumerate((-0.21, -0.07, 0.07, 0.21)):
        tubes.append(lib.cylinder(f"tube_{row}_{col}", 0.035, 0.08, (x, -0.3, z), m["dark"], 6, "Y"))
pods = lib.join(tubes, "launcher_tubes")
cupola = lib.cylinder("cupola", 0.07, 0.06, (-0.2, 0.5, 0.61), m["dark"], 6)
stripe = lib.box("turret_stripe", (0.63, 0.06, 0.05), (0, -0.24, 0.58), m["team"])
turret = lib.turret([block, cap, pods, cupola, stripe], pivot)
lib.parent(turret, root)

lib.export("ru-tos-1a", root)
