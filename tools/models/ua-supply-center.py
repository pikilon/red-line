"""ua-supply-center: flat warehouse with a covered loading bay facing -Y (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 4.00 wide (x), 1.00 high (z), 3.00 deep (y); front is -Y.
warehouse = lib.box("warehouse", (3.5, 2.1, 0.8), (0, 0.44, 0.4), m["body"])
roof = lib.box("roof", (3.6, 2.06, 0.1), (0, 0.44, 0.85), m["body"])
dock = lib.box("dock", (2.2, 0.7, 0.24), (0, -0.95, 0.12), m["dark"])
canopy = lib.box("canopy", (2.4, 0.9, 0.08), (0, -0.95, 0.72), m["body"])
posts = lib.join(
    [
        lib.box(f"post_{sx}_{py}", (0.08, 0.08, 0.72), (sx * 1.1, py, 0.36), m["dark"])
        for sx in (-1, 1)
        for py in (-0.62, -1.3)
    ],
    "posts",
)
doors = lib.join(
    [lib.box(f"door_{sx}", (0.8, 0.05, 0.55), (sx * 0.7, -0.63, 0.28), m["dark"]) for sx in (-1, 1)],
    "loading_doors",
)
team = lib.join(
    [
        lib.box("team_front", (1.1, 0.06, 0.16), (0, -0.63, 0.68), m["team"]),
        lib.box("team_side", (0.06, 1.2, 0.16), (1.78, 0.44, 0.68), m["team"]),
    ],
    "team_markings",
)
root = lib.join([warehouse, roof, dock, canopy, posts, doors, team], "ua-supply-center")

lib.export("ua-supply-center", root)
