"""ua-rifleman: Ukrainian rifleman at low ready (spec 17)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = infantry.palette("ukraine")

# Render box: 0.30 wide (x), 0.60 high (z), 0.30 long (y); front is -Y.
# One soldier per unit, as in C&C Generals.
root = infantry.place(infantry.rifleman("ua-rifleman", m), "ua-rifleman", 0.54)
infantry.centre(root)

lib.export("ua-rifleman", root)
