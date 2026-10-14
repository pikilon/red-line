"""ru-rifleman: modern Russian motor rifleman (spec 17)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 0.30 wide (x), 0.60 high (z), 0.30 long (y); front is -Y.
soldier = lib.modern_soldier("ru-rifleman", "rifle", m, height=0.54, faction="ru")

lib.export("ru-rifleman", soldier)
