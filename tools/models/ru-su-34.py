"""ru-su-34: fat duckbill fighter-bomber with canards and twin tails (spec 43 §4.6)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import airframe  # noqa: E402
import infantry  # noqa: E402
import lib  # noqa: E402
from airframe import fin, flipped, plate, symmetric  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 1.70 wide (x), 0.50 high (z), 2.40 long (y); front is -Y.
# Flanker planform kept but fattened: the wide flat duckbill nose, the two
# engine tubes with the long stinger between them and the UMPK bombs under the
# wings read from the RTS camera. Team colour across both wings and on the fins.
zc = 0.2
wing = plate(
    "wing",
    symmetric([(0, -0.62), (0.2, -0.5), (0.3, -0.14), (0.85, 0.36), (0.85, 0.5), (0.3, 0.56), (0.3, 0.6), (0, 0.6)]),
    zc + 0.02,
    0.04,
    body,
)
nose = infantry.loft(
    "nose",
    [
        ((0, -1.2, zc - 0.02), 0, 0),
        ((0, -1.1, zc - 0.015), 0.09, 0.05),
        ((0, -0.92, zc), 0.17, 0.08),
        ((0, -0.7, zc + 0.01), 0.22, 0.12),
        ((0, -0.4, zc + 0.01), 0.22, 0.125),
        ((0, -0.1, zc), 0.16, 0.09),
    ],
    body,
    segments=8,
    smooth=False,
)
radome = infantry.loft(
    "radome",
    [((0, -1.203, zc - 0.02), 0, 0), ((0, -1.1, zc - 0.015), 0.094, 0.054), ((0, -1.04, zc - 0.01), 0.125, 0.066)],
    dark,
    segments=8,
    smooth=False,
)
# Side-by-side armoured cockpit: wider than it is long.
canopy = infantry.loft(
    "canopy",
    [
        ((0, -0.93, zc + 0.05), 0, 0),
        ((0, -0.84, zc + 0.08), 0.13, 0.07),
        ((0, -0.66, zc + 0.1), 0.165, 0.09),
        ((0, -0.5, zc + 0.08), 0.12, 0.06),
        ((0, -0.42, zc + 0.08), 0, 0),
    ],
    dark,
    segments=8,
    smooth=False,
)
stinger = infantry.loft(
    "stinger",
    [
        ((0, 0.4, zc), 0.1, 0.07),
        ((0, 0.9, zc + 0.01), 0.075, 0.06),
        ((0, 1.1, zc + 0.01), 0.05, 0.045),
        ((0, 1.19, zc + 0.01), 0, 0),
    ],
    body,
    segments=6,
    smooth=False,
)
parts = [wing, nose, radome, canopy, stinger]
for s in (-1, 1):
    x = s * 0.23
    parts.append(
        infantry.loft(
            f"engine_{s}",
            [
                ((x, -0.5, zc - 0.05), 0.08, 0.06),
                ((x, -0.3, zc - 0.03), 0.125, 0.1),
                ((x, 0.7, zc), 0.125, 0.105),
                ((x, 0.93, zc), 0.1, 0.09),
            ],
            body,
            segments=8,
            smooth=False,
        )
    )
    parts.append(lib.cylinder(f"nozzle_{s}", 0.088, 0.1, (x, 0.98, zc), dark, 8, "Y", bevel=0))
    canard = [(0.17, -0.74), (0.43, -0.58), (0.43, -0.5), (0.17, -0.54)]
    parts.append(plate(f"canard_{s}", canard if s > 0 else flipped(canard), zc + 0.07, 0.022, body))
    tailplane = [(0.3, 0.62), (0.68, 0.94), (0.68, 1.1), (0.3, 0.95)]
    parts.append(plate(f"tailplane_{s}", tailplane if s > 0 else flipped(tailplane), zc + 0.015, 0.025, body))
    profile = [(0.56, zc + 0.1), (0.96, zc + 0.1), (1.06, 0.5), (0.86, 0.5)]
    parts.append(fin(f"fin_{s}", profile, s * 0.33 - 0.015, 0.03, body, cant=s * 0.08))
    parts.append(fin(f"fin_team_{s}", [(0.86, 0.42), (1.03, 0.42), (1.06, 0.5), (0.87, 0.5)], s * 0.33 + s * 0.026 - 0.018, 0.036, team))
    # Team band chord-wise across the outer wing.
    band = [(0.54, 0.04), (0.72, 0.2), (0.72, 0.47), (0.54, 0.48)]
    parts.append(plate(f"wing_team_{s}", band if s > 0 else flipped(band), zc + 0.03, 0.012, team))
    parts.append(lib.box(f"tip_rail_{s}", (0.03, 0.34, 0.03), (s * 0.835, 0.38, zc - 0.02), dark, bevel=0))
    # UMPK FAB: a fat crude bomb with stub wings on a belly-side pylon.
    bx = s * 0.47
    parts.append(lib.box(f"pylon_{s}", (0.03, 0.2, 0.08), (bx, 0.2, 0.15), dark, bevel=0))
    parts.append(
        infantry.loft(
            f"bomb_{s}",
            [
                ((bx, -0.1, 0.075), 0, 0),
                ((bx, -0.05, 0.075), 0.05, 0.05),
                ((bx, 0.3, 0.075), 0.065, 0.065),
                ((bx, 0.42, 0.075), 0.03, 0.03),
            ],
            dark,
            segments=6,
            smooth=False,
        )
    )
    parts.append(lib.box(f"bomb_fins_{s}", (0.2, 0.05, 0.012), (bx, 0.41, 0.075), dark, bevel=0))
root = lib.join(parts, "ru-su-34")

lib.export("ru-su-34", root)
