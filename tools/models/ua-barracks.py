"""ua-barracks: two long flat-roofed huts with sandy-brown markings (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 3.00 wide (x), 0.90 high (z), 3.00 deep (y); front is -Y.
huts = []
for i, x in enumerate((-0.7, 0.7)):
    hut = lib.box(f"hut_{i}", (1.0, 2.7, 0.6), (x, 0.05, 0.3), m["body"])
    roof = lib.box(f"roof_{i}", (1.1, 2.8, 0.08), (x, 0.05, 0.64), m["body"])
    door = lib.box(f"door_{i}", (0.32, 0.06, 0.42), (x, -1.33, 0.21), m["dark"])
    huts += [lib.join([hut, roof, door], f"hut_block_{i}")]
windows = lib.join(
    [
        lib.box(f"window_{i}_{sx}", (0.04, 0.5, 0.18), (0.7 * i + sx * 0.52, y, 0.34), m["dark"])
        for i in (-1, 1)
        for sx in (-1, 1)
        for y in (-0.7, 0.4)
    ],
    "windows",
)
team = lib.join(
    [
        lib.box("team_front", (0.5, 0.06, 0.16), (-0.7, -1.33, 0.52), m["team"]),
        lib.box("team_side", (0.06, 1.0, 0.16), (-1.26, 0.05, 0.52), m["team"]),
    ],
    "team_markings",
)
root = lib.join(huts + [windows, team], "ua-barracks")

lib.export("ua-barracks", root)
