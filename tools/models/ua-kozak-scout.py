"""ua-kozak-scout: 4x4 MRAP with a roof HMG turret (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 0.60 wide (x), 0.50 high (z), 0.90 long (y); front is -Y.
wheel_r, wheel_w, half_track = 0.1, 0.09, 0.24
wheels = lib.wheels("wheels", 2, wheel_r, wheel_w, 0.5, half_track, wheel_r, m["dark"])
hull = lib.wedge("hull", (0.48, 0.74, 0.16), (0, 0.04, 0.24), m["body"], slope=0.4)
cab = lib.box("cab", (0.44, 0.4, 0.1), (0, 0.12, 0.37), m["body"])
windshield = lib.box("windshield", (0.38, 0.03, 0.07), (0, -0.06, 0.37), m["dark"])
panels = lib.join(
    [lib.box(f"panel_{s}", (0.02, 0.3, 0.06), (s * 0.245, 0.04, 0.26), m["team"]) for s in (-1, 1)],
    "panels",
)
root = lib.join([hull, cab, windshield, panels, wheels], "ua-kozak-scout")

pivot = (0, 0.06, 0.42)
cupola = lib.cylinder("cupola", 0.09, 0.08, (0, 0.06, 0.44), m["body"], 8)
shield = lib.box("shield", (0.12, 0.04, 0.08), (0, -0.01, 0.45), m["dark"])
gun = lib.barrel("gun", 0.2, 0.015, (0, -0.02, 0.47), m["dark"])
turret = lib.turret([cupola, shield, gun], pivot)
lib.parent(turret, root)

lib.export("ua-kozak-scout", root)
