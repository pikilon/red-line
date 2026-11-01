"""ru-molniya: crude fixed-wing fibre-optic FPV with a cable spool (spec 43 §4.6)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import airframe  # noqa: E402
import lib  # noqa: E402
from airframe import plate  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 0.80 wide (x), 0.30 high (z), 0.60 long (y); front is -Y.
# A plank of plywood, a box and a warhead taped on the nose: no taper anywhere.
zc = 0.1
wing = plate("wing", [(-0.4, -0.04), (0.4, -0.04), (0.4, 0.17), (-0.4, 0.17)], zc + 0.04, 0.03, body)
crate = lib.box("crate", (0.15, 0.4, 0.12), (0, -0.04, zc), body, bevel=0)
warhead = lib.cylinder("warhead", 0.06, 0.16, (0, -0.22, zc), dark, 8, "Y", bevel=0)
cone = lib.cylinder("warhead_cone", 0.03, 0.05, (0, -0.28, zc), dark, 6, "Y", bevel=0)
spool = lib.cylinder("fibre_spool", 0.09, 0.13, (0, 0.05, zc + 0.1), dark, 10, "X", bevel=0)
tips = [
    plate(f"tip_team_{s}", [(s * 0.27, -0.04), (s * 0.4, -0.04), (s * 0.4, 0.17), (s * 0.27, 0.17)], zc + 0.05, 0.012, team)
    for s in (-1, 1)
]
motor = lib.box("motor", (0.06, 0.08, 0.06), (0, 0.2, zc), dark, bevel=0)
root = lib.join([wing, crate, warhead, cone, spool, motor, *tips], "ru-molniya")
lib.parent(airframe.prop((0, 0.26, zc), 0.1, 0.04, dark), root)

lib.export("ru-molniya", root)
