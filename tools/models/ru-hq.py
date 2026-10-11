"""ru-hq: concrete command bunker, gable roof and antenna mast (spec 06)."""

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


# Render box: 4.00 wide (x), 1.50 high (z), 4.00 deep (y); front is -Y.
bunker = lib.box("bunker", (3.4, 3.2, 0.9), (0, 0.3, 0.45), m["body"])
roof = gable("roof", (3.5, 3.3, 0.45), (0, 0.3, 0.9), m["body"])
door = lib.box("door", (0.8, 0.08, 0.55), (0, -1.31, 0.275), m["dark"])
steps = lib.box("steps", (1.3, 0.3, 0.14), (0, -1.5, 0.07), m["dark"])
windows = lib.join(
    [lib.box(f"window_{i}", (0.45, 0.06, 0.18), (x, -1.31, 0.66), m["dark"]) for i, x in enumerate((-1.2, 0.0, 1.2))],
    "windows",
)
blocks = lib.join(
    [lib.box(f"buttress_{i}", (0.5, 0.36, 0.72), (x, -1.48, 0.36), m["body"]) for i, x in enumerate((-1.4, 1.4))],
    "buttresses",
)
mast = lib.cylinder("mast", 0.05, 0.42, (1.25, 1.4, 1.16), m["dark"], 8, "Z")
mast_bar = lib.box("mast_bar", (0.42, 0.05, 0.05), (1.25, 1.4, 1.33), m["dark"])
antenna = lib.join([mast, mast_bar], "antenna")
team = lib.join(
    [
        lib.box("team_front", (1.0, 0.06, 0.18), (0, -1.34, 0.84), m["team"]),
        lib.box("team_side", (0.06, 0.8, 0.18), (1.73, 0.3, 0.84), m["team"]),
    ],
    "team_markings",
)
root = lib.join([bunker, roof, door, steps, windows, blocks, antenna, team], "ru-hq")

lib.export("ru-hq", root)
