"""ua-drone-workshop: improvised tin shed, benches and drone frames in the yard (spec 43)."""

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


def frame(prefix, x, y, z, reach, bar, mat):
    """A bare X drone frame lying flat, with its four motors."""
    parts = [
        infantry.rod(f"{prefix}_a", bar, (x - reach, y - reach, z), (x + reach, y + reach, z), mat, 4),
        infantry.rod(f"{prefix}_b", bar, (x - reach, y + reach, z), (x + reach, y - reach, z), mat, 4),
        lib.box(f"{prefix}_plate", (reach * 0.6, reach * 0.7, bar * 2.5), (x, y, z + bar), dark, bevel=0),
    ]
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1))):
        parts.append(
            lib.cylinder(f"{prefix}_motor_{i}", reach * 0.22, bar * 3, (x + sx * reach, y + sy * reach, z + bar), dark, 6, "Z", bevel=0)
        )
    return parts


def bench(prefix, x, y, width):
    """A plank bench on four legs with two frames on it."""
    top = 0.3
    parts = [lib.box(f"{prefix}_top", (width, 0.42, 0.04), (x, y, top), body, bevel=0)]
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1))):
        parts.append(lib.box(f"{prefix}_leg_{i}", (0.04, 0.04, top), (x + sx * (width / 2 - 0.05), y + sy * 0.16, top / 2), dark, bevel=0))
    parts += frame(f"{prefix}_f0", x - width / 4, y, top + 0.04, 0.12, 0.012, dark)
    parts += frame(f"{prefix}_f1", x + width / 4, y, top + 0.04, 0.12, 0.012, team)
    return parts


# Render box (footprint 3x3): 3.00 wide (x), 1.15 high (z), 3.00 deep (y); front is -Y.
parts = [lib.box("yard", (2.9, 2.9, 0.05), (0, 0, 0.025), dark)]
# Shed: back and side walls of mismatched boards, open towards the yard.
parts.append(lib.box("back_wall", (2.7, 0.08, 0.74), (0, 1.3, 0.42), body))
parts.append(lib.box("left_wall", (0.08, 1.3, 0.66), (-1.31, 0.68, 0.38), body))
parts.append(lib.box("right_wall", (0.08, 0.8, 0.66), (1.31, 0.92, 0.38), body))
for i, x in enumerate((-1.31, -0.45, 0.45, 1.31)):
    parts.append(lib.box(f"post_{i}", (0.07, 0.07, 0.62), (x, 0.02, 0.36), dark, bevel=0))
parts.append(lib.box("lintel", (2.7, 0.07, 0.06), (0, 0.02, 0.68), dark, bevel=0))
# Roof of tin sheets, unequal and slightly askew; one sheet is the team flag.
sheets = (
    (-1.42, -0.62, 0.0, body),
    (-0.6, -0.08, 0.015, dark),
    (-0.1, 0.72, 0.0, team),
    (0.74, 1.42, 0.02, body),
)
for i, (x0, x1, lift, mat) in enumerate(sheets):
    parts.append(
        drones.plate(
            f"sheet_{i}",
            [
                (x0, -0.1, 0.72 + lift),
                (x1, -0.1 + lift, 0.72 + lift),
                (x1, 1.4, 0.84 + lift),
                (x0, 1.4, 0.84 + lift),
            ],
            0.02,
            mat,
        )
    )
# A big drone frame nailed to the roof: the sign of the shop.
parts += frame("sign", 0.32, 0.65, 0.86, 0.27, 0.02, yellow)
# Stove pipe and the antenna mast.
parts.append(lib.cylinder("stovepipe", 0.05, 0.42, (-0.95, 0.9, 0.92), dark, 6, "Z", bevel=0))
parts.append(infantry.rod("mast", 0.012, (1.25, 1.28, 0.8), (1.25, 1.28, 1.05), dark, 4))
# Yard: two benches, ammo crates, a half-built robot.
parts += bench("bench_a", -0.68, -0.48, 1.1)
parts += bench("bench_b", 0.72, -0.62, 0.95)
parts += drones.row("crate", 3, (0.28, 0.24, 0.18), (0.68, -1.22, 0.14), (0.28, 0, 0), body)
parts.append(lib.box("crate_top", (0.28, 0.24, 0.16), (0.82, -1.22, 0.31), body))
parts.append(lib.box("crate_tape", (0.05, 0.25, 0.165), (0.82, -1.22, 0.31), yellow, bevel=0))
robot = [
    lib.box("robot_deck", (0.3, 0.5, 0.05), (-0.8, -1.12, 0.17), body, bevel=0),
    lib.box("robot_box", (0.16, 0.14, 0.09), (-0.8, -1.05, 0.24), dark, bevel=0),
]
for sx in (-1, 1):
    for sy in (-1, 1):
        robot.append(lib.cylinder(f"robot_wheel_{sx}_{sy}", 0.09, 0.08, (-0.8 + sx * 0.2, -1.12 + sy * 0.2, 0.14), dark, 8, "X", bevel=0))
parts += robot
parts.append(lib.box("tarp", (0.5, 0.3, 0.1), (0.1, -1.1, 0.1), body))
root = lib.join(parts, "ua-drone-workshop")

lib.export("ua-drone-workshop", root)
