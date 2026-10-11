"""ru-supply-center: gabled warehouse with a covered loading bay facing -Y (spec 06)."""

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


# Render box: 4.00 wide (x), 1.00 high (z), 3.00 deep (y); front is -Y.
warehouse = lib.box("warehouse", (3.5, 2.1, 0.68), (0, 0.44, 0.34), m["body"])
roof = gable("roof", (3.6, 2.1, 0.3), (0, 0.44, 0.68), m["body"])
dock = lib.box("dock", (2.2, 0.7, 0.24), (0, -0.95, 0.12), m["dark"])
canopy = lib.box("canopy", (2.4, 0.9, 0.08), (0, -0.95, 0.6), m["body"])
posts = lib.join(
    [
        lib.box(f"post_{sx}_{py}", (0.08, 0.08, 0.6), (sx * 1.1, py, 0.3), m["dark"])
        for sx in (-1, 1)
        for py in (-0.62, -1.3)
    ],
    "posts",
)
doors = lib.join(
    [lib.box(f"door_{sx}", (0.8, 0.05, 0.5), (sx * 0.7, -0.63, 0.25), m["dark"]) for sx in (-1, 1)],
    "loading_doors",
)
team = lib.join(
    [
        lib.box("team_front", (1.1, 0.06, 0.14), (0, -0.63, 0.56), m["team"]),
        lib.box("team_side", (0.06, 1.2, 0.14), (1.78, 0.44, 0.56), m["team"]),
    ],
    "team_markings",
)
root = lib.join([warehouse, roof, dock, canopy, posts, doors, team], "ru-supply-center")

lib.export("ru-supply-center", root)
