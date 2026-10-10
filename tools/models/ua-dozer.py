"""ua-dozer: tracked engineering vehicle with a front dozer blade (spec 06)."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 0.80 wide (x), 0.60 high (z), 1.00 long (y); front is -Y.
track_w, track_h, half_track = 0.22, 0.2, 0.28
hull_len = 0.78
tracks = lib.tracks("tracks", hull_len, track_w, track_h, half_track, m["dark"])
wheels = lib.wheels("roadwheels", 5, 0.08, track_w, hull_len - 0.14, half_track, 0.1, m["dark"])
hull = lib.box("hull", (0.6, 0.8, 0.2), (0, 0.05, 0.3), m["body"])
cab = lib.box("cab", (0.46, 0.36, 0.2), (0, 0.16, 0.49), m["body"])
window = lib.box("window", (0.4, 0.03, 0.1), (0, -0.03, 0.5), m["dark"])
blade = lib.box("blade", (0.76, 0.06, 0.3), (0, -0.43, 0.2), m["dark"])
blade.rotation_euler = (math.radians(-14), 0, 0)
arms = lib.join(
    [lib.box(f"arm_{s}", (0.08, 0.22, 0.06), (s * 0.2, -0.33, 0.28), m["dark"]) for s in (-1, 1)],
    "arms",
)
panels = lib.join(
    [lib.box(f"panel_{s}", (0.02, 0.36, 0.08), (s * 0.31, 0.05, 0.31), m["team"]) for s in (-1, 1)],
    "panels",
)
root = lib.join([hull, tracks, wheels, cab, window, blade, arms, panels], "ua-dozer")

lib.export("ua-dozer", root)
