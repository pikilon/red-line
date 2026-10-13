"""ru-rpg-gunner: RPG-7 gunner and assistant pair (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 0.35 wide (x), 0.55 high (z), 0.35 long (y); front is -Y.
# Gunner carries RPG-7 with protruding warhead and rocket pack.
# Assistant carries ammo pack with spare rockets and rifle.
gunner = lib.modern_soldier("rpg_gunner", "launcher", m, height=0.48, has_rocket_pack=True)
gunner.location.x -= 0.065
gunner.location.y += 0.035

assistant = lib.modern_soldier("rpg_assistant", "rifle", m, height=0.48, has_rocket_pack=True)
assistant.location.x += 0.065
assistant.location.y += 0.045

# Spare rocket ammo box on the ground between them
crate = lib.box("ammo_crate", (0.07, 0.06, 0.04), (0.0, 0.04, 0.02), m["dark"])
spare_rocket = lib.cylinder("spare_rocket", 0.012, 0.12, (0.0, 0.04, 0.045), m["body"], 6, "Y")
spare_head = lib.cylinder("spare_head", 0.025, 0.05, (0.0, -0.045, 0.045), m["dark"], 6, "Y")

root = lib.join([gunner, assistant, crate, spare_rocket, spare_head], "ru-rpg-gunner")

lib.export("ru-rpg-gunner", root)
