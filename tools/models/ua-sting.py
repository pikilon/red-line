"""ua-sting: small black bullet-bodied interceptor quad (spec 43)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drones  # noqa: E402
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")
black = lib.material("body", "#34363a")
yellow = lib.material("mark", drones.MARK)
team, dark = m["team"], m["dark"]

# Render box: 0.36 wide (x), 0.12 high (z), 0.46 long (y); front is -Y.
axis_z, reach = 0.05, 0.1
parts = [
    infantry.loft(
        "bullet",
        [
            ((0, -0.22, axis_z), 0.0, 0.0),
            ((0, -0.18, axis_z), 0.03, 0.03),
            ((0, -0.1, axis_z), 0.045, 0.045),
            ((0, 0.08, axis_z), 0.045, 0.045),
            ((0, 0.2, axis_z), 0.022, 0.022),
        ],
        black,
        8,
        smooth=False,
    ),
    # Warhead nose ring in yellow and a team stripe down the spine.
    infantry.loft("nose_band", [((0, -0.165, axis_z), 0.036, 0.036), ((0, -0.125, axis_z), 0.043, 0.043)], yellow, 8, smooth=False, caps=False),
    lib.box("spine", (0.036, 0.26, 0.01), (0, 0.02, axis_z + 0.044), team, bevel=0),
]
rotors = []
for i, (sx, sy) in enumerate(((1, -1), (-1, -1), (1, 1), (-1, 1))):
    tip = (sx * reach, sy * reach * 1.1, axis_z)
    parts.append(infantry.rod(f"arm_{i}", 0.01, (sx * 0.03, sy * 0.05, axis_z), tip, dark, 4))
    parts.append(lib.cylinder(f"motor_{i}", 0.02, 0.03, (tip[0], tip[1], axis_z + 0.012), dark, 6, "Z", bevel=0))
    rotors.append(drones.rotor(i, (tip[0], tip[1], axis_z + 0.032), 0.075, 0.03, dark))
root = lib.join(parts, "ua-sting")
for rotor in rotors:
    lib.parent(rotor, root)

lib.export("ua-sting", root)
