"""ru-defense: concrete block emplacement whose ATGM launcher is the turret (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 2.00 wide (x), 0.80 high (z), 2.00 deep (y); front is -Y.
pad = lib.box("pad", (1.9, 1.9, 0.1), (0, 0, 0.05), m["dark"])
blocks = [
    lib.box(f"block_back_{i}", (0.36, 0.28, 0.5), (-0.8 + i * 0.4, 0.8, 0.25), m["body"]) for i in range(5)
]
blocks += [lib.box(f"block_left_{i}", (0.28, 0.36, 0.5), (-0.8, -0.6 + i * 0.4, 0.25), m["body"]) for i in range(4)]
blocks += [lib.box(f"block_right_{i}", (0.28, 0.36, 0.5), (0.8, -0.6 + i * 0.4, 0.25), m["body"]) for i in range(4)]
blocks += [lib.box(f"block_front_{i}", (0.36, 0.28, 0.4), (-0.6 + i * 0.4, -0.8, 0.2), m["body"]) for i in range(4)]
walls = lib.join(blocks, "concrete_blocks")
pedestal = lib.box("pedestal", (0.34, 0.34, 0.24), (0, 0, 0.2), m["body"])

pivot = (0, 0, 0.3)
ring = lib.cylinder("ring", 0.22, 0.12, (0, 0, 0.3), m["body"], 8, "Z")
base = lib.box("launcher_base", (0.5, 0.5, 0.2), (0, 0.05, 0.46), m["body"])
tubes = lib.join(
    [
        lib.cylinder(f"tube_{i}", 0.06, 0.5, (0.12 * (-1 if i == 0 else 1), -0.15, 0.52), m["dark"], 8, "Y")
        for i in range(2)
    ],
    "tubes",
)
sight = lib.box("sight", (0.1, 0.1, 0.12), (-0.15, 0.2, 0.58), m["dark"])
team = lib.box("turret_team", (0.4, 0.05, 0.14), (0, -0.23, 0.5), m["team"])
turret = lib.turret([ring, base, tubes, sight, team], pivot)

root = lib.join([pad, walls, pedestal], "ru-defense")
lib.parent(turret, root)

lib.export("ru-defense", root)
