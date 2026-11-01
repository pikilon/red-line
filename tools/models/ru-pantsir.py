"""ru-pantsir: KamAZ 8x8 with a bristling missile and gun turret (spec 43 §4.6)."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import airframe  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 0.80 wide (x), 0.90 high (z), 1.35 long (y); front is -Y.
wheel_r, wheel_w, half_track = 0.095, 0.09, 0.29
wheels = lib.wheels("wheels", 4, wheel_r, wheel_w, 1.0, half_track, wheel_r, dark)
chassis = lib.box("chassis", (0.5, 1.3, 0.12), (0, 0.0, 0.2), body)
cab = lib.box("cab", (0.62, 0.32, 0.34), (0, -0.5, 0.4), body)
windshield = lib.box("windshield", (0.54, 0.03, 0.14), (0, -0.665, 0.48), dark)
grille = lib.box("grille", (0.5, 0.03, 0.1), (0, -0.665, 0.28), dark)
module = lib.box("module", (0.62, 0.92, 0.2), (0, 0.2, 0.35), body)
doors = lib.join(
    [lib.box(f"door_{s}", (0.02, 0.2, 0.14), (s * 0.315, -0.5, 0.4), team) for s in (-1, 1)],
    "doors",
)
root = lib.join([chassis, cab, windshield, grille, module, wheels, doors], "ru-pantsir")

pivot = (0, 0.22, 0.45)
ring = lib.cylinder("ring", 0.26, 0.06, (0, 0.22, 0.48), dark, 10)
drum = lib.box("drum", (0.42, 0.52, 0.2), (0, 0.24, 0.6), body)
stripe = lib.box("turret_stripe", (0.43, 0.08, 0.06), (0, 0.02, 0.66), team)
dish = lib.cylinder("tracking_radar", 0.13, 0.05, (0, -0.05, 0.6), dark, 10, "Y", bevel=0)
search = airframe.pitch(lib.box("search_radar", (0.5, 0.05, 0.2), (0, 0.46, 0.79), dark, bevel=0), math.radians(-18), (0, 0.46, 0.7))
mast = lib.box("radar_mast", (0.1, 0.06, 0.1), (0, 0.46, 0.72), body)
parts = [ring, drum, stripe, dish, search, mast]
# Two six-round missile clusters, carried high so they stick out of the silhouette.
for s in (-1, 1):
    tubes = [
        lib.cylinder(f"tube_{s}_{c}_{r}", 0.036, 0.56, (s * (0.285 + c * 0.075), 0.2, 0.585 + r * 0.075), body, 6, "Y")
        for c in range(2)
        for r in range(3)
    ]
    caps = [
        lib.cylinder(f"cap_{s}_{c}_{r}", 0.029, 0.012, (s * (0.285 + c * 0.075), -0.082, 0.585 + r * 0.075), dark, 6, "Y")
        for c in range(2)
        for r in range(3)
    ]
    band = lib.box(f"cluster_band_{s}", (0.16, 0.05, 0.23), (s * 0.3225, 0.32, 0.66), team, bevel=0)
    cluster = lib.join([*tubes, *caps, band], f"cluster_{s}")
    parts.append(airframe.pitch(cluster, math.radians(24), (0, 0.24, 0.6)))
    arm = lib.box(f"cluster_arm_{s}", (0.1, 0.1, 0.1), (s * 0.235, 0.24, 0.6), body, bevel=0)
    parts.append(arm)
    # Twin 30 mm autocannon under the cluster.
    for offset in (0, 0.055):
        parts.append(lib.barrel(f"gun_{s}_{offset}", 0.42, 0.017, (s * (0.24 + offset), 0.02, 0.5), dark))
    parts.append(lib.box(f"gun_box_{s}", (0.13, 0.16, 0.07), (s * 0.27, 0.08, 0.5), body, bevel=0))
turret = lib.turret(parts, pivot)
lib.parent(turret, root)

lib.export("ru-pantsir", root)
