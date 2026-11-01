"""ru-molniya-crew: FPV operator with his controller, a Molniya on the ground beside him (spec 43 §4.6)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import airframe  # noqa: E402
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = infantry.palette("russia")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 0.50 wide (x), 0.55 high (z), 0.50 long (y); front is -Y.
# The drone is its own limb (`limb_x_drone`) so the client can hide it while one is in the air.
dx, dy = 0.1, -0.09
z = 0.07
drone = [
    airframe.plate("wing", [(dx - 0.15, dy - 0.02), (dx + 0.15, dy - 0.02), (dx + 0.15, dy + 0.08), (dx - 0.15, dy + 0.08)], z + 0.03, 0.014, body),
    infantry.box("crate", (0.07, 0.2, 0.06), (dx, dy - 0.01, z), body),
    infantry.rod("warhead", 0.03, (dx, dy - 0.1, z), (dx, dy - 0.18, z), dark, 6),
    infantry.rod("spool", 0.045, (dx - 0.03, dy + 0.03, z + 0.07), (dx + 0.03, dy + 0.03, z + 0.07), dark, 8),
    infantry.box("blade", (0.09, 0.008, 0.016), (dx, dy + 0.11, z), dark),
    airframe.plate("tip_l", [(dx - 0.15, dy - 0.02), (dx - 0.11, dy - 0.02), (dx - 0.11, dy + 0.08), (dx - 0.15, dy + 0.08)], z + 0.036, 0.008, team),
    airframe.plate("tip_r", [(dx + 0.11, dy - 0.02), (dx + 0.15, dy - 0.02), (dx + 0.15, dy + 0.08), (dx + 0.11, dy + 0.08)], z + 0.036, 0.008, team),
    # Two sticks propping the nose up for launch.
    infantry.box("stand", (0.11, 0.02, 0.07), (dx, dy + 0.01, 0.035), dark),
]
rig = infantry.Rig()
rig.add("drone", drone, (dx, dy, z))
limbs = infantry.place(rig, "x", 1.0)
limbs |= infantry.place(infantry.operator("operator", m, segments=6), "o", 0.5, (-0.14, 0.1))
infantry.centre(limbs)
root = infantry.assemble("ru-molniya-crew", limbs)

lib.export("ru-molniya-crew", root)
