"""ru-rifleman: three-soldier rifle fireteam (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 0.30 wide (x), 0.60 high (z), 0.30 long (y); front is -Y.
# Two men abreast and one behind fill the small box as a fireteam.
soldiers = []
for i, (x, y) in enumerate([(-0.07, 0.055), (0.07, 0.055), (0.0, 0.1)]):
    soldier = lib.soldier(f"rifleman_{i}", "rifle", m, height=0.5)
    soldier.location.x += x
    soldier.location.y += y
    soldiers.append(soldier)
root = lib.join(soldiers, "ru-rifleman")

lib.export("ru-rifleman", root)
