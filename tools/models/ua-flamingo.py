"""ua-flamingo: fat pale-pink cruise missile with a dorsal turbofan (spec 43)."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drones  # noqa: E402
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")
pink = lib.material("body", "#f2c6c8")
team, dark = m["team"], m["dark"]

# Render box: 1.30 wide (x), 0.60 high (z), 2.40 long (y); front is -Y.
axis = 0.24
fuselage = infantry.loft(
    "fuselage",
    [
        ((0, y, axis), r, r)
        for y, r in ((-1.12, 0.0), (-1.09, 0.08), (-0.98, 0.15), (-0.78, 0.2), (0.6, 0.2), (0.95, 0.15), (1.12, 0.07))
    ],
    pink,
    10,
    smooth=False,
)
probe = infantry.rod("probe", 0.012, (0, -1.1, axis), (0, -1.2, axis), dark, 4)
band = infantry.loft("band", [((0, -0.62, axis), 0.206, 0.206), ((0, -0.42, axis), 0.206, 0.206)], team, 10, smooth=False, caps=False)
tail_band = infantry.loft("tail_band", [((0, 0.86, axis), 0.178, 0.178), ((0, 0.92, axis), 0.16, 0.16)], dark, 10, smooth=False, caps=False)
wings = drones.mirrored("wing", [(0.17, -0.2, axis), (0.65, -0.08, axis), (0.65, 0.1, axis), (0.17, 0.2, axis)], 0.035, pink)
tips = drones.mirrored("wing_tip", [(0.5, -0.118, axis), (0.65, -0.08, axis), (0.65, 0.1, axis), (0.5, 0.12, axis)], 0.04, team)
# Big turbofan in a pod on the back: the signature of the missile.
engine_z = axis + 0.25
nacelle = infantry.loft(
    "nacelle",
    [((0, y, engine_z), r, r) for y, r in ((0.12, 0.09), (0.2, 0.115), (0.68, 0.115), (0.84, 0.07))],
    pink,
    10,
    smooth=False,
)
intake = lib.cylinder("intake", 0.075, 0.02, (0, 0.115, engine_z), dark, 10, "Y", bevel=0)
nozzle = lib.cylinder("nozzle", 0.06, 0.02, (0, 0.845, engine_z), dark, 10, "Y", bevel=0)
pylon = lib.box("pylon", (0.06, 0.4, 0.08), (0, 0.42, axis + 0.19), pink, bevel=0)
fins = []
for i, deg in enumerate((45, 135, 225, 315)):
    a = math.radians(deg)
    cos, sin = math.cos(a), math.sin(a)
    fins.append(
        drones.plate(
            f"fin_{i}",
            [(cos * r, y, axis + sin * r) for r, y in ((0.12, 0.8), (0.32, 1.0), (0.32, 1.12), (0.12, 1.12))],
            0.025,
            pink,
        )
    )
root = lib.join([fuselage, probe, band, tail_band, *wings, *tips, nacelle, intake, nozzle, pylon, *fins], "ua-flamingo")

lib.export("ua-flamingo", root)
