"""ru-power-plant: gabled turbine hall beside a concrete generator block with stacks (spec 06)."""

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")


def gable(name, size, location, mat):
    """A gable roof with the ridge along x at `location`, eaves at y ± size[1]/2."""
    w, d, h = size
    x, y, z = location
    front = lib.wedge(f"{name}_front", (w, d / 2, h), (x, y - d / 4, z + h / 2), mat, slope=1.0)
    back = lib.wedge(f"{name}_back", (w, d / 2, h), (0, 0, 0), mat, slope=1.0)
    back.rotation_euler = (0, 0, math.pi)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    back.location = (x, y + d / 4, z + h / 2)
    return lib.join([front, back], name)


# Render box: 3.00 wide (x), 1.20 high (z), 3.00 deep (y); front is -Y.
hall = lib.box("hall", (2.6, 2.2, 0.75), (0, 0.4, 0.375), m["body"])
roof = gable("roof", (2.7, 2.18, 0.3), (0, 0.4, 0.75), m["body"])
block = lib.box("generator", (1.2, 1.2, 0.6), (0.75, -0.75, 0.3), m["body"])
stacks = lib.join(
    [
        lib.cylinder(f"stack_{i}", 0.15, 0.45, (0.45 + i * 0.6, -0.75, 0.825), m["dark"], 8, "Z")
        for i in range(2)
    ],
    "stacks",
)
windows = lib.join(
    [
        lib.box(f"window_front_{i}", (0.6, 0.06, 0.24), (x, -0.71, 0.34), m["dark"])
        for i, x in enumerate((-0.8, 0.0, 0.8))
    ],
    "windows",
)
team = lib.join(
    [
        lib.box("team_front", (0.8, 0.06, 0.14), (0, -0.71, 0.58), m["team"]),
        lib.box("team_side", (0.06, 0.8, 0.14), (1.31, 0.4, 0.58), m["team"]),
    ],
    "team_markings",
)
root = lib.join([hall, roof, block, stacks, windows, team], "ru-power-plant")

lib.export("ru-power-plant", root)
