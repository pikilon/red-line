"""ru-geran-site: angled launch rails on a truck bed, drones racked ready (spec 43 §4.6)."""

import math
import os
import sys

from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import airframe  # noqa: E402
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 3.00 wide (x), 0.90 high (z), 2.00 deep (y); front is -Y.
# A long truck parked across the pad, cab to the right; three rails on the bed
# throw Gerans towards the front.
pad = lib.box("pad", (2.96, 1.96, 0.06), (0, 0, 0.03), dark, bevel=0)
parts = [pad]
for i in range(8):
    parts.append(lib.box(f"berm_{i}", (0.34, 0.2, 0.16), (-1.2 + i * 0.35, 0.86, 0.14), body))
for s in (-1, 1):
    for i in range(2):
        parts.append(lib.box(f"berm_side_{s}_{i}", (0.2, 0.34, 0.14), (s * 1.34, 0.42 - i * 0.36, 0.13), body))
for i, x in enumerate((-1.05, -0.5, 0.05, 0.6)):
    for s in (-1, 1):
        parts.append(lib.cylinder(f"wheel_{i}_{s}", 0.13, 0.11, (x, s * 0.34, 0.19), dark, 8, "Y"))
parts += [
    lib.box("truck_chassis", (2.2, 0.56, 0.1), (-0.25, 0, 0.3), body),
    lib.box("truck_bed", (1.86, 0.84, 0.08), (-0.42, 0, 0.39), dark),
    lib.box("cab", (0.46, 0.76, 0.5), (0.88, 0, 0.56), body),
    lib.box("windshield", (0.03, 0.66, 0.16), (1.115, 0, 0.67), dark, bevel=0),
    lib.box("bonnet", (0.26, 0.7, 0.24), (1.2, 0, 0.42), body),
    lib.box("cab_team", (0.48, 0.78, 0.06), (0.88, 0, 0.82), team, bevel=0),
]
rail_angle = math.radians(20)
hinge = Vector((0, 0.34, 0.45))
for i, x in enumerate((-1.0, -0.4, 0.2)):
    rail_len = 1.06
    rail = lib.join(
        [lib.box(f"rail_{i}_{s}", (0.03, rail_len, 0.04), (x + s * 0.09, 0.34 - rail_len / 2, 0.47), dark, bevel=0) for s in (-1, 1)],
        f"rail_{i}",
    )
    parts.append(airframe.pitch(rail, rail_angle, hinge))
    legs = lib.join(
        [lib.box(f"leg_{i}_{s}", (0.05, 0.05, 0.22), (x + s * 0.09, -0.2, 0.53), body, bevel=0) for s in (-1, 1)],
        f"legs_{i}",
    )
    parts.append(legs)
    drone, _ = airframe.geran(m)
    drone.data.transform(drone.matrix_world)
    drone.matrix_world = Matrix.Identity(4)
    place = (
        Matrix.Translation((x, -0.16, 0.7))
        @ Matrix.Rotation(-rail_angle, 4, "X")
        @ Matrix.Translation((0, 0, -0.064))
        @ Matrix.Scale(0.46, 4)
    )
    infantry.transform(drone, place)
    parts.append(drone)
    parts.append(lib.box(f"rail_team_{i}", (0.44, 0.06, 0.05), (x, 0.42, 0.45), team, bevel=0))
for i, (x, y) in enumerate(((-1.2, -0.72), (-0.72, -0.76), (0.9, -0.72))):
    parts.append(lib.box(f"crate_{i}", (0.36, 0.26, 0.2), (x, y, 0.16), body))
for i, x in enumerate((0.34, 0.54)):
    parts.append(lib.cylinder(f"fuel_drum_{i}", 0.09, 0.24, (x, -0.74, 0.18), dark, 8))
root = lib.join(parts, "ru-geran-site")

lib.export("ru-geran-site", root)
