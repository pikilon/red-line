"""ru-rpg-gunner: RPG-7 gunner and assistant pair (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 0.35 wide (x), 0.55 high (z), 0.35 long (y); front is -Y.
# The gunner carries the launcher, the assistant a rifle; the long tube is the
# silhouette that marks the anti-tank team.
gunner = lib.soldier("rpg_gunner", "launcher", m, height=0.5)
gunner.location.x -= 0.05
gunner.location.y += 0.02
assistant = lib.soldier("rpg_assistant", "rifle", m, height=0.5)
assistant.location.x += 0.06
assistant.location.y += 0.05
root = lib.join([gunner, assistant], "ru-rpg-gunner")

lib.export("ru-rpg-gunner", root)
