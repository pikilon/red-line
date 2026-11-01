"""ru-geran-3: the Geran wedge with a turbojet bottle on its back, no propeller (spec 43 §4.6)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import airframe  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 1.00 wide (x), 0.30 high (z), 1.10 long (y); front is -Y.
root, _ = airframe.geran(m, jet=True)

lib.export("ru-geran-3", root)
