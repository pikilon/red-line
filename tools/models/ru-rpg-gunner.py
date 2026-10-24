"""ru-rpg-gunner: RPG-7 gunner and his assistant carrying spare rounds (spec 18, 20)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = infantry.palette("russia")

# Render box: 0.40 wide (x), 0.55 high (z), 0.40 long (y); front is -Y.
# Two separate men with a clear gap, both modelled standing (the game kneels
# them while they hold a position): the gunner `g` on the left, the assistant
# `a` with the rocket carrier behind him on the right.
limbs = infantry.place(infantry.rpg_gunner("gunner", m, segments=6, earcups=False), "g", 0.5, (-0.102, -0.03))
limbs |= infantry.place(infantry.rifleman("assistant", m, segments=6, pack="rpg", earcups=False, spare=True), "a", 0.5, (0.102, 0.03))
infantry.centre(limbs)
root = infantry.assemble("ru-rpg-gunner", limbs)

lib.export("ru-rpg-gunner", root)
