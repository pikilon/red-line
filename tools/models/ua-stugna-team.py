"""ua-stugna-team: ATGM on a tripod with a two-soldier crew (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 0.40 wide (x), 0.50 high (z), 0.40 long (y); front is -Y.
# Stugna-P (Skif) ATGM on tripod with optical guidance unit and remote control suitcase console (PDU-215).

# Tripod mount and launcher tube
tube = lib.cylinder("tube", 0.035, 0.30, (0.0, -0.02, 0.24), m["dark"], 8, "Y")
tube_front = lib.cylinder("tube_front", 0.04, 0.03, (0.0, -0.155, 0.24), m["dark"], 8, "Y")
tube_rear = lib.cylinder("tube_rear", 0.04, 0.03, (0.0, 0.115, 0.24), m["dark"], 8, "Y")

# Optical guidance unit (PN-I / PN-S sight block) on side of launcher
sight = lib.box("sight_box", (0.05, 0.07, 0.05), (-0.04, -0.04, 0.28), m["body"])
sight_lens = lib.cylinder("sight_lens", 0.016, 0.02, (-0.04, -0.08, 0.28), m["dark"], 6, "Y")

# Tripod legs
legs = lib.join(
    [
        lib.cylinder("leg_fl", 0.012, 0.22, (-0.07, -0.07, 0.11), m["dark"], 6, "Z"),
        lib.cylinder("leg_fr", 0.012, 0.22, (0.07, -0.07, 0.11), m["dark"], 6, "Z"),
        lib.cylinder("leg_rear", 0.012, 0.22, (0.0, 0.10, 0.11), m["dark"], 6, "Z"),
    ],
    "legs",
)

# PDU-215 remote control console ("the suitcase") on ground
console_case = lib.box("console_case", (0.075, 0.055, 0.02), (-0.09, 0.06, 0.035), m["dark"])
console_lid = lib.box("console_lid", (0.075, 0.015, 0.045), (-0.09, 0.035, 0.06), m["dark"])
console_screen = lib.box("console_screen", (0.055, 0.008, 0.032), (-0.09, 0.04, 0.06), m["team"])

# Crew: operator kneeling at remote console, guard watching flank
operator = lib.modern_soldier("operator", "remote", m, height=0.46, pose="kneeling")
operator.location.x -= 0.09
operator.location.y += 0.105

guard = lib.modern_soldier("guard", "rifle", m, height=0.48, pose="standing")
guard.location.x += 0.10
guard.location.y += 0.035

root = lib.join(
    [
        tube,
        tube_front,
        tube_rear,
        sight,
        sight_lens,
        legs,
        console_case,
        console_lid,
        console_screen,
        operator,
        guard,
    ],
    "ua-stugna-team",
)

lib.export("ua-stugna-team", root)
