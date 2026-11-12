"""ua-fpv-team: goggled pilot with the control console and his quad on a crate (spec 43)."""

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
op = infantry.operator("operator", m, 7)
# FPV goggles over the face and the antennas on the helmet.
head = infantry.Rig.tilted(0.1, (0.0, 0.5), (0.0, -0.01, 0.905))
hips = op.limbs["hips"][0]
hips.append(infantry.box("goggles", (0.15, 0.085, 0.08), head + Vector((0, -0.075, 0.015)), dark))
hips.append(infantry.box("goggles_strap", (0.165, 0.09, 0.022), head + Vector((0, -0.03, 0.015)), team))
for side in (-1, 1):
    tip = head + Vector((side * 0.05, -0.11, 0.18))
    hips.append(infantry.rod(f"goggle_ant_{side}", 0.008, head + Vector((side * 0.05, -0.1, 0.05)), tip, dark, 4))
limbs = infantry.place(op, "o", 0.46, (0.085, 0.08))

# The quad waits on a crate; the launch lifts it off (`x_quad`), the crate stays.
qx, qy, qz = -0.08, -0.10, 0.075
crate = [
    infantry.box("crate", (0.11, 0.1, 0.06), (qx, qy, 0.03), body),
    infantry.box("crate_band", (0.112, 0.016, 0.062), (qx, qy, 0.03), m["mark"]),
]
reach = 0.07
quad = [
    infantry.box("quad_frame", (0.04, 0.07, 0.012), (qx, qy, qz), dark),
    infantry.box("quad_battery", (0.03, 0.06, 0.018), (qx, qy, qz + 0.014), team),
    infantry.rod("quad_warhead", 0.016, (qx, qy + 0.04, qz - 0.012), (qx, qy - 0.08, qz - 0.012), body, 6),
]
for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1))):
    tip = (qx + sx * reach, qy + sy * reach, qz)
    quad.append(infantry.rod(f"quad_arm_{i}", 0.006, (qx, qy, qz), tip, dark, 4))
    quad.append(infantry.rod(f"quad_motor_{i}", 0.011, tip, (tip[0], tip[1], qz + 0.016), dark, 6))
    quad.append(infantry.box(f"quad_blade_{i}", (0.09, 0.016, 0.003), (tip[0], tip[1], qz + 0.02), dark))
rig = infantry.Rig()
rig.add("crate", crate, (qx, qy, 0.0))
rig.add("quad", quad, (qx, qy, qz))
limbs |= infantry.place(rig, "x", 1.0)
infantry.centre(limbs)
root = infantry.assemble("ua-fpv-team", limbs)

lib.export("ua-fpv-team", root)
