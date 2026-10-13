"""ru-brdm-scout: 4x4 boat-hulled amphibious scout car, small conical turret (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402


def taper(obj, front, back):
    """Narrows the hull towards the bow and stern for the boat-shaped plan."""
    for v in obj.data.vertices:
        v.co.x *= front if v.co.y < 0 else back
    return obj


def cone(obj, factor):
    """Truncates the top ring of a cylinder into a shallow cone."""
    top = max(v.co.z for v in obj.data.vertices)
    for v in obj.data.vertices:
        if v.co.z > top - 1e-4:
            v.co.x *= factor
            v.co.y *= factor
    return obj


lib.reset_scene()
m = lib.palette("russia")

# Render box: 0.60 wide (x), 0.50 high (z), 0.90 long (y); front is -Y.
# Reference: BRDM-2 (boat hull, sloped glacis with trim vane, big 4x4 wheels,
# wheel arches, small conical turret on the roof with a KPVT on its side).
wheel_r, wheel_w, half_track = 0.1, 0.08, 0.255
wheels = lib.wheels("wheels", 2, wheel_r, wheel_w, 0.54, half_track, wheel_r, m["dark"], 10)
hull = lib.wedge("hull", (0.5, 0.82, 0.17), (0, -0.01, 0.215), m["body"], slope=0.45)
taper(hull, front=0.55, back=0.9)
cab = lib.box("cab", (0.42, 0.34, 0.1), (0, -0.1, 0.325), m["body"])
windshield = lib.box("windshield", (0.38, 0.03, 0.05), (0, -0.28, 0.34), m["dark"])
deck = lib.box("deck", (0.4, 0.3, 0.06), (0, 0.24, 0.31), m["body"])
vane = lib.box("trim_vane", (0.34, 0.03, 0.12), (0, -0.4, 0.3), m["body"], bevel=0)
bumper = lib.box("bumper", (0.46, 0.05, 0.06), (0, -0.42, 0.17), m["dark"])
arches = lib.join(
    [lib.box(f"arch_{s}_{y}", (0.05, 0.2, 0.04), (s * 0.28, y, 0.2), m["body"]) for s in (-1, 1) for y in (-0.24, 0.3)],
    "wheel_arches",
)
panels = lib.join(
    [lib.box(f"panel_{s}", (0.02, 0.3, 0.1), (s * 0.235, 0.03, 0.27), m["team"]) for s in (-1, 1)],
    "panels",
)
root = lib.join([hull, wheels, cab, windshield, deck, vane, bumper, arches, panels], "ru-brdm-scout")

pivot = (0, 0.06, 0.38)
dome = cone(lib.cylinder("dome", 0.12, 0.1, (0, 0.06, 0.41), m["body"], 8), 0.55)
sight = lib.box("sight", (0.05, 0.05, 0.05), (-0.09, 0.02, 0.465), m["dark"])
gun = lib.barrel("gun", 0.3, 0.017, (0.07, 0.05, 0.44), m["dark"])
turret = lib.turret([dome, sight, gun], pivot)
lib.parent(turret, root)

lib.export("ru-brdm-scout", root)
