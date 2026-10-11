"""ru-bmp-2: low tracked IFV, sharp ribbed bow, small turret with 30 mm gun and ATGM (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 0.70 wide (x), 0.55 high (z), 1.10 long (y); front is -Y.
track_w, track_h, half_track = 0.18, 0.18, 0.26
hull_len = 0.9
tracks = lib.tracks("tracks", hull_len + 0.04, track_w, track_h, half_track, m["dark"])
wheels = lib.wheels("roadwheels", 6, 0.08, track_w, hull_len - 0.14, half_track, 0.1, m["dark"])
hull = lib.wedge("hull", (0.56, hull_len, 0.18), (0, 0.06, 0.26), m["body"], slope=0.4)
# Sharp ribbed bow: a centre ridge with two flanking ribs on the glacis.
ribs = lib.join(
    [
        lib.box("bow_ridge", (0.03, 0.06, 0.18), (0, -0.36, 0.25), m["body"]),
        lib.box("bow_rib_l", (0.03, 0.05, 0.13), (-0.13, -0.32, 0.24), m["body"]),
        lib.box("bow_rib_r", (0.03, 0.05, 0.13), (0.13, -0.32, 0.24), m["body"]),
    ],
    "bow_ribs",
)
ramp = lib.box("ramp", (0.4, 0.03, 0.12), (0, 0.47, 0.26), m["dark"])
panels = lib.join(
    [lib.box(f"panel_{s}", (0.02, 0.46, 0.07), (s * 0.285, 0.04, 0.28), m["team"]) for s in (-1, 1)],
    "panels",
)
root = lib.join([hull, tracks, wheels, ribs, ramp, panels], "ru-bmp-2")

pivot = (0, 0.05, 0.37)
body = lib.wedge("turret_body", (0.36, 0.38, 0.13), (0, 0.05, 0.4), m["body"], slope=0.25)
stripe = lib.box("turret_stripe", (0.37, 0.05, 0.04), (0, -0.06, 0.44), m["team"])
sight = lib.box("sight", (0.06, 0.07, 0.05), (-0.11, 0.02, 0.47), m["dark"])
gun = lib.barrel("gun", 0.46, 0.02, (0, -0.05, 0.42), m["dark"])
atgm = lib.cylinder("atgm", 0.03, 0.44, (0, 0.04, 0.5), m["dark"], 6, "Y")
turret = lib.turret([body, stripe, sight, gun, atgm], pivot)
lib.parent(turret, root)

lib.export("ru-bmp-2", root)
