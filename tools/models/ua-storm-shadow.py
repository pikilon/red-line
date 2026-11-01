"""ua-storm-shadow: faceted square-section stealth cruise missile (spec 43)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drones  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")
grey = lib.material("body", "#8a9096")
team, dark = m["team"], m["dark"]

# Render box: 1.00 wide (x), 0.28 high (z), 1.40 long (y); front is -Y.
hull = drones.facet_loft(
    "hull",
    [
        (-0.7, 0.02, 0.01, 0.095, 0.115),
        (-0.4, 0.17, 0.09, 0.05, 0.19),
        (0.4, 0.19, 0.11, 0.05, 0.21),
        (0.6, 0.12, 0.08, 0.08, 0.18),
    ],
    grey,
)
exhaust = lib.box("exhaust", (0.16, 0.03, 0.07), (0, 0.61, 0.13), dark, bevel=0)
wings = drones.mirrored("wing", [(0.14, -0.14, 0.17), (0.5, 0.0, 0.17), (0.5, 0.13, 0.17), (0.14, 0.1, 0.17)], 0.022, grey)
tips = drones.mirrored("wing_tip", [(0.38, -0.047, 0.17), (0.5, 0.0, 0.17), (0.5, 0.13, 0.17), (0.38, 0.121, 0.17)], 0.026, team)
# Team chevron across the back, flat on the upper facet.
stripe = drones.plate("stripe", [(-0.1, -0.2, 0.183), (0.1, -0.2, 0.183), (0.105, -0.06, 0.19), (-0.105, -0.06, 0.19)], 0.008, team)
# Six tail fins: two flat and four cruciform.
fins = drones.mirrored("fin_flat", [(0.13, 0.42, 0.12), (0.34, 0.56, 0.12), (0.34, 0.66, 0.12), (0.1, 0.62, 0.12)], 0.016, grey)
fins += drones.mirrored("fin_up", [(0.06, 0.42, 0.2), (0.11, 0.56, 0.28), (0.11, 0.66, 0.28), (0.06, 0.62, 0.17)], 0.016, grey)
fins += drones.mirrored("fin_down", [(0.08, 0.42, 0.06), (0.14, 0.56, 0.0), (0.14, 0.66, 0.0), (0.08, 0.62, 0.09)], 0.016, grey)
root = lib.join([hull, exhaust, *wings, *tips, stripe, *fins], "ua-storm-shadow")

lib.export("ua-storm-shadow", root)
