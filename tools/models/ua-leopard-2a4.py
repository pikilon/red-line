"""ua-leopard-2a4: tall flat hull, angular boxy turret, 120 mm gun (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 0.80 wide (x), 0.55 high (z), 1.30 long (y); front is -Y.
track_w, track_h, half_track = 0.18, 0.17, 0.31
hull_len = 0.98
tracks = lib.tracks("tracks", hull_len, track_w, track_h, half_track, m["dark"])
wheels = lib.wheels("roadwheels", 7, 0.07, track_w, hull_len - 0.16, half_track, 0.08, m["dark"])
hull = lib.wedge("hull", (0.64, hull_len, 0.16), (0, 0.12, 0.22), m["body"], slope=0.15)
skirts = lib.join(
    [lib.box(f"skirt_{s}", (0.03, hull_len - 0.06, 0.1), (s * 0.385, 0.1, 0.21), m["team"]) for s in (-1, 1)],
    "skirts",
)
root = lib.join([hull, tracks, wheels, skirts], "ua-leopard-2a4")

pivot = (0, 0.2, 0.3)
body = lib.wedge("turret_body", (0.5, 0.46, 0.13), (0, 0.2, 0.365), m["body"], slope=0.2)
bustle = lib.box("bustle", (0.42, 0.14, 0.1), (0, 0.48, 0.36), m["body"])
stripe = lib.box("turret_stripe", (0.52, 0.06, 0.04), (0, 0.06, 0.4), m["team"])
sight = lib.box("sight", (0.07, 0.07, 0.06), (-0.14, 0.04, 0.46), m["dark"])
gun = lib.barrel("gun", 0.62, 0.025, (0, -0.02, 0.37), m["dark"])
turret = lib.turret([body, bustle, stripe, sight, gun], pivot)
lib.parent(turret, root)

lib.export("ua-leopard-2a4", root)
