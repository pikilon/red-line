"""ru-rpg-gunner: RPG-7 gunner and his assistant carrying spare rounds (spec 18)."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = infantry.palette("russia")

# Render box: 0.40 wide (x), 0.55 high (z), 0.40 long (y); front is -Y.
# Two separate men with a clear gap: the gunner standing on the left, the
# assistant with the rocket carrier kneeling behind him on the right.
gunner = infantry.place(
    infantry.rpg_gunner("gunner", m, segments=6, earcups=False), "gunner", 0.5, (-0.102, -0.03)
)
assistant = infantry.place(
    infantry.rifleman("assistant", m, segments=6, pack="rpg", earcups=False, kneel=True),
    "assistant",
    0.5,
    (0.102, 0.03),
    math.radians(-12),
)
root = lib.join([gunner, assistant], "ru-rpg-gunner")
infantry.centre(root)

lib.export("ru-rpg-gunner", root)
