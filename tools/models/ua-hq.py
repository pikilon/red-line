"""ua-hq: sandbagged command bunker, flat roof and antenna mast (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 4.00 wide (x), 1.50 high (z), 4.00 deep (y); front is -Y.
bunker = lib.box("bunker", (3.4, 3.2, 1.0), (0, 0.3, 0.5), m["body"])
roof = lib.box("roof", (3.5, 3.3, 0.12), (0, 0.3, 1.06), m["body"])
door = lib.box("door", (0.7, 0.08, 0.62), (0, -1.31, 0.31), m["dark"])
windows = lib.join(
    [lib.box(f"window_{i}", (0.5, 0.06, 0.16), (x, -1.31, 0.78), m["dark"]) for i, x in enumerate((-1.2, -0.4, 0.4, 1.2))],
    "windows",
)
bags = []
for i in range(9):
    x = -1.6 + i * 0.4
    bags.append(lib.box(f"bag_front_{i}", (0.34, 0.24, 0.22), (x, -1.25, 1.23), m["body"]))
    bags.append(lib.box(f"bag_back_{i}", (0.34, 0.24, 0.22), (x, 1.85, 1.23), m["body"]))
for i in range(8):
    y = -1.0 + i * 0.4
    bags.append(lib.box(f"bag_left_{i}", (0.24, 0.34, 0.22), (-1.6, y, 1.23), m["body"]))
    bags.append(lib.box(f"bag_right_{i}", (0.24, 0.34, 0.22), (1.6, y, 1.23), m["body"]))
parapet = lib.join(bags, "sandbag_parapet")
vents = lib.join(
    [
        lib.box("vent_a", (0.5, 0.5, 0.14), (-1.0, 0.6, 1.19), m["dark"]),
        lib.box("vent_b", (0.4, 0.6, 0.14), (0.7, -0.4, 1.19), m["dark"]),
    ],
    "roof_vents",
)
mast = lib.cylinder("mast", 0.05, 0.34, (1.25, 1.5, 1.29), m["dark"], 8, "Z")
mast_bar = lib.box("mast_bar", (0.42, 0.05, 0.05), (1.25, 1.5, 1.42), m["dark"])
antenna = lib.join([mast, mast_bar], "antenna")
team = lib.join(
    [
        lib.box("team_front", (1.1, 0.06, 0.2), (0, -1.34, 0.96), m["team"]),
        lib.box("team_side", (0.06, 0.8, 0.2), (-1.73, 0.3, 0.96), m["team"]),
    ],
    "team_markings",
)
root = lib.join([bunker, roof, door, windows, parapet, vents, antenna, team], "ua-hq")

lib.export("ua-hq", root)
