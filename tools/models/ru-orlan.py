"""ru-orlan: glider-winged spotter, twin booms, rear pusher, sensor ball (spec 43 §4.6)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import airframe  # noqa: E402
import infantry  # noqa: E402
import lib  # noqa: E402
from airframe import fin, flipped, plate, symmetric  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 1.30 wide (x), 0.30 high (z), 0.80 long (y); front is -Y.
# A long straight wing is the whole silhouette; the booms and tailplane close a
# rectangle behind it with the propeller spinning inside.
zc = 0.13
wing = plate(
    "wing",
    symmetric([(0, -0.15), (0.48, -0.13), (0.65, -0.1), (0.65, 0.0), (0.48, 0.06), (0, 0.07)]),
    0.235,
    0.028,
    body,
)
pod = infantry.loft(
    "pod",
    [
        ((0, -0.4, zc), 0, 0),
        ((0, -0.36, zc), 0.05, 0.05),
        ((0, -0.24, zc + 0.01), 0.085, 0.09),
        ((0, 0.02, zc + 0.02), 0.08, 0.085),
        ((0, 0.09, zc + 0.03), 0.04, 0.04),
    ],
    body,
    segments=8,
    smooth=False,
)
ball = lib.cylinder("sensor_ball", 0.05, 0.08, (0, -0.28, 0.05), dark, 8, "X", bevel=0)
strut = lib.box("wing_strut", (0.06, 0.12, 0.05), (0, -0.04, 0.19), dark, bevel=0)
parts = [wing, pod, ball, strut]
for s in (-1, 1):
    x = s * 0.21
    parts.append(lib.box(f"boom_{s}", (0.03, 0.56, 0.03), (x, 0.11, 0.2), body, bevel=0))
    parts.append(fin(f"fin_{s}", [(0.28, 0.17), (0.4, 0.17), (0.4, 0.3), (0.34, 0.3)], x - 0.012, 0.024, body))
    tip = [(0.46, -0.125), (0.65, -0.1), (0.65, 0.0), (0.46, 0.06)]
    parts.append(plate(f"wing_team_{s}", tip if s > 0 else flipped(tip), 0.242, 0.01, team))
tailplane = plate("tailplane", [(-0.25, 0.28), (0.25, 0.28), (0.25, 0.39), (-0.25, 0.39)], 0.215, 0.022, team)
parts.append(tailplane)
root = lib.join(parts, "ru-orlan")
lib.parent(airframe.prop((0, 0.11, 0.16), 0.15, 0.05, dark), root)

lib.export("ru-orlan", root)
