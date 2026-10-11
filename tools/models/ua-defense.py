"""ua-defense: sandbag emplacement whose ATGM launcher is the turret (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")


def row(prefix, count, size, start, step, mat):
    """A line of sandbags: `count` boxes from `start`, advancing by `step`."""
    return [
        lib.box(f"{prefix}_{i}", size, (start[0] + step[0] * i, start[1] + step[1] * i, start[2]), mat)
        for i in range(count)
    ]


# Render box: 2.00 wide (x), 0.80 high (z), 2.00 deep (y); front is -Y.
pad = lib.box("pad", (1.9, 1.9, 0.1), (0, 0, 0.05), m["dark"])
bags = row("bag_back_lo", 6, (0.32, 0.24, 0.22), (-0.8, 0.8, 0.21), (0.32, 0, 0), m["body"])
bags += row("bag_back_hi", 5, (0.32, 0.24, 0.18), (-0.64, 0.8, 0.41), (0.32, 0, 0), m["body"])
bags += row("bag_left", 4, (0.24, 0.32, 0.22), (-0.8, -0.64, 0.21), (0, 0.32, 0), m["body"])
bags += row("bag_right", 4, (0.24, 0.32, 0.22), (0.8, -0.64, 0.21), (0, 0.32, 0), m["body"])
bags += row("bag_front_lo", 3, (0.32, 0.24, 0.18), (-0.32, -0.8, 0.19), (0.32, 0, 0), m["body"])
walls = lib.join(bags, "sandbags")
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

root = lib.join([pad, walls, pedestal], "ua-defense")
lib.parent(turret, root)

lib.export("ua-defense", root)
