"""ua-bradley: tracked IFV, boxy hull, small turret with a 25 mm gun (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 0.70 wide (x), 0.60 high (z), 1.10 long (y); front is -Y.
track_w, track_h, half_track = 0.18, 0.18, 0.26
hull_len = 0.94
tracks = lib.tracks("tracks", hull_len, track_w, track_h, half_track, m["dark"])
wheels = lib.wheels("roadwheels", 6, 0.08, track_w, hull_len - 0.16, half_track, 0.1, m["dark"])
hull = lib.wedge("hull", (0.56, 0.9, 0.18), (0, 0.06, 0.26), m["body"], slope=0.3)
ramp = lib.box("ramp", (0.4, 0.03, 0.12), (0, 0.5, 0.26), m["dark"])
panels = lib.join(
    [lib.box(f"panel_{s}", (0.02, 0.5, 0.08), (s * 0.285, 0.02, 0.28), m["team"]) for s in (-1, 1)],
    "panels",
)
root = lib.join([hull, tracks, wheels, ramp, panels], "ua-bradley")

pivot = (0, 0.05, 0.4)
body = lib.wedge("turret_body", (0.34, 0.34, 0.16), (0, 0.07, 0.42), m["body"], slope=0.2)
stripe = lib.box("turret_stripe", (0.35, 0.05, 0.05), (0, -0.04, 0.47), m["team"])
tow = lib.box("tow", (0.09, 0.2, 0.09), (0.22, 0.06, 0.46), m["dark"])
sight = lib.box("sight", (0.07, 0.07, 0.06), (-0.14, 0.02, 0.48), m["dark"])
gun = lib.barrel("gun", 0.5, 0.02, (0, -0.02, 0.44), m["dark"])
turret = lib.turret([body, stripe, tow, sight, gun], pivot)
lib.parent(turret, root)

lib.export("ua-bradley", root)
