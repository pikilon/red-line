"""ru-supply-truck: KamAZ-style 6x6 cargo truck with drop sides (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 0.60 wide (x), 0.60 high (z), 1.00 long (y); front is -Y.
wheel_r, wheel_w, half_track = 0.09, 0.08, 0.235
wheels = lib.wheels("wheels", 3, wheel_r, wheel_w, 0.6, half_track, wheel_r, m["dark"])
chassis = lib.box("chassis", (0.4, 0.88, 0.1), (0, 0.0, 0.2), m["body"])
cab = lib.box("cab", (0.46, 0.26, 0.32), (0, -0.34, 0.4), m["body"])
windshield = lib.box("windshield", (0.4, 0.03, 0.12), (0, -0.465, 0.45), m["dark"])
# Open flatbed with slatted drop sides instead of the covered Ukrainian bed.
bed = lib.box("bed", (0.48, 0.5, 0.14), (0, 0.18, 0.32), m["body"])
ribs = lib.join(
    [
        lib.box(f"side_rib_{s}_{i}", (0.02, 0.03, 0.13), (s * 0.24, y, 0.34), m["dark"])
        for s in (-1, 1)
        for i, y in enumerate((0.0, 0.18, 0.36))
    ],
    "side_ribs",
)
headboard = lib.box("headboard", (0.46, 0.03, 0.16), (0, -0.06, 0.35), m["dark"])
tailgate = lib.box("tailgate", (0.46, 0.03, 0.14), (0, 0.42, 0.34), m["team"])
spare = lib.cylinder("spare", wheel_r, wheel_w, (0, 0.44, 0.4), m["dark"], 8, "Y")
panels = lib.join(
    [lib.box(f"panel_{s}", (0.02, 0.16, 0.1), (s * 0.24, -0.34, 0.42), m["team"]) for s in (-1, 1)],
    "panels",
)
root = lib.join([chassis, cab, windshield, bed, ribs, headboard, tailgate, spare, panels, wheels], "ru-supply-truck")

lib.export("ru-supply-truck", root)
