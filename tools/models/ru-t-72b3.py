"""ru-t-72b3: low hull, rounded cast turret with ERA, long 125 mm gun and an anti-drone cage (spec 06)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

lib.reset_scene()
m = lib.palette("russia")

# Render box: 0.80 wide (x), 0.55 high (z), 1.25 long (y); front is -Y.
track_w, track_h, half_track = 0.18, 0.16, 0.31
hull_len = 0.92
tracks = lib.tracks("tracks", hull_len, track_w, track_h, half_track, m["dark"])
wheels = lib.wheels("roadwheels", 6, 0.07, track_w, hull_len - 0.16, half_track, 0.08, m["dark"])
hull = lib.wedge("hull", (0.62, hull_len, 0.14), (0, 0.12, 0.2), m["body"], slope=0.25)
glacis_era = lib.box("glacis_era", (0.5, 0.12, 0.03), (0, -0.28, 0.25), m["team"])
skirts = lib.join(
    [lib.box(f"skirt_{s}", (0.03, hull_len - 0.1, 0.08), (s * 0.385, 0.07, 0.2), m["team"]) for s in (-1, 1)],
    "skirts",
)
fuel = lib.join(
    [lib.cylinder(f"drum_{s}", 0.05, 0.16, (s * 0.2, 0.55, 0.27), m["dark"], 8, "X") for s in (-1, 1)],
    "fuel_drums",
)
root = lib.join([hull, tracks, wheels, glacis_era, skirts, fuel], "ru-t-72b3")

pivot = (0, 0.18, 0.27)
dome = lib.cylinder("dome", 0.2, 0.12, (0, 0.18, 0.33), m["body"], 10)
era = lib.join(
    [lib.box(f"era_{s}", (0.1, 0.12, 0.06), (s * 0.13, 0.02, 0.35), m["team"]) for s in (-1, 1)],
    "turret_era",
)
cupola = lib.cylinder("cupola", 0.06, 0.05, (0.08, 0.26, 0.42), m["dark"], 6)
# Anti-drone cage over the turret: four posts, a frame and a grid (field photos).
# The roof is a thin plate with the `cage` material: the game draws it as a
# transparent grid texture, so the posts are the only solid geometry.
cage_parts = []
for sx in (-1, 1):
    for sy in (-1, 1):
        cage_parts.append(lib.box(f"cage_post_{sx}_{sy}", (0.012, 0.012, 0.13), (sx * 0.19, 0.2 + sy * 0.17, 0.44), m["dark"], bevel=0))
cage_posts = lib.join(cage_parts, "anti_drone_posts")
cage = lib.box("anti_drone_cage", (0.42, 0.38, 0.01), (0, 0.2, 0.51), m["cage"], bevel=0)
gun = lib.barrel("gun", 0.62, 0.025, (0, 0.0, 0.34), m["dark"])
turret = lib.turret([dome, era, cupola, cage_posts, cage, gun], pivot)
lib.parent(turret, root)

lib.export("ru-t-72b3", root)
