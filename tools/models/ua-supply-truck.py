"""ua-supply-truck: 6x6 cargo truck with a covered bed (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 0.60 wide (x), 0.60 high (z), 1.00 long (y); front is -Y.
wheel_r, wheel_w, half_track = 0.09, 0.08, 0.235
wheels = lib.wheels("wheels", 3, wheel_r, wheel_w, 0.6, half_track, wheel_r, m["dark"])
chassis = lib.box("chassis", (0.4, 0.86, 0.1), (0, 0.0, 0.2), m["body"])
cab = lib.box("cab", (0.46, 0.26, 0.3), (0, -0.34, 0.4), m["body"])
windshield = lib.box("windshield", (0.4, 0.03, 0.12), (0, -0.465, 0.45), m["dark"])
bed = lib.box("bed", (0.48, 0.5, 0.22), (0, 0.18, 0.36), m["body"])
cover = lib.box("cover", (0.46, 0.48, 0.14), (0, 0.18, 0.52), m["body"])
ribs = lib.join(
    [lib.box(f"rib_{i}", (0.46, 0.03, 0.15), (0, y, 0.52), m["dark"]) for i, y in enumerate((-0.02, 0.18, 0.38))],
    "ribs",
)
panels = lib.join(
    [lib.box(f"panel_{s}", (0.02, 0.16, 0.1), (s * 0.24, -0.34, 0.4), m["team"]) for s in (-1, 1)],
    "panels",
)
tailgate = lib.box("tailgate", (0.44, 0.03, 0.16), (0, 0.43, 0.34), m["team"])
root = lib.join([chassis, cab, windshield, bed, cover, ribs, panels, tailgate, wheels], "ua-supply-truck")

lib.export("ua-supply-truck", root)
