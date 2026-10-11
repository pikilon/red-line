"""ru-barracks: two long gabled huts with plain team markings (spec 06)."""

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


# Render box: 3.00 wide (x), 0.90 high (z), 3.00 deep (y); front is -Y.
huts = []
for i, x in enumerate((-0.7, 0.7)):
    hut = lib.box(f"hut_{i}", (1.0, 2.6, 0.5), (x, 0.05, 0.25), m["body"])
    roof = gable(f"roof_{i}", (1.05, 2.7, 0.28), (x, 0.05, 0.5), m["body"])
    door = lib.box(f"door_{i}", (0.32, 0.06, 0.4), (x, -1.33, 0.2), m["dark"])
    huts += [lib.join([hut, roof, door], f"hut_block_{i}")]
windows = lib.join(
    [
        lib.box(f"window_{i}_{sx}", (0.04, 0.45, 0.16), (0.7 * i + sx * 0.52, y, 0.28), m["dark"])
        for i in (-1, 1)
        for sx in (-1, 1)
        for y in (-0.7, 0.4)
    ],
    "windows",
)
team = lib.join(
    [
        lib.box("team_front", (0.5, 0.06, 0.14), (-0.7, -1.33, 0.42), m["team"]),
        lib.box("team_side", (0.06, 0.9, 0.14), (-1.26, 0.05, 0.42), m["team"]),
    ],
    "team_markings",
)
root = lib.join(huts + [windows, team], "ru-barracks")

lib.export("ru-barracks", root)
