"""ru-airfield: concrete runway strip, earth revetments and a tower (spec 43 §4.6)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import airframe  # noqa: E402
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")
body, team, dark = m["body"], m["team"], m["dark"]
mark = lib.material("mark", airframe.MARK)

# Render box: 6.00 wide (x), 1.20 high (z), 4.00 deep (y); front is -Y.
# Runway along the back edge, two open aircraft bays facing it, tower on the
# right where it can see both.
pad = lib.box("pad", (5.96, 3.96, 0.06), (0, 0, 0.03), body, bevel=0)
runway = lib.box("runway", (5.9, 1.5, 0.05), (0, 1.14, 0.075), dark, bevel=0)
parts = [pad, runway]
for i in range(9):
    parts.append(lib.box(f"centre_dash_{i}", (0.34, 0.07, 0.01), (-2.2 + i * 0.55, 1.14, 0.105), mark, bevel=0))
for s in (-1, 1):
    for i in range(5):
        parts.append(lib.box(f"threshold_{s}_{i}", (0.26, 0.11, 0.01), (s * 2.72, 0.66 + i * 0.24, 0.105), mark, bevel=0))
for s in (-1, 1):
    parts.append(lib.box(f"edge_{s}", (5.9, 0.04, 0.01), (0, 1.14 + s * 0.68, 0.105), mark, bevel=0))
parts.append(lib.box("apron", (5.0, 0.3, 0.03), (-0.2, 0.24, 0.07), dark, bevel=0))


def revetment(cx):
    """U-shaped earth berm open to the taxiway, with a dark floor."""
    h = 0.34
    pieces = [
        lib.box(f"bay_floor_{cx}", (1.72, 1.56, 0.02), (cx, -0.98, 0.07), dark, bevel=0),
        lib.box(f"bay_back_{cx}", (2.1, 0.22, h), (cx, -1.84, h / 2 + 0.06), body),
    ]
    for s in (-1, 1):
        pieces.append(lib.box(f"bay_side_{cx}_{s}", (0.2, 1.7, h), (cx + s * 0.95, -0.95, h / 2 + 0.06), body))
        for y in (-1.5, -1.0, -0.5):
            pieces.append(lib.box(f"bay_sandbag_{cx}_{s}_{y}", (0.26, 0.34, 0.07), (cx + s * 0.95, y, h + 0.09), dark, bevel=0))
    pieces.append(lib.box(f"bay_team_{cx}", (2.12, 0.1, 0.07), (cx, -1.84, h + 0.095), team, bevel=0))
    return pieces


parts += revetment(-1.75)
parts += revetment(0.65)

# Control tower: a concrete block, a glass cab and a team-coloured roof.
tx, ty = 2.45, -1.0
parts += [
    lib.box("tower_base", (0.92, 1.1, 0.32), (tx, ty, 0.22), body),
    lib.box("tower_shaft", (0.5, 0.5, 0.56), (tx, ty, 0.64), body),
    lib.box("tower_glass", (0.68, 0.68, 0.17), (tx, ty, 0.98), dark, bevel=0),
    lib.box("tower_roof", (0.8, 0.8, 0.06), (tx, ty, 1.09), team),
    lib.cylinder("tower_mast", 0.015, 0.08, (tx, ty, 1.16), dark, 4, bevel=0),
    lib.cylinder("radar_post", 0.03, 0.26, (tx + 0.3, ty + 0.34, 0.5), dark, 6, bevel=0),
    lib.box("radar_bar", (0.34, 0.05, 0.08), (tx + 0.3, ty + 0.34, 0.66), dark, bevel=0),
]
for i, x in enumerate((2.1, 2.45, 2.8)):
    parts.append(lib.cylinder(f"fuel_{i}", 0.13, 0.5, (x, -0.1, 0.19), dark, 8, "Y"))

root = lib.join(parts, "ru-airfield")
lib.export("ru-airfield", root)
