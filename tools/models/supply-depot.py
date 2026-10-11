"""supply-depot: pallets of stacked crates with plain team markings (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("neutral")

# Render box: 2.00 wide (x), 0.60 high (z), 2.00 deep (y); front is -Y.
corners = [(-0.55, -0.55), (0.55, -0.55), (-0.55, 0.55), (0.55, 0.55), (0.0, 0.0)]
stacks = []
for i, (x, y) in enumerate(corners):
    pallet = lib.box(f"pallet_{i}", (0.62, 0.62, 0.07), (x, y, 0.035), m["dark"])
    crate = lib.box(f"crate_{i}", (0.52, 0.52, 0.4), (x, y, 0.27), m["body"])
    stacks.append(lib.join([pallet, crate], f"stack_{i}"))

lids = lib.join(
    [
        lib.box(f"lid_{i}", (0.34, 0.34, 0.12), (x, y, 0.53), m["dark"])
        for i, (x, y) in enumerate([(-0.55, -0.55), (0.55, 0.55)])
    ],
    "lids",
)
team = lib.join(
    [
        lib.box("team_front", (0.26, 0.02, 0.18), (-0.55, -0.82, 0.3), m["team"]),
        lib.box("team_side", (0.02, 0.26, 0.18), (0.82, -0.55, 0.3), m["team"]),
    ],
    "team_markings",
)
root = lib.join(stacks + [lids, team], "supply-depot")

lib.export("supply-depot", root)
