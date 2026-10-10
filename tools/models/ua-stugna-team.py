"""ua-stugna-team: ATGM on a tripod with a two-soldier crew (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 0.40 wide (x), 0.50 high (z), 0.40 long (y); front is -Y.
tube = lib.cylinder("tube", 0.04, 0.38, (0, -0.01, 0.3), m["dark"], 8, "Y")
stripe = lib.box("tube_stripe", (0.1, 0.03, 0.06), (0, -0.18, 0.3), m["team"])
sight = lib.box("sight", (0.06, 0.08, 0.07), (0, 0.04, 0.36), m["dark"])
legs = lib.join(
    [
        lib.cylinder(f"leg_{i}", 0.015, 0.18, p, m["dark"], 6, "Z")
        for i, p in enumerate([(-0.08, 0.06, 0.09), (0.08, 0.06, 0.09), (0.0, 0.14, 0.09)])
    ],
    "legs",
)
crew = []
for i, x in enumerate((-0.11, 0.11)):
    soldier = lib.soldier(f"crew_{i}", "rifle", m, height=0.5)
    soldier.location.x += x
    soldier.location.y += 0.09
    crew.append(soldier)
root = lib.join([tube, stripe, sight, legs, *crew], "ua-stugna-team")

lib.export("ua-stugna-team", root)
