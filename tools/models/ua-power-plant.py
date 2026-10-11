"""ua-power-plant: flat-roofed turbine hall and a generator block with stacks (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 3.00 wide (x), 1.20 high (z), 3.00 deep (y); front is -Y.
hall = lib.box("hall", (2.6, 2.2, 0.8), (0, 0.4, 0.4), m["body"])
roof = lib.box("roof", (2.7, 2.18, 0.09), (0, 0.4, 0.845), m["body"])
block = lib.box("generator", (1.2, 1.2, 0.6), (0.75, -0.75, 0.3), m["body"])
stacks = lib.join(
    [lib.cylinder(f"stack_{i}", 0.15, 0.5, (0.45 + i * 0.6, -0.75, 0.85), m["dark"], 8, "Z") for i in range(2)],
    "stacks",
)
vents = lib.join(
    [
        lib.box("vent_a", (0.5, 0.4, 0.12), (-0.9, 0.4, 0.95), m["dark"]),
        lib.box("vent_b", (0.4, 0.5, 0.12), (0.3, 1.2, 0.95), m["dark"]),
    ],
    "roof_vents",
)
windows = lib.join(
    [
        lib.box(f"window_front_{i}", (0.7, 0.06, 0.22), (x, -0.71, 0.45), m["dark"])
        for i, x in enumerate((-0.75, 0.0, 0.75))
    ],
    "windows",
)
team = lib.join(
    [
        lib.box("team_front", (0.9, 0.06, 0.16), (0, -0.71, 0.72), m["team"]),
        lib.box("team_side", (0.06, 0.9, 0.16), (-1.31, 0.4, 0.72), m["team"]),
    ],
    "team_markings",
)
root = lib.join([hall, roof, block, stacks, vents, windows, team], "ua-power-plant")

lib.export("ua-power-plant", root)
