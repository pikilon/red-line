"""ua-tw-12-7: small tracked robot under a very tall machine-gun mast (spec 43)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 0.46 wide (x), 0.62 high (z), 0.70 long (y); front is -Y.
tracks = lib.tracks("tracks", 0.62, 0.11, 0.13, 0.175, dark)
wheels = lib.wheels("roadwheels", 3, 0.05, 0.114, 0.42, 0.175, 0.06, dark)
hull = lib.box("hull", (0.25, 0.52, 0.13), (0, 0.02, 0.165), body)
# Slat cage bolted on the nose against FPVs.
slats = []
for i, z in enumerate((0.1, 0.17, 0.24)):
    slats.append(infantry.rod(f"slat_{i}", 0.006, (-0.2, -0.335, z), (0.2, -0.335, z), dark, 4))
for side in (-1, 1):
    slats.append(infantry.rod(f"slat_post_{side}", 0.007, (side * 0.17, -0.335, 0.08), (side * 0.17, -0.335, 0.26), dark, 4))
    slats.append(infantry.rod(f"slat_arm_{side}", 0.007, (side * 0.11, -0.22, 0.2), (side * 0.17, -0.335, 0.24), dark, 4))
panels = lib.join([lib.box(f"panel_{s}", (0.02, 0.3, 0.07), (s * 0.13, 0.02, 0.17), team, bevel=0) for s in (-1, 1)], "panels")
battery = lib.box("battery", (0.2, 0.15, 0.06), (0, 0.2, 0.26), dark, bevel=0)
whips = [
    infantry.rod("whip_0", 0.004, (-0.08, 0.26, 0.28), (-0.11, 0.3, 0.5), dark, 4),
    infantry.rod("whip_1", 0.004, (0.08, 0.26, 0.28), (0.1, 0.31, 0.44), dark, 4),
]
root = lib.join([hull, tracks, wheels, *slats, panels, battery, *whips], "ua-tw-12-7")

# The whole mast turns: a tall open frame with the Wolly remote station on top.
pivot = (0, 0.02, 0.23)
ring = lib.cylinder("ring", 0.075, 0.03, (0, 0.02, 0.245), body, 8, "Z", bevel=0)
frame = []
for side in (-1, 1):
    frame.append(infantry.rod(f"post_{side}", 0.011, (side * 0.07, 0.02, 0.25), (side * 0.07, 0.02, 0.5), dark))
frame.append(infantry.rod("brace", 0.009, (-0.07, 0.02, 0.38), (0.07, 0.02, 0.38), dark))
cradle = lib.box("cradle", (0.17, 0.2, 0.05), (0, 0.02, 0.51), body, bevel=0)
stripe = lib.box("stripe", (0.175, 0.05, 0.054), (0, 0.08, 0.51), team, bevel=0)
receiver = lib.box("receiver", (0.05, 0.22, 0.05), (0, 0.0, 0.56), dark, bevel=0)
gun = lib.barrel("gun", 0.235, 0.012, (0, -0.1, 0.565), dark)
ammo = lib.box("ammo", (0.07, 0.1, 0.07), (0.085, 0.02, 0.565), body, bevel=0)
sensor = lib.box("sensor", (0.06, 0.08, 0.06), (-0.075, -0.02, 0.565), dark, bevel=0)
lens = lib.box("lens", (0.044, 0.008, 0.044), (-0.075, -0.064, 0.565), team, bevel=0)
turret = lib.turret([ring, *frame, cradle, stripe, receiver, gun, ammo, sensor, lens], pivot)
lib.parent(turret, root)

lib.export("ua-tw-12-7", root)
