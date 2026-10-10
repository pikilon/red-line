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
wheel_r, wheel_w, half_track = 0.09, 0.07, 0.24
wheels = lib.wheels("wheels", 2, wheel_r, wheel_w, 0.5, half_track, wheel_r, m["dark"])
hull = lib.wedge("hull", (0.52, 0.78, 0.18), (0, 0.0, 0.23), m["body"], slope=0.4)
taper(hull, front=0.4, back=0.85)
cab = lib.box("cab", (0.42, 0.3, 0.13), (0, -0.16, 0.34), m["body"])
windshield = lib.box("windshield", (0.36, 0.03, 0.08), (0, -0.3, 0.36), m["dark"])
deck = lib.box("deck", (0.34, 0.24, 0.05), (0, 0.22, 0.33), m["body"])
panels = lib.join(
    [lib.box(f"panel_{s}", (0.02, 0.26, 0.07), (s * 0.225, 0.1, 0.28), m["team"]) for s in (-1, 1)],
    "panels",
)
root = lib.join([hull, wheels, cab, windshield, deck, panels], "ru-brdm-scout")

pivot = (0, 0.06, 0.36)
dome = cone(lib.cylinder("dome", 0.11, 0.12, (0, 0.06, 0.39), m["body"], 8), 0.5)
sight = lib.box("sight", (0.05, 0.05, 0.04), (-0.07, 0.02, 0.47), m["dark"])
gun = lib.barrel("gun", 0.26, 0.016, (0, 0.05, 0.42), m["dark"])
turret = lib.turret([dome, sight, gun], pivot)
lib.parent(turret, root)

lib.export("ru-brdm-scout", root)
