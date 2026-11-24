"""us-ranger: US Army Ranger at low ready (spec 53)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = infantry.palette("usa")

# Render box: 0.30 wide (x), 0.60 high (z), 0.30 long (y); front is -Y.
# One soldier per unit, as in C&C Generals.
limbs = infantry.place(infantry.rifleman("us-ranger", m), "m", 0.54)
infantry.centre(limbs)
root = infantry.assemble("us-ranger", limbs)

lib.export("us-ranger", root)
