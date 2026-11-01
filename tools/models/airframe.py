"""Shared shapes for the Russian air and EW models (spec 43 §4.6).

Flat plates and fins for wings, `prop` nodes (the client spins them about Y) and
the Geran airframe. Same conventions as lib.py: 1 unit = 1 tile, front -Y, +Z up.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import infantry
import lib

# The fixed white of Russian markings (infantry.MARK).
MARK = "#e8e4d8"


def prism(name, outline, offset, mat):
    """Closed slab from a 3D `outline` swept by `offset`: flat shaded, sharp."""
    n = len(outline)
    near = [Vector(p) for p in outline]
    far = [p + Vector(offset) for p in near]
    faces = [list(range(n)), list(range(2 * n - 1, n - 1, -1))]
    faces += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(near + far, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def plate(name, outline, z, thickness, mat):
    """Horizontal slab with its top at `z` from an (x, y) outline."""
    return prism(name, [(x, y, z) for x, y in outline], (0, 0, -thickness), mat)


def symmetric(half):
    """Full outline from the +x half, listed from the nose round to the tail."""
    return half + [(-x, y) for x, y in reversed(half) if abs(x) > 1e-6]


def flipped(outline):
    """The outline mirrored to the other side of the centreline."""
    return [(-x, y) for x, y in outline]


def fin(name, profile, x, thickness, mat, cant=0.0):
    """Vertical slab from a (y, z) profile; `cant` leans it by x per unit of z."""
    z0 = min(z for _, z in profile)
    return prism(name, [(x + cant * (z - z0), y, z) for y, z in profile], (thickness, 0, 0), mat)


def pitch(obj, angle, pivot):
    """Bakes `obj` and raises its -Y end by `angle` radians about `pivot`."""
    bpy.context.view_layer.update()
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    centre = Vector(pivot)
    obj.data.transform(Matrix.Translation(centre) @ Matrix.Rotation(-angle, 4, "X") @ Matrix.Translation(-centre))
    obj.data.update()
    return obj


def prop(hub, radius, chord, mat):
    """The `prop` node: two blades and a spinner, origin on the hub, spinning about Y."""
    x, y, z = hub
    # Twisted about the blade axis so a still prop shows area from above and behind.
    blades = pitch(lib.box("blades", (2 * radius, chord, 0.012), hub, mat, bevel=0), math.radians(40), hub)
    spinner = lib.cylinder("spinner", chord * 0.75, 0.06, (x, y, z), mat, 8, "Y", bevel=0)
    return lib.turret([blades, spinner], hub, "prop")


def geran(m, jet=False):
    """Geran airframe at full size (span 1.00), or `jet` for the Geran-3: a wide
    delta wedge with wingtip fins and a team chevron on each wing. Returns the
    joined body and, for the piston version, the hub of its pusher propeller."""
    body, team, dark = m["body"], m["team"], m["dark"]
    zc = 0.14
    nose = -0.55 if jet else -0.525
    fuselage = infantry.loft(
        "fuselage",
        [
            ((0, nose, zc), 0, 0),
            ((0, nose + 0.05, zc), 0.05, 0.045),
            ((0, -0.3, zc), 0.085, 0.07),
            ((0, 0.1, zc), 0.085, 0.07),
            ((0, 0.4, zc), 0.05, 0.05),
        ],
        body,
        segments=6,
        smooth=False,
    )
    warhead = infantry.loft(
        "warhead",
        [((0, nose - 0.003, zc), 0, 0), ((0, nose + 0.05, zc), 0.054, 0.05), ((0, nose + 0.13, zc), 0.074, 0.062)],
        dark,
        segments=6,
        smooth=False,
    )
    leading = lambda x: -0.34 + 1.28 * x  # noqa: E731
    wing = plate(
        "wing",
        symmetric([(0, -0.34), (0.5, 0.3), (0.5, 0.44), (0.24, 0.4), (0.1, 0.34), (0, 0.34)]),
        zc + 0.015,
        0.03,
        body,
    )
    parts = [wing, fuselage, warhead]
    for s in (-1, 1):
        band = [(0.15, leading(0.15) + 0.05), (0.43, leading(0.43) + 0.05), (0.43, leading(0.43) + 0.2), (0.15, leading(0.15) + 0.2)]
        parts.append(plate(f"chevron_{s}", band if s > 0 else flipped(band), zc + 0.025, 0.012, team))
        parts.append(fin(f"fin_{s}", [(0.27, 0.02), (0.46, 0.02), (0.48, 0.26), (0.39, 0.26)], s * 0.4875 - 0.0125, 0.025, body))
    if jet:
        # Turbojet bottle bolted onto the back: the one thing that tells it from the Geran-2.
        parts.append(lib.box("pod_pylon", (0.05, 0.3, 0.06), (0, 0.2, 0.2), dark, bevel=0))
        parts.append(
            infantry.loft(
                "jet_pod",
                [((0, 0.0, 0.23), 0.045, 0.045), ((0, 0.06, 0.23), 0.075, 0.07), ((0, 0.4, 0.23), 0.08, 0.07), ((0, 0.53, 0.23), 0.06, 0.055)],
                body,
                segments=8,
                smooth=False,
            )
        )
        parts.append(lib.cylinder("intake", 0.044, 0.02, (0, 0.0, 0.23), dark, 8, "Y", bevel=0))
        parts.append(lib.cylinder("exhaust", 0.05, 0.03, (0, 0.54, 0.23), dark, 8, "Y", bevel=0))
        return lib.join(parts, "airframe"), None
    parts.append(lib.cylinder("engine", 0.06, 0.1, (0, 0.42, zc), dark, 8, "Y", bevel=0))
    return lib.join(parts, "airframe"), (0, 0.49, zc)
