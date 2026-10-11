"""ua-vehicle-factory: flat-roofed hangar with a large door facing -Y (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 4.00 wide (x), 1.10 high (z), 4.00 deep (y); front is -Y.
hangar = lib.box("hangar", (3.4, 3.0, 0.95), (0, 0.4, 0.475), m["body"])
roof = lib.box("roof", (3.5, 3.1, 0.1), (0, 0.4, 1.0), m["body"])
door = lib.box("door", (2.4, 0.08, 0.78), (0, -1.14, 0.42), m["dark"])
frame = lib.box("door_frame", (2.6, 0.1, 0.1), (0, -1.15, 0.86), m["team"])
bays = lib.join(
    [lib.box(f"bay_{i}", (0.5, 0.06, 0.5), (x, 1.96, 0.42), m["dark"]) for i, x in enumerate((-1.2, 0.0, 1.2))],
    "rear_bays",
)
team = lib.join(
    [
        lib.box("team_left", (0.06, 1.0, 0.24), (-1.73, 0.4, 0.6), m["team"]),
        lib.box("team_right", (0.06, 1.0, 0.24), (1.73, 0.4, 0.6), m["team"]),
    ],
    "team_markings",
)
root = lib.join([hangar, roof, door, frame, bays, team], "ua-vehicle-factory")

lib.export("ua-vehicle-factory", root)
