"""ua-fpv: racing quad with an RPG warhead strapped under its nose (spec 43)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drones  # noqa: E402
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")
yellow = lib.material("mark", drones.MARK)
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 0.46 wide (x), 0.15 high (z), 0.46 long (y); front is -Y.
reach, deck = 0.135, 0.075
parts = [
    lib.box("frame", (0.08, 0.14, 0.025), (0, 0, deck), dark, bevel=0),
    # Battery on the spine in team colour with a yellow tape, the top-view stripe.
    lib.box("battery", (0.06, 0.13, 0.04), (0, 0.01, deck + 0.03), team, bevel=0),
    lib.box("tape", (0.064, 0.02, 0.044), (0, 0.01, deck + 0.03), yellow, bevel=0),
    lib.box("camera", (0.04, 0.03, 0.03), (0, -0.075, deck + 0.018), dark, bevel=0),
    infantry.rod("whip", 0.004, (0, 0.07, deck + 0.02), (0, 0.15, 0.14), dark, 4),
    # PG-7 warhead lashed under the frame, nose forward.
    infantry.loft(
        "warhead",
        [((0, 0.08, 0.035), 0.012, 0.012), ((0, -0.03, 0.035), 0.03, 0.03), ((0, -0.13, 0.035), 0.03, 0.03), ((0, -0.21, 0.035), 0.0, 0.0)],
        body,
        8,
        smooth=False,
    ),
]
rotors = []
for i, (sx, sy) in enumerate(((1, -1), (-1, -1), (1, 1), (-1, 1))):
    tip = (sx * reach, sy * reach, deck)
    arm = drones.plate(
        f"arm_plate_{i}",
        [(sx * 0.02, sy * 0.05, deck), (sx * 0.05, sy * 0.02, deck), (tip[0] + sx * 0.012, tip[1] - sy * 0.012, deck), (tip[0] - sx * 0.012, tip[1] + sy * 0.012, deck)],
        0.012,
        dark,
    )
    parts.append(arm)
    parts.append(lib.cylinder(f"motor_{i}", 0.022, 0.03, (tip[0], tip[1], deck + 0.015), dark, 6, "Z", bevel=0))
    rotors.append(drones.rotor(i, (tip[0], tip[1], deck + 0.038), 0.085, 0.035, dark))
root = lib.join(parts, "ua-fpv")
for rotor in rotors:
    lib.parent(rotor, root)

lib.export("ua-fpv", root)
