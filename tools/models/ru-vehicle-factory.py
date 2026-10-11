"""ru-vehicle-factory: gabled hangar with a large door facing -Y (spec 06)."""

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


# Render box: 4.00 wide (x), 1.10 high (z), 4.00 deep (y); front is -Y.
hangar = lib.box("hangar", (3.4, 3.0, 0.7), (0, 0.4, 0.35), m["body"])
roof = gable("roof", (3.5, 3.1, 0.35), (0, 0.4, 0.7), m["body"])
door = lib.box("door", (2.4, 0.08, 0.56), (0, -1.14, 0.32), m["dark"])
frame = lib.box("door_frame", (2.6, 0.1, 0.1), (0, -1.15, 0.62), m["team"])
bays = lib.join(
    [lib.box(f"bay_{i}", (0.5, 0.06, 0.4), (x, 1.96, 0.3), m["dark"]) for i, x in enumerate((-1.2, 0.0, 1.2))],
    "rear_bays",
)
team = lib.join(
    [
        lib.box("team_left", (0.06, 0.9, 0.2), (-1.73, 0.4, 0.4), m["team"]),
        lib.box("team_right", (0.06, 0.9, 0.2), (1.73, 0.4, 0.4), m["team"]),
    ],
    "team_markings",
)
root = lib.join([hangar, roof, door, frame, bays, team], "ru-vehicle-factory")

lib.export("ru-vehicle-factory", root)
