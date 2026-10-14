"""ru-rpg-gunner: Russian RPG-7 gunner with rocket pack and spare rockets (spec 17)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 0.35 wide (x), 0.55 high (z), 0.35 long (y); front is -Y.
soldier = lib.modern_soldier(
    "ru-rpg-gunner",
    "rpg",
    m,
    height=0.52,
    faction="ru",
    has_rocket_pack=True,
    has_spare_crate=True,
)

lib.export("ru-rpg-gunner", soldier)
