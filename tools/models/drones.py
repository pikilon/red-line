"""Shared parts of the drone, robot and missile model scripts (spec 43 §4.6).

Not a model: `build.mjs` running it builds nothing. A rotor is its own node
named `prop_<n>` with its origin on the hub, so the client spins it.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector, geometry

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

# The yellow of the Ukrainian flag (spec 18 §3).
MARK = "#e3b72e"


def _object(name, bm, mat):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(mat)
    return obj


def plate(name, points, thickness, mat):
    """Flat polygon through the coplanar `points`, `thickness` thick: wings, fins,
    roof sheets."""
    points = [Vector(p) for p in points]
    half = geometry.normal(points) * thickness / 2
    bm = bmesh.new()
    top = [bm.verts.new(p + half) for p in points]
    bottom = [bm.verts.new(p - half) for p in points]
    bm.faces.new(top)
    bm.faces.new(bottom)
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top[i], top[j], bottom[j], bottom[i]))
    return _object(name, bm, mat)


def mirrored(name, points, thickness, mat):
    """`plate` and its reflection across x = 0, as a list of two objects."""
    return [
        plate(f"{name}_r", points, thickness, mat),
        plate(f"{name}_l", [(-p[0], p[1], p[2]) for p in points], thickness, mat),
    ]


def facet_loft(name, sections, mat):
    """Box-section hull along Y through `sections` of (y, half bottom width, half
    top width, bottom z, top z): the faceted look of a low-observable airframe."""
    bm = bmesh.new()
    rings = [
        [
            bm.verts.new(v)
            for v in ((-bottom, y, z0), (bottom, y, z0), (top, y, z1), (-top, y, z1))
        ]
        for y, bottom, top, z0, z1 in sections
    ]
    for a, b in zip(rings, rings[1:]):
        for k in range(4):
            k1 = (k + 1) % 4
            bm.faces.new((a[k], a[k1], b[k1], b[k]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])
    return _object(name, bm, mat)


def rotor(index, centre, radius, chord, mat, blades=2, rest=math.radians(45), hub=None):
    """Node `prop_<index>` on `centre`: tapered blades around a hub. `rest` is the
    still angle; diagonal blades keep both axes of the render box filled."""
    cx, cy, cz = centre
    parts = []
    for b in range(blades):
        angle = rest + b * 2 * math.pi / blades
        along = Vector((math.cos(angle), math.sin(angle), 0))
        across = Vector((-along.y, along.x, 0))
        root, tip = along * radius * 0.1, along * radius
        parts.append(
            plate(
                f"prop_{index}_{b}",
                [
                    (cx + p.x, cy + p.y, cz)
                    for p in (
                        root - across * chord * 0.35,
                        tip - across * chord * 0.5,
                        tip + across * chord * 0.5,
                        root + across * chord * 0.35,
                    )
                ],
                radius * 0.04,
                mat,
            )
        )
    parts.append(lib.cylinder(f"prop_{index}_hub", radius * 0.14, radius * 0.12, centre, hub or mat, 6, "Z", bevel=0))
    return lib.turret(parts, centre, f"prop_{index}")


def row(prefix, count, size, start, step, mat):
    """A line of sandbags or crates: `count` boxes from `start`, advancing by `step`."""
    return [
        lib.box(f"{prefix}_{i}", size, (start[0] + step[0] * i, start[1] + step[1] * i, start[2]), mat)
        for i in range(count)
    ]
