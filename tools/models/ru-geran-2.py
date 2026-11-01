"""ru-geran-2: slow one-way delta wedge with a rear pusher propeller (spec 43 §4.6)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import airframe  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 1.00 wide (x), 0.27 high (z), 1.05 long (y); front is -Y.
root, hub = airframe.geran(m)
lib.parent(airframe.prop(hub, 0.135, 0.05, m["dark"]), root)

lib.export("ru-geran-2", root)
