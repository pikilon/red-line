"""ua-ratel: go-kart-sized one-way ground drone with two AT mines strapped on (spec 43)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drones  # noqa: E402
import infantry  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")
yellow = lib.material("mark", drones.MARK)
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 0.40 wide (x), 0.26 high (z), 0.56 long (y); front is -Y.
wheel_r, half_track = 0.075, 0.165
wheels = lib.wheels("wheels", 2, wheel_r, 0.07, 0.38, half_track, wheel_r, dark, 10)
deck = lib.box("deck", (0.24, 0.44, 0.03), (0, 0, 0.09), body, bevel=0)
axles = [infantry.rod(f"axle_{y}", 0.009, (-half_track, y, wheel_r), (half_track, y, wheel_r), dark) for y in (-0.19, 0.19)]
# Tubular bumper welded to the deck: the hand-made look.
bumper = [
    infantry.rod("bumper_bar", 0.012, (-0.13, -0.265, 0.13), (0.13, -0.265, 0.13), body),
    infantry.rod("bumper_l", 0.01, (-0.13, -0.265, 0.13), (-0.1, -0.2, 0.09), body),
    infantry.rod("bumper_r", 0.01, (0.13, -0.265, 0.13), (0.1, -0.2, 0.09), body),
]
# Two TM-62 mines under a team strap, with the yellow fuze cap.
mines = []
for i, y in enumerate((-0.11, 0.07)):
    mines.append(lib.cylinder(f"mine_{i}", 0.085, 0.055, (0, y, 0.135), dark, 10, "Z", bevel=0.008))
    mines.append(lib.cylinder(f"fuze_{i}", 0.024, 0.016, (0, y, 0.17), yellow, 6, "Z", bevel=0))
strap = lib.box("strap", (0.2, 0.05, 0.012), (0, -0.02, 0.17), team, bevel=0)
strap_long = lib.box("strap_long", (0.05, 0.34, 0.012), (0, -0.02, 0.169), team, bevel=0)
# Radio box at the tail with two uneven whip antennas.
radio = lib.box("radio", (0.13, 0.07, 0.06), (0.02, 0.19, 0.135), body, bevel=0)
tape = lib.box("radio_tape", (0.135, 0.02, 0.064), (0.02, 0.19, 0.135), yellow, bevel=0)
whips = [
    infantry.rod("whip_0", 0.004, (-0.04, 0.2, 0.16), (-0.07, 0.235, 0.26), dark, 4),
    infantry.rod("whip_1", 0.004, (0.07, 0.2, 0.16), (0.09, 0.225, 0.235), dark, 4),
]
root = lib.join([deck, wheels, *axles, *bumper, *mines, strap, strap_long, radio, tape, *whips], "ua-ratel")

lib.export("ua-ratel", root)
