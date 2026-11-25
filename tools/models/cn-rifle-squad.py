"""cn-rifle-squad: Chinese rifle squad soldier at low ready (spec 18)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = infantry.palette("china")

# Render box: 0.30 wide (x), 0.60 high (z), 0.30 long (y); front is -Y.
# One soldier per unit, as in C&C Generals.
limbs = infantry.place(infantry.rifleman("cn-rifle-squad", m), "m", 0.54)
infantry.centre(limbs)
root = infantry.assemble("cn-rifle-squad", limbs)

lib.export("cn-rifle-squad", root)
