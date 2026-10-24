"""ru-rifleman: Russian rifleman at low ready (spec 18)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = infantry.palette("russia")

# Render box: 0.30 wide (x), 0.60 high (z), 0.30 long (y); front is -Y.
# One soldier per unit, as in C&C Generals.
limbs = infantry.place(infantry.rifleman("ru-rifleman", m), "m", 0.54)
infantry.centre(limbs)
root = infantry.assemble("ru-rifleman", limbs)

lib.export("ru-rifleman", root)
