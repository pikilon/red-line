"""ua-missile-site: raised launch rail on a slab, blast wall and prep container (spec 43)."""

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

# Render box (footprint 3x4): 3.00 wide (x), 0.95 high (z), 4.00 deep (y); front is -Y.
parts = [lib.box("slab", (2.9, 3.9, 0.06), (0, 0, 0.03), dark)]
# Launch rail: two beams rising towards the front, on trestles.
rail_x, y0, y1, z0, z1 = 0.26, 1.45, -1.75, 0.2, 0.62


def rail_z(y):
    return z0 + (z1 - z0) * (y - y0) / (y1 - y0)


for side in (-1, 1):
    x = side * rail_x
    parts.append(infantry.rod(f"rail_{side}", 0.045, (x, y0, z0), (x, y1, z1), body, 6))
    for i, y in enumerate((1.2, 0.4, -0.4, -1.2)):
        z = rail_z(y)
        parts.append(infantry.rod(f"trestle_{side}_{i}", 0.022, (x, y, z), (side * (rail_x + 0.18), y, 0.06), dark, 4))
for i, y in enumerate((1.2, 0.4, -0.4, -1.2)):
    parts.append(infantry.rod(f"tie_{i}", 0.02, (-rail_x, y, rail_z(y)), (rail_x, y, rail_z(y)), dark, 4))
parts.append(drones.plate("shoe", [(-0.2, 1.3, rail_z(1.3)), (0.2, 1.3, rail_z(1.3)), (0.2, 0.9, rail_z(0.9)), (-0.2, 0.9, rail_z(0.9))], 0.02, yellow))
# Rear blast wall with the team band; scorched deflector in front of it.
parts.append(lib.box("blast_wall", (1.7, 0.2, 0.6), (0, 1.78, 0.35), body))
parts.append(lib.box("blast_band", (1.72, 0.03, 0.12), (0, 1.67, 0.48), team, bevel=0))
parts.append(drones.plate("deflector", [(-0.5, 1.68, 0.5), (0.5, 1.68, 0.5), (0.5, 1.45, 0.06), (-0.5, 1.45, 0.06)], 0.03, dark))
# Prep container, a jerry-can stack and the camouflage net poles.
parts.append(lib.box("container", (0.62, 1.3, 0.56), (1.08, 0.6, 0.34), body))
parts.append(lib.box("container_stripe", (0.64, 0.14, 0.58), (1.08, 0.1, 0.34), team, bevel=0))
parts.append(lib.box("container_door", (0.02, 0.4, 0.42), (0.765, 0.8, 0.33), dark, bevel=0))
parts += drones.row("bag_left", 8, (0.26, 0.4, 0.2), (-1.3, -1.5, 0.15), (0, 0.42, 0), body)
parts += drones.row("bag_left_hi", 5, (0.26, 0.4, 0.17), (-1.3, -0.9, 0.33), (0, 0.42, 0), body)
parts += drones.row("cans", 4, (0.2, 0.26, 0.28), (0.6, -1.5, 0.2), (0.23, 0, 0), yellow)
for i, (x, y) in enumerate(((-0.95, 1.7), (1.2, -1.75))):
    parts.append(infantry.rod(f"pole_{i}", 0.02, (x, y, 0.05), (x, y, 0.92), dark, 4))
    parts.append(lib.box(f"pole_flag_{i}", (0.22, 0.02, 0.1), (x + 0.11, y, 0.87), team, bevel=0))
root = lib.join(parts, "ua-missile-site")

lib.export("ua-missile-site", root)
