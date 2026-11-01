"""ua-gepard: tank hull, boxy turret, twin side guns and two radars (spec 43)."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 0.84 wide (x), 0.80 high (z), 1.30 long (y); front is -Y.
track_w, track_h, half_track = 0.17, 0.17, 0.31
hull_len = 1.02
tracks = lib.tracks("tracks", hull_len, track_w, track_h, half_track, dark)
wheels = lib.wheels("roadwheels", 7, 0.07, track_w, hull_len - 0.16, half_track, 0.08, dark)
hull = lib.wedge("hull", (0.62, hull_len, 0.16), (0, 0.06, 0.22), body, slope=0.18)
skirts = lib.join(
    [lib.box(f"skirt_{s}", (0.03, hull_len - 0.08, 0.1), (s * 0.385, 0.06, 0.21), team) for s in (-1, 1)],
    "skirts",
)
root = lib.join([hull, tracks, wheels, skirts], "ua-gepard")

pivot = (0, 0.12, 0.3)
shell = lib.wedge("turret_body", (0.46, 0.62, 0.26), (0, 0.14, 0.43), body, slope=0.18)
stripe = lib.box("turret_stripe", (0.47, 0.08, 0.03), (0, 0.24, 0.56), team, bevel=0)
parts = [shell, stripe]
for side in (-1, 1):
    parts.append(lib.box(f"gun_pod_{side}", (0.09, 0.42, 0.13), (side * 0.275, 0.04, 0.46), body))
    parts.append(lib.barrel(f"gun_{side}", 0.5, 0.016, (side * 0.275, -0.1, 0.47), dark, math.radians(14)))
    parts.append(lib.barrel(f"flash_{side}", 0.06, 0.026, (side * 0.275, -0.585, 0.59), dark, math.radians(14)))
# Tracking radar: a round dish on the turret front.
parts.append(lib.box("dish_stub", (0.08, 0.08, 0.1), (0, -0.1, 0.59), dark, bevel=0))
parts.append(lib.cylinder("dish", 0.115, 0.05, (0, -0.15, 0.66), dark, 10, "Y", bevel=0))
parts.append(lib.cylinder("dish_face", 0.08, 0.012, (0, -0.178, 0.66), team, 10, "Y", bevel=0))
turret = lib.turret(parts, pivot)
lib.parent(turret, root)

# Search radar: a wide bar on a mast at the turret rear, spinning on its own.
mast = infantry.rod("mast", 0.02, (0, 0.34, 0.56), (0, 0.34, 0.7), dark)
radar = lib.turret(
    [
        lib.box("radar_bar", (0.46, 0.035, 0.09), (0, 0.34, 0.74), dark, bevel=0),
        lib.cylinder("radar_hub", 0.03, 0.05, (0, 0.34, 0.7), dark, 6, "Z", bevel=0),
    ],
    (0, 0.34, 0.7),
    "radar",
)
lib.join([turret, mast], "turret")
lib.parent(radar, turret)

lib.export("ua-gepard", root)
