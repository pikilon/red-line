"""cn-hj-team: HJ-12 gunner and spotter."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = infantry.palette("china")

# Render box: 0.40 wide (x), 0.50 high (z), 0.40 long (y); front is -Y.
# Two men with a clear gap (as ru-rpg-gunner): the gunner `g` aiming the launcher
# from the right shoulder and a spotter `a` behind him.
limbs = infantry.place(infantry.rpg_gunner("gunner", m, segments=6, earcups=False), "g", 0.5, (-0.096, -0.03))
limbs |= infantry.place(infantry.rifleman("spotter", m, segments=6, earcups=False), "a", 0.5, (0.096, 0.03))
infantry.centre(limbs)
root = infantry.assemble("cn-hj-team", limbs)

lib.export("cn-hj-team", root)
