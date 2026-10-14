"""Infantry figures for the procedural model scripts (spec 17 §3).

A soldier is built in figure units (1.0 = helmet top of a standing man), from
lofted tubes that run through the joints, so limbs bend at the knee and elbow
without gaps or seams, and are smooth shaded; gear (plate carrier, pouches,
boots, weapons) stays boxy and flat shaded, like the C&C Generals infantry.
`place()` scales the figure to tiles and moves it inside the render box.

Front is -Y, +Z up, same as lib.py. Joint coordinates below are figure units.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import lib

# Faceted limbs read as polygons; smooth across tube segments, sharp at caps
# and box edges (anything sharper than this angle).
SMOOTH_ANGLE = math.radians(65)
# Upper arm and forearm length.
ARM = 0.165

# Uniform base colours (sRGB), multiplied in game by the faction camouflage
# texture: MM-14 (Ukraine) and EMR "Tsifra" (Russia) are light, so infantry
# reads against the terrain instead of as a dark silhouette.
UNIFORM = {"ukraine": "#9aa070", "russia": "#8a8a5c"}
# Fixed-colour `mark`: the yellow of the Ukrainian flag under the team blue of
# armbands and helmet tape, and the white Z sprayed on Russian helmets.
MARK = {"ukraine": "#e3b72e", "russia": "#e8e4d8"}


def palette(faction):
    """lib.palette() with the light uniform base for `body`, the faction `mark`
    colour, and `faction` to pick the insignia."""
    mats = lib.palette(faction)
    mats["body"] = lib.material("body", UNIFORM[faction])
    mats["mark"] = lib.material("mark", MARK[faction])
    mats["faction"] = faction
    return mats


def _bake(obj):
    """Moves the object transform into its vertices (identity world matrix)."""
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    return obj


def transform(obj, matrix):
    """Applies `matrix` to the vertices of a baked object."""
    obj.data.transform(matrix)
    obj.data.update()
    return obj


def _mesh_object(name, bm, mat, smooth):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(mat)
    if smooth:
        mesh.shade_smooth()
        mesh.set_sharp_from_angle(angle=SMOOTH_ANGLE)
    return obj


def loft(name, rings, mat, segments=8, smooth=True, caps=True):
    """Closed tube through `rings` of (centre, rx, ry): ellipses perpendicular
    to the path, rx across (starts along X) and ry along the second axis. A
    ring with rx = ry = 0 is a pole (rounded end); other ends are capped."""
    centres = [Vector(c) for c, _, _ in rings]
    n = len(centres)
    tangents = [(centres[min(i + 1, n - 1)] - centres[max(i - 1, 0)]).normalized() for i in range(n)]
    t = tangents[0]
    ref = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 0, 1))
    u = (ref - ref.dot(t) * t).normalized()
    bm = bmesh.new()
    loops = []
    previous = t
    for (centre, rx, ry), t in zip(zip(centres, (r[1] for r in rings), (r[2] for r in rings)), tangents):
        u = previous.rotation_difference(t) @ u
        u = (u - u.dot(t) * t).normalized()
        v = t.cross(u)
        previous = t
        if rx == 0 and ry == 0:
            loops.append([bm.verts.new(centre)])
            continue
        loops.append(
            [
                bm.verts.new(
                    centre
                    + u * (rx * math.cos(2 * math.pi * k / segments))
                    + v * (ry * math.sin(2 * math.pi * k / segments))
                )
                for k in range(segments)
            ]
        )
    for a, b in zip(loops, loops[1:]):
        for k in range(segments):
            k1 = (k + 1) % segments
            if len(a) == 1:
                bm.faces.new((a[0], b[k1], b[k]))
            elif len(b) == 1:
                bm.faces.new((a[k], a[k1], b[0]))
            else:
                bm.faces.new((a[k], a[k1], b[k1], b[k]))
    for ring in (loops[0], loops[-1]) if caps else ():
        if len(ring) > 1:
            bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh_object(name, bm, mat, smooth)


def sphere(name, radius, centre, mat, segments=8, rings=6, scale=(1, 1, 1)):
    """Smooth low-poly ellipsoid."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    bmesh.ops.translate(bm, vec=centre, verts=bm.verts)
    return _mesh_object(name, bm, mat, True)


def box(name, size, centre, mat, bevel=0.0):
    """lib.box() baked to world coordinates (figure units)."""
    return _bake(lib.box(name, size, centre, mat, bevel=bevel))


def rod(name, radius, p1, p2, mat, segments=6):
    """Flat-shaded straight tube from p1 to p2."""
    return loft(name, [(p1, radius, radius), (p2, radius, radius)], mat, segments, smooth=False)


def z_mark(name, centre, right, up, mat, width=0.056, height=0.05, stroke=0.014):
    """Flat, one-sided letter Z facing `right` x `up`, centred on `centre`."""
    centre, right, up = Vector(centre), Vector(right).normalized(), Vector(up).normalized()
    w, h, t = width, height, stroke
    d = t * 1.5  # the diagonal stroke is as thick as the bars
    outline = [(0, h), (w, h), (w, h - t), (d, t), (w, t), (w, 0), (0, 0), (0, t), (w - d, h - t), (0, h - t)]
    bm = bmesh.new()
    verts = [bm.verts.new(centre + right * (u - w / 2) + up * (v - h / 2)) for u, v in outline]
    face = bm.faces.new(verts)
    bm.normal_update()
    if face.normal.dot(right.cross(up)) < 0:
        face.normal_flip()
    bmesh.ops.triangulate(bm, faces=[face])
    return _mesh_object(name, bm, mat, False)


def _elbow(shoulder, wrist, hint, length=ARM):
    """Elbow (or knee) of a two-bone limb bent towards `hint`."""
    shoulder, wrist = Vector(shoulder), Vector(wrist)
    axis = wrist - shoulder
    reach = axis.length
    axis.normalize()
    hint = Vector(hint)
    hint = (hint - hint.dot(axis) * axis).normalized()
    bend = math.sqrt(max(length * length - reach * reach / 4, 0.0004))
    return (shoulder + wrist) / 2 + hint * bend


def _lerp(a, b, f):
    return Vector(a).lerp(Vector(b), f)


def _rotation_x(angle, pivot):
    """Rotation about the X axis through `pivot`; positive tips +Z towards -Y."""
    pivot = Vector(pivot)
    return Matrix.Translation(pivot) @ Matrix.Rotation(angle, 4, "X") @ Matrix.Translation(-pivot)


def leg(name, hip, knee, ankle, mats, segments, foot="flat"):
    """Trouser leg through hip, knee and ankle, with knee pad and boot."""
    body, dark = mats["body"], mats["dark"]
    hip, knee, ankle = Vector(hip), Vector(knee), Vector(ankle)
    parts = [
        loft(
            f"{name}_leg",
            [
                (hip + Vector((0, 0, 0.03)), 0.066, 0.07),
                (_lerp(hip, knee, 0.45), 0.061, 0.066),
                (knee, 0.047, 0.05),
                *([(_lerp(knee, ankle, 0.35), 0.048, 0.052)] if segments >= 8 else []),
                (ankle + Vector((0, 0, 0.01)), 0.038, 0.04),
            ],
            body,
            segments,
        )
    ]
    # Knee pad on the front of the knee, facing along the shin's normal.
    shin = (ankle - knee).normalized()
    thigh = (hip - knee).normalized()
    front = -(shin + thigh).normalized() if (shin + thigh).length > 1e-3 else Vector((0, -1, 0))
    pad = box(f"{name}_pad", (0.066, 0.03, 0.066), (0, 0, 0), dark)
    up = (thigh - shin).normalized()
    side = up.cross(front).normalized()
    basis = Matrix((side, front, up)).transposed().to_4x4()
    transform(pad, Matrix.Translation(knee + front * 0.04) @ basis)
    if knee.z > 0.1:  # a knee on the ground hides its pad
        parts.append(pad)
    else:
        bpy.data.objects.remove(pad)
    if foot == "flat":
        boot = box(f"{name}_boot", (0.082, 0.15, 0.085), (ankle.x, ankle.y - 0.028, 0.0425), dark)
        for v in boot.data.vertices:
            if v.co.y < ankle.y - 0.06 and v.co.z > 0.05:
                v.co.y += 0.035
                v.co.z -= 0.035
    else:
        # Kneeling: boot stands on its toe behind the knee.
        boot = box(f"{name}_boot", (0.07, 0.06, 0.13), (ankle.x, ankle.y + 0.02, ankle.z + 0.02), dark)
    parts.append(boot)
    return parts


def arm(name, shoulder, wrist, hint, mats, segments, band=True):
    """Sleeve from shoulder through the elbow to a gloved hand at `wrist`, with
    the team identification armband on the upper arm."""
    body, team, dark = mats["body"], mats["team"], mats["dark"]
    shoulder, wrist = Vector(shoulder), Vector(wrist)
    elbow = _elbow(shoulder, wrist, hint)
    parts = [
        loft(
            f"{name}_arm",
            [
                (shoulder + (shoulder - elbow).normalized() * 0.02, 0.047, 0.047),
                *([(_lerp(shoulder, elbow, 0.5), 0.042, 0.040)] if segments >= 8 else []),
                (elbow, 0.035, 0.035),
                (_lerp(elbow, wrist, 0.45), 0.036, 0.034),
                (wrist, 0.026, 0.026),
            ],
            body,
            segments,
        ),
        sphere(f"{name}_glove", 0.033, wrist + (wrist - elbow).normalized() * 0.018, dark, segments - 1, 4 if segments >= 8 else 3),
    ]
    if band:
        # Ukrainian armbands are the flag: team blue above, yellow below.
        flag = mats["faction"] == "ukraine"
        split = 0.45 if flag else 0.62
        parts.append(
            loft(
                f"{name}_band",
                [(_lerp(shoulder, elbow, 0.28), 0.051, 0.049), (_lerp(shoulder, elbow, split), 0.049, 0.047)],
                team,
                segments,
                caps=False,
            )
        )
        if flag:
            parts.append(
                loft(
                    f"{name}_band_yellow",
                    [(_lerp(shoulder, elbow, split), 0.049, 0.047), (_lerp(shoulder, elbow, 0.62), 0.047, 0.045)],
                    mats["mark"],
                    segments,
                    caps=False,
                )
            )
    return parts


def upper_body(name, mats, pelvis, lean, segments, pack="assault", head_dy=0.0, look_down=0.0, earcups=True):
    """Hips, torso, plate carrier, pack, head and helmet around `pelvis`, tipped
    forward by `lean` radians; returns (parts, right shoulder, left shoulder)."""
    body, team, dark = mats["body"], mats["team"], mats["dark"]
    px, py, pz = pelvis
    c = lambda x, y, z: Vector((px + x, py + y, pz + z))  # noqa: E731
    torso_seg = segments + 2
    # Two-man units halve gear detail to stay in the triangle budget.
    gear_bevel = 0.012 if segments >= 8 else 0.0
    parts = [
        loft(
            f"{name}_torso",
            [
                (c(0, 0.005, -0.05), 0.0, 0.0),
                (c(0, 0.005, -0.035), 0.075, 0.055),
                (c(0, 0.0, 0.02), 0.102, 0.068),
                (c(0, 0.0, 0.11), 0.098, 0.066),
                (c(0, -0.005, 0.21), 0.122, 0.078),
                (c(0, 0.0, 0.275), 0.128, 0.072),
                (c(0, 0.005, 0.315), 0.07, 0.055),
                (c(0, 0.0, 0.345), 0.045, 0.042),
            ],
            body,
            torso_seg,
        ),
        # Belt and plate carrier with magazine pouches.
        loft(f"{name}_belt", [(c(0, 0.0, 0.045), 0.108, 0.073), (c(0, 0.0, 0.085), 0.106, 0.072)], dark, torso_seg, caps=False),
        box(f"{name}_vest", (0.228, 0.178, 0.19), c(0, -0.004, 0.19), body, bevel=gear_bevel),
        box(f"{name}_pouches", (0.17, 0.04, 0.07), c(0, -0.105, 0.145), dark),
    ]
    if segments >= 8:
        parts.append(box(f"{name}_radio", (0.04, 0.05, 0.08), c(-0.12, 0.03, 0.19), dark))
    if pack == "assault":
        parts.append(box(f"{name}_pack", (0.17, 0.065, 0.17), c(0, 0.108, 0.2), body, bevel=gear_bevel))
    elif pack == "rpg":
        # RPG rocket carrier: two PG-7 rounds standing in a back frame.
        parts.append(box(f"{name}_pack", (0.16, 0.06, 0.13), c(0, 0.11, 0.17), dark))
        for i, dx in enumerate((-0.042, 0.042)):
            base = c(dx, 0.125, 0.2)
            parts.append(rod(f"{name}_round_{i}", 0.018, base, base + Vector((0, 0, 0.13)), body))
            parts.append(
                loft(
                    f"{name}_warhead_{i}",
                    [
                        (base + Vector((0, 0, 0.13)), 0.018, 0.018),
                        (base + Vector((0, 0, 0.16)), 0.03, 0.03),
                        (base + Vector((0, 0, 0.215)), 0.0, 0.0),
                    ],
                    dark,
                    6,
                    smooth=False,
                )
            )
    head = c(0, -0.01 + head_dy, 0.405 - look_down * 0.3)
    parts += [
        # Face covered by a camouflage balaclava, ballistic glasses on top.
        sphere(f"{name}_head", 0.066, head, body, segments, segments - 2, (0.95, 1.0, 1.08)),
        box(f"{name}_glasses", (0.1, 0.03, 0.026), head + Vector((0, -0.058, 0.008)), dark),
        # High-cut ballistic helmet with a camouflage cover and team tape.
        loft(
            f"{name}_helmet",
            [
                (head + Vector((0, 0.004, 0.0)), 0.083, 0.088),
                (head + Vector((0, 0.002, 0.04)), 0.086, 0.092),
                (head + Vector((0, 0.0, 0.08)), 0.072, 0.078),
                (head + Vector((0, 0.0, 0.105)), 0.042, 0.046),
                (head + Vector((0, 0.0, 0.114)), 0.0, 0.0),
            ],
            body,
            segments + 2,
        ),
    ]
    if mats["faction"] == "ukraine":
        # Helmet tape in the flag colours: team blue above, yellow below.
        parts += [
            loft(
                f"{name}_tape",
                [(head + Vector((0, 0.0015, 0.043)), 0.0862, 0.0922), (head + Vector((0, 0.001, 0.056)), 0.0845, 0.0905)],
                team,
                segments + 2,
                caps=False,
            ),
            loft(
                f"{name}_tape_yellow",
                [(head + Vector((0, 0.002, 0.03)), 0.0875, 0.0935), (head + Vector((0, 0.0015, 0.043)), 0.0862, 0.0922)],
                mats["mark"],
                segments + 2,
                caps=False,
            ),
            box(f"{name}_nvg", (0.04, 0.03, 0.035), head + Vector((0, -0.088, 0.055)), dark),
        ]
    else:
        # White Z sprayed on the front and both sides of the helmet cover.
        # Each Z leans back with the dome of the helmet.
        parts.append(z_mark(f"{name}_z_front", head + Vector((0, -0.0895, 0.06)), (1, 0, 0), (0, 0.35, 1), mats["mark"]))
        for side in (-1, 1):
            parts.append(
                z_mark(
                    f"{name}_z_{side}",
                    head + Vector((side * 0.0835, 0.0, 0.058)),
                    (0, side, 0),
                    (-side * 0.35, 0, 1),
                    mats["mark"],
                )
            )
    if earcups:
        for side in (-1, 1):
            parts.append(rod(f"{name}_ear_{side}", 0.028, head + Vector((side * 0.06, 0.0, -0.005)), head + Vector((side * 0.085, 0.0, -0.005)), dark, 8))
    tilt = _rotation_x(lean, pelvis)
    for obj in parts:
        transform(obj, tilt)
    right = tilt @ c(0.118, 0.0, 0.272)
    left = tilt @ c(-0.118, 0.0, 0.272)
    return parts, right, left


def rifle(name, mats, butt, down):
    """AK-74M / AK-12 pointing -Y, its butt at `butt`, muzzle `down` radians
    below the horizon; returns (parts, grip hand, handguard hand)."""
    dark = mats["dark"]
    parts = [
        box(f"{name}_stock", (0.032, 0.12, 0.045), (0, -0.06, -0.008), dark),
        box(f"{name}_receiver", (0.04, 0.15, 0.058), (0, -0.19, 0.0), dark),
        box(f"{name}_rail", (0.022, 0.09, 0.022), (0, -0.2, 0.038), dark),
        box(f"{name}_handguard", (0.036, 0.12, 0.044), (0, -0.325, 0.0), dark),
        rod(f"{name}_barrel", 0.009, (0, -0.385, 0.004), (0, -0.44, 0.004), dark),
        box(f"{name}_grip", (0.028, 0.032, 0.06), (0, -0.14, -0.05), dark),
    ]
    mag = box(f"{name}_mag", (0.03, 0.045, 0.085), (0, -0.225, -0.065), dark)
    for v in mag.data.vertices:
        if v.co.z < -0.08:
            v.co.y -= 0.025
    parts.append(mag)
    place = Matrix.Translation(Vector(butt)) @ Matrix.Rotation(down, 4, "X")
    for obj in parts:
        transform(obj, place)
    return parts, place @ Vector((0.0, -0.14, -0.06)), place @ Vector((0.0, -0.31, -0.03))


def rpg7(name, mats, centre, segments=8):
    """RPG-7 lying on the right shoulder at `centre`, pointing -Y, PG-7 round
    loaded; returns (parts, trigger hand, front grip hand)."""
    body, dark = mats["body"], mats["dark"]
    x, y, z = centre
    p = lambda dy, dz=0.0: Vector((x, y + dy, z + dz))  # noqa: E731
    parts = [
        rod(f"{name}_tube", 0.022, p(0.2), p(-0.17), dark, segments),
        loft(f"{name}_bell", [(p(0.2), 0.022, 0.022), (p(0.25), 0.036, 0.036)], dark, segments, smooth=False),
        # Wooden heat shield in the body colour, optic on the left side.
        rod(f"{name}_shield", 0.03, p(0.04), p(-0.07), body, segments),
        box(f"{name}_optic", (0.03, 0.07, 0.04), (x - 0.04, y - 0.01, z + 0.025), dark),
        box(f"{name}_trigger", (0.022, 0.03, 0.06), (x, y - 0.0, z - 0.045), dark),
        box(f"{name}_front_grip", (0.022, 0.03, 0.055), (x, y - 0.12, z - 0.042), dark),
        loft(
            f"{name}_warhead",
            [
                (p(-0.17), 0.018, 0.018),
                (p(-0.2), 0.045, 0.045),
                (p(-0.25), 0.045, 0.045),
                (p(-0.33), 0.0, 0.0),
            ],
            body,
            segments,
        ),
    ]
    return parts, p(0.0, -0.075), p(-0.12, -0.07)


def place(parts, name, height, offset=(0.0, 0.0), yaw=0.0):
    """Joins `parts` into `name`, scales figure units to `height` tiles, turns
    it `yaw` radians about Z and moves it by `offset` (tiles)."""
    obj = lib.join(parts, name)
    _bake(obj)
    matrix = (
        Matrix.Translation(Vector((offset[0], offset[1], 0.0)))
        @ Matrix.Rotation(yaw, 4, "Z")
        @ Matrix.Scale(height, 4)
    )
    return transform(obj, matrix)


def rifleman(name, mats, segments=8, pack="assault", earcups=True, kneel=False):
    """Soldier at low ready: rifle shouldered, muzzle down and forward;
    standing with the weak-side foot forward, or kneeling on the right knee.
    Figure units; see place()."""
    if kneel:
        pelvis = (0.0, 0.0, 0.3)
        parts, right, left = upper_body(name, mats, pelvis, 0.12, segments, pack, earcups=earcups)
        parts += _kneeling_legs(name, mats, segments)
    else:
        pelvis = (0.0, 0.0, 0.5)
        parts, right, left = upper_body(name, mats, pelvis, 0.08, segments, pack, earcups=earcups)
        parts += leg(f"{name}_l", (-0.066, 0.0, 0.5), (-0.074, -0.085, 0.28), (-0.078, -0.07, 0.06), mats, segments)
        parts += leg(f"{name}_r", (0.066, 0.01, 0.5), (0.088, 0.03, 0.272), (0.098, 0.075, 0.06), mats, segments)
    gun, grip, guard = rifle(name, mats, right + Vector((-0.045, -0.06, -0.02)), math.radians(42))
    parts += gun
    parts += arm(f"{name}_r", right, grip, (1.0, 0.4, -0.6), mats, segments)
    parts += arm(f"{name}_l", left, guard, (-1.0, 0.0, -0.8), mats, segments)
    return parts


def rpg_gunner(name, mats, segments=8, earcups=True):
    """Standing RPG-7 gunner aiming from the right shoulder."""
    pelvis = (0.0, 0.0, 0.5)
    parts, right, left = upper_body(name, mats, pelvis, 0.05, segments, "assault", head_dy=0.0, earcups=earcups)
    parts += leg(f"{name}_l", (-0.066, 0.0, 0.5), (-0.07, -0.09, 0.28), (-0.075, -0.075, 0.06), mats, segments)
    parts += leg(f"{name}_r", (0.066, 0.01, 0.5), (0.09, 0.04, 0.272), (0.1, 0.085, 0.06), mats, segments)
    gun, trigger, front = rpg7(name, mats, (right.x - 0.02, right.y - 0.02, right.z + 0.06), segments)
    parts += gun
    parts += arm(f"{name}_r", right, trigger, (1.0, 0.5, -0.8), mats, segments)
    parts += arm(f"{name}_l", left, front, (-1.0, 0.0, -1.0), mats, segments)
    return parts


def _kneeling_legs(name, mats, segments):
    """Right knee on the ground with the boot on its toe, left foot forward."""
    return leg(f"{name}_r", (0.066, 0.02, 0.3), (0.075, -0.02, 0.06), (0.075, 0.2, 0.05), mats, segments, foot="toe") + leg(
        f"{name}_l", (-0.066, 0.0, 0.3), (-0.078, -0.2, 0.27), (-0.08, -0.19, 0.06), mats, segments
    )


def kneeling_operator(name, mats, segments=8):
    """Operator kneeling on the right knee, both hands on a remote control
    console resting on the left thigh; returns (parts, console centre)."""
    dark, team = mats["dark"], mats["team"]
    pelvis = (0.0, 0.0, 0.3)
    parts, right, left = upper_body(name, mats, pelvis, 0.32, segments, "assault", look_down=0.1)
    parts += _kneeling_legs(name, mats, segments)
    console = Vector((-0.02, -0.21, 0.33))
    parts += [
        box(f"{name}_console", (0.15, 0.1, 0.035), console, dark),
        box(f"{name}_lid", (0.15, 0.022, 0.09), console + Vector((0, 0.05, 0.06)), dark),
        # Screen glows in the team colour.
        box(f"{name}_screen", (0.12, 0.006, 0.065), console + Vector((0, 0.037, 0.062)), team),
    ]
    parts += arm(f"{name}_r", right, console + Vector((0.06, -0.035, 0.03)), (1.0, 0.0, -1.0), mats, segments)
    parts += arm(f"{name}_l", left, console + Vector((-0.06, -0.035, 0.03)), (-1.0, 0.0, -1.0), mats, segments)
    return parts, console


def centre(obj):
    """Moves `obj` so its footprint (X and Y bounds) is centred on the origin."""
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    shift = Vector((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0.0))
    return transform(obj, Matrix.Translation(shift))
