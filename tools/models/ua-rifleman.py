"""ua-rifleman: modern Ukrainian soldier (spec 17)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")

# Render box: 0.30 wide (x), 0.60 high (z), 0.30 long (y); front is -Y.
soldier = lib.modern_soldier("ua-rifleman", "rifle", m, height=0.54, faction="ua")

lib.export("ua-rifleman", soldier)
