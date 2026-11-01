"""ua-baba-yaga: huge black hexacopter night bomber with a bomb rack (spec 43)."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drones  # noqa: E402
import infantry  # noqa: E402
import lib  # noqa: E402
from mathutils import Vector  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")
black = lib.material("body", "#34363a")
team, dark = m["team"], m["dark"]

# Render box: 1.24 wide (x), 0.36 high (z), 1.24 long (y); front is -Y.
reach, deck_z = 0.45, 0.25
parts = [
    lib.box("frame", (0.3, 0.38, 0.09), (0, 0, deck_z), black, bevel=0.015),
    # Team plate on top: what the player reads from the RTS camera.
    lib.box("plate", (0.22, 0.3, 0.012), (0, 0, deck_z + 0.05), team, bevel=0),
    lib.box("battery", (0.14, 0.2, 0.05), (0, 0.02, deck_z + 0.08), black, bevel=0),
    lib.cylinder("sensor", 0.05, 0.05, (0, -0.15, deck_z + 0.08), dark, 8, "Z", bevel=0),
    lib.box("lens", (0.05, 0.02, 0.025), (0, -0.2, deck_z + 0.08), team, bevel=0),
]
rotors = []
for i in range(6):
    angle = math.radians(30 + 60 * i)
    tip = Vector((math.cos(angle), math.sin(angle), 0)) * reach + Vector((0, 0, deck_z + 0.02))
    start = Vector((math.cos(angle) * 0.12, math.sin(angle) * 0.12, deck_z))
    parts.append(infantry.rod(f"arm_{i}", 0.018, start, tip, black))
    sleeve_a, sleeve_b = start.lerp(tip, 0.55), start.lerp(tip, 0.8)
    parts.append(infantry.rod(f"sleeve_{i}", 0.023, sleeve_a, sleeve_b, team))
    parts.append(lib.cylinder(f"motor_{i}", 0.04, 0.06, tip + Vector((0, 0, 0.02)), dark, 8, "Z", bevel=0))
    rotors.append(drones.rotor(i, tip + Vector((0, 0, 0.06)), 0.17, 0.05, dark))
for i, (x, y) in enumerate(((-0.13, -0.15), (0.13, -0.15), (-0.13, 0.15), (0.13, 0.15))):
    parts.append(infantry.rod(f"leg_{i}", 0.01, (x * 0.8, y * 0.8, deck_z - 0.04), (x * 1.5, y * 1.5, 0.0), dark, 4))
# Rack with three bombs under the belly.
parts.append(lib.box("rack", (0.28, 0.2, 0.02), (0, 0, deck_z - 0.06), dark, bevel=0))
for i, x in enumerate((-0.09, 0.0, 0.09)):
    parts.append(
        infantry.loft(
            f"bomb_{i}",
            [((x, -0.11, 0.13), 0.0, 0.0), ((x, -0.07, 0.13), 0.03, 0.03), ((x, 0.06, 0.13), 0.03, 0.03), ((x, 0.1, 0.13), 0.012, 0.012)],
            black,
            6,
            smooth=False,
        )
    )
root = lib.join(parts, "ua-baba-yaga")
for rotor in rotors:
    lib.parent(rotor, root)

lib.export("ua-baba-yaga", root)
