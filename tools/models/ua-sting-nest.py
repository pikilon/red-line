"""ua-sting-nest: sandbagged rack of launch cells with interceptors and a radar panel (spec 43)."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drones  # noqa: E402
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")
sand = lib.material("mark", "#b9a56a")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box (footprint 2x2): 2.00 wide (x), 0.95 high (z), 2.00 deep (y); front is -Y.
parts = [lib.box("pad", (1.9, 1.9, 0.06), (0, 0, 0.03), dark)]
parts += drones.row("bag_back", 6, (0.3, 0.22, 0.18), (-0.75, 0.82, 0.15), (0.3, 0, 0), body)
parts += drones.row("bag_left", 5, (0.22, 0.3, 0.18), (-0.82, -0.6, 0.15), (0, 0.3, 0), body)
parts += drones.row("bag_right", 3, (0.22, 0.3, 0.18), (0.82, -0.6, 0.15), (0, 0.3, 0), body)
parts += drones.row("bag_front", 2, (0.3, 0.22, 0.16), (-0.6, -0.82, 0.14), (0.3, 0, 0), body)
# Tilted rack of open launch cells, one interceptor per cell, nose up towards -Y.
tilt = math.radians(18)
rack_z, rack_y = 0.34, -0.02
parts.append(lib.box("rack_base", (1.14, 0.8, 0.26), (0, 0.02, 0.19), body))
parts.append(lib.box("rack_band", (1.15, 0.1, 0.27), (0, 0.3, 0.19), team, bevel=0))


def on_rack(x, y):
    """A point of the tilted rack top."""
    return (x, rack_y + y * math.cos(tilt), rack_z + y * math.sin(tilt) + 0.04)


corners = [on_rack(-0.56, -0.4), on_rack(0.56, -0.4), on_rack(0.56, 0.4), on_rack(-0.56, 0.4)]
parts.append(drones.plate("rack_top", corners, 0.05, body))
for i, x in enumerate((-0.37, 0.0, 0.37)):
    for j, y in enumerate((-0.19, 0.19)):
        cx, cy, cz = on_rack(x, y)
        cz += 0.03
        parts.append(
            drones.plate(
                f"cell_{i}_{j}",
                [on_rack(x + sx * 0.16, y + sy * 0.16)[:2] + (on_rack(x + sx * 0.16, y + sy * 0.16)[2] + 0.03,) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))],
                0.012,
                sand,
            )
        )
        for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1))):
            parts.append(infantry.rod(f"sting_{i}_{j}_arm_{k}", 0.009, (cx, cy, cz + 0.03), (cx + sx * 0.11, cy + sy * 0.11, cz + 0.03), dark, 4))
        parts.append(infantry.loft(f"sting_{i}_{j}", [((cx, cy - 0.12, cz + 0.035), 0.0, 0.0), ((cx, cy - 0.07, cz + 0.035), 0.032, 0.032), ((cx, cy + 0.11, cz + 0.035), 0.022, 0.022)], dark, 6, smooth=False))
# Radar panel on a mast behind the rack.
parts.append(infantry.rod("mast", 0.02, (0.55, 0.62, 0.1), (0.55, 0.62, 0.74), dark))
panel = lib.box("radar_panel", (0.44, 0.05, 0.28), (0.55, 0.6, 0.78), dark, bevel=0)
parts.append(panel)
parts.append(lib.box("radar_face", (0.36, 0.01, 0.2), (0.55, 0.57, 0.78), team, bevel=0))
root = lib.join(parts, "ua-sting-nest")

lib.export("ua-sting-nest", root)
