"""ru-rifleman: three-soldier rifle fireteam (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 0.30 wide (x), 0.60 high (z), 0.30 long (y); front is -Y.
# Two soldiers abreast in front and one covering behind.
soldiers = []
for i, (x, y) in enumerate([(-0.05, 0.035), (0.05, 0.035), (0.0, 0.075)]):
    soldier = lib.soldier(f"rifleman_{i}", "rifle", m, height=0.48)
    soldier.location.x += x
    soldier.location.y += y
    soldiers.append(soldier)
root = lib.join(soldiers, "ru-rifleman")

lib.export("ru-rifleman", root)
