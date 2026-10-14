"""ua-stugna-team: Stugna-P ATGM tripod launcher and kneeling operator (spec 17)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("ukraine")
body, team, dark = m["body"], m["team"], m["dark"]

# Render box: 0.40 wide (x), 0.50 high (z), 0.40 long (y); front is -Y.
# Ukrainian Stugna-P (Skif) ATGM on tripod with optical guidance module (PN-I),
# PDU-215 remote control suitcase console, and kneeling Ukrainian operator.

parts = []

# === PART A: STUGNA-P ATGM LAUNCHER ===
tx, ty, tz = -0.06, -0.02, 0.20

# Tripod Legs (tubular legs spread to ground)
parts.append(
    lib.bone("leg_f", (tx, ty, tz), (tx, ty - 0.12, 0.015), 0.012, 0.008, dark, 6)
)
parts.append(
    lib.bone(
        "leg_rl",
        (tx, ty, tz),
        (tx - 0.11, ty + 0.10, 0.015),
        0.012,
        0.008,
        dark,
        6,
    )
)
parts.append(
    lib.bone(
        "leg_rr",
        (tx, ty, tz),
        (tx + 0.10, ty + 0.10, 0.015),
        0.012,
        0.008,
        dark,
        6,
    )
)
parts.append(
    lib.cylinder("foot_f", 0.016, 0.015, (tx, ty - 0.12, 0.01), dark, 6, "Z")
)
parts.append(
    lib.cylinder(
        "foot_rl", 0.016, 0.015, (tx - 0.11, ty + 0.10, 0.01), dark, 6, "Z"
    )
)
parts.append(
    lib.cylinder(
        "foot_rr", 0.016, 0.015, (tx + 0.10, ty + 0.10, 0.01), dark, 6, "Z"
    )
)

# Swivel Mount Hub
parts.append(
    lib.cylinder("hub", 0.024, 0.045, (tx, ty, tz + 0.02), dark, 6, "Z")
)

# Optical Guidance Unit (PN-I module)
parts.append(
    lib.box(
        "optic_box",
        (0.052, 0.075, 0.048),
        (tx, ty - 0.01, tz + 0.065),
        dark,
        bevel=0.004,
    )
)
parts.append(
    lib.cylinder(
        "lens", 0.015, 0.012, (tx, ty - 0.050, tz + 0.065), dark, 6, "Y"
    )
)

# 130mm Missile Launch Container (RK-2S container in body/camo)
tube_z = tz + 0.120
parts.append(
    lib.cylinder("tube", 0.034, 0.22, (tx, ty - 0.020, tube_z), body, 8, "Y")
)
parts.append(
    lib.cylinder(
        "tube_front", 0.037, 0.02, (tx, ty - 0.125, tube_z), dark, 8, "Y"
    )
)
parts.append(
    lib.cylinder(
        "tube_rear", 0.036, 0.02, (tx, ty + 0.085, tube_z), dark, 8, "Y"
    )
)

# === PART B: PDU-215 REMOTE CONTROL CONSOLE ===
cx, cy, cz = 0.06, 0.01, 0.08
parts.append(
    lib.box(
        "pdu_base", (0.065, 0.055, 0.018), (cx, cy, cz), dark, bevel=0.003
    )
)
parts.append(
    lib.box(
        "pdu_screen",
        (0.065, 0.012, 0.048),
        (cx, cy - 0.025, cz + 0.026),
        dark,
        bevel=0.002,
    )
)
parts.append(
    lib.cylinder(
        "cable", 0.005, 0.12, ((tx + cx) / 2, (ty + cy) / 2, 0.02), dark, 6, "X"
    )
)

# === PART C: KNEELING OPERATOR ===
operator = lib.modern_soldier(
    "operator",
    "remote",
    m,
    height=0.48,
    pose="kneeling",
    faction="ua",
    has_pack=True,
)
operator.location.x += 0.08
operator.location.y += 0.07
parts.append(operator)

root = lib.join(parts, "ua-stugna-team")
lib.export("ua-stugna-team", root)
