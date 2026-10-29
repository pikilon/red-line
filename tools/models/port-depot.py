"""port-depot: a harbour cargo yard with stacked containers and a small crane (spec 36)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("neutral")

# Render box: 3.00 wide (x), 0.60 high (z), 2.00 deep (y); front is -Y.
pad = lib.box("pad", (2.9, 1.9, 0.05), (0.0, 0.0, 0.025), m["dark"])
containers = []
for i, (x, y, z) in enumerate(
    [(-0.85, -0.45, 0.05), (-0.85, 0.35, 0.05), (-0.85, -0.45, 0.31), (0.05, 0.35, 0.05)]
):
    containers.append(lib.box(f"container_{i}", (0.9, 0.36, 0.26), (x, y, z + 0.13), m["body"]))
crates = lib.join(
    [lib.box(f"crate_{i}", (0.24, 0.24, 0.2), (0.15 + 0.3 * i, -0.5, 0.15), m["body"]) for i in range(3)],
    "crates",
)
crane = lib.join(
    [
        lib.box("crane_leg", (0.08, 0.08, 0.52), (1.05, 0.35, 0.28), m["dark"]),
        lib.box("crane_arm", (0.08, 0.9, 0.06), (1.05, -0.05, 0.55), m["dark"]),
        lib.box("crane_hook", (0.04, 0.04, 0.2), (1.05, -0.45, 0.42), m["dark"]),
    ],
    "crane",
)
team = lib.box("team_front", (0.4, 0.02, 0.12), (-0.85, -0.64, 0.2), m["team"])
root = lib.join([pad, *containers, crates, crane, team], "port-depot")

lib.export("port-depot", root)
