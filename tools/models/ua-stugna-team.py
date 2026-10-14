"""ua-stugna-team: Stugna-P ATGM on its tripod and the remote operator (spec 17)."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import infantry  # noqa: E402
import lib  # noqa: E402
from mathutils import Vector  # noqa: E402

lib.reset_scene()
m = infantry.palette("ukraine")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 0.40 wide (x), 0.50 high (z), 0.40 long (y); front is -Y.
# The Stugna-P is fired from the PDU-215 console away from the launcher, so
# the operator kneels apart from the tripod, linked by the cable on the ground.
tx, ty, top = -0.08, -0.04, 0.2
parts = []
for i, (fx, fy) in enumerate(((0.0, -0.13), (-0.11, 0.08), (0.11, 0.08))):
    foot = Vector((tx + fx, ty + fy, 0.008))
    parts.append(infantry.rod(f"leg_{i}", 0.008, (tx, ty, top), foot, dark))
    parts.append(infantry.box(f"foot_{i}", (0.024, 0.024, 0.012), foot, dark))
parts += [
    infantry.rod("mast", 0.014, (tx, ty, top - 0.02), (tx, ty, top + 0.03), dark, 8),
    # PN-S guidance unit under the transport-launch container.
    infantry.box("guidance", (0.06, 0.08, 0.05), (tx, ty + 0.01, top + 0.055), dark),
    infantry.rod("lens", 0.016, (tx, ty - 0.03, top + 0.055), (tx, ty - 0.045, top + 0.055), dark, 8),
    infantry.rod("tube", 0.034, (tx, ty + 0.13, top + 0.115), (tx, ty - 0.13, top + 0.115), body, 10),
    infantry.rod("tube_front", 0.038, (tx, ty - 0.115, top + 0.115), (tx, ty - 0.145, top + 0.115), dark, 10),
    infantry.rod("tube_rear", 0.038, (tx, ty + 0.115, top + 0.115), (tx, ty + 0.145, top + 0.115), dark, 10),
    # Flag tape round the container: team blue and the yellow mark.
    infantry.box("tube_tape", (0.074, 0.022, 0.074), (tx, ty - 0.081, top + 0.115), team),
    infantry.box("tube_tape_yellow", (0.074, 0.022, 0.074), (tx, ty - 0.059, top + 0.115), m["mark"]),
]
launcher = lib.join(parts, "launcher")

operator_parts, console = infantry.kneeling_operator("operator", m)
operator = infantry.place(operator_parts, "operator", 0.46, (0.11, 0.06), math.radians(-20))
# Cable from the guidance unit down the mast and along the ground to the console.
cable = lib.join(
    [
        infantry.rod("cable_0", 0.004, (tx + 0.02, ty + 0.03, top + 0.04), (tx + 0.03, ty + 0.06, 0.006), dark, 4),
        infantry.rod("cable_1", 0.004, (tx + 0.03, ty + 0.06, 0.006), (0.06, 0.03, 0.006), dark, 4),
    ],
    "cable",
)
root = lib.join([launcher, operator, cable], "ua-stugna-team")
infantry.centre(root)

lib.export("ua-stugna-team", root)
