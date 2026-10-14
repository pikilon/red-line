"""Shared helpers for the procedural model scripts (spec 06 §3, §4).

Run a model script with:
    blender --background --factory-startup --python tools/models/<type-id>.py

Conventions: 1 Blender unit = 1 map tile, origin at the footprint centre on the
ground, +Z up, the model's front faces -Y (glTF +Z after export). Sizes are
full extents. Only the materials `body`, `team` and `dark` are allowed.
"""

import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(REPO, "client", "public", "models")

FACTION_BODY = {"ukraine": "#5b6b3a", "russia": "#6b6650", "neutral": "#8b5a2b"}
TEAM = "#ffffff"
DARK = "#2a2a2a"

# Model detail (spec 10 §5): default bevel and baked ambient occlusion.
BEVEL = 0.02
BEVEL_MIN_SIDE = 0.1
# Cylinder side edges meet at 360° / vertices (at most 60° for 6+ vertices);
# cap edges meet at 90°, so this limit bevels the caps only.
CAP_ANGLE = math.radians(75)
AO_RAYS = 16
AO_LENGTH = 0.5
AO_MIN = 0.55
AO_OFFSET = 1e-4


def reset_scene():
    """Empties the scene and every orphan datablock."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _rgba(hex_color):
    value = hex_color.lstrip("#")
    srgb = [int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    # Principled base colour is linear; convert from sRGB.
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*linear, 1.0)


def material(name, hex_color):
    """A flat, non-metallic material; `name` must be body, team, dark or cage."""
    if name not in ("body", "team", "dark", "cage"):
        raise ValueError(f"material name must be body, team, dark or cage, got {name}")
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = _rgba(hex_color)
    tree = getattr(mat, "node_tree", None)
    if tree is None and hasattr(mat, "use_nodes"):
        mat.use_nodes = True
        tree = mat.node_tree
    if tree is not None:
        bsdf = tree.nodes.get("Principled BSDF")
        if bsdf is not None:
            bsdf.inputs["Base Color"].default_value = _rgba(hex_color)
            bsdf.inputs["Metallic"].default_value = 0.0
            bsdf.inputs["Roughness"].default_value = 0.9
    return mat


def palette(faction):
    """The three contract materials for a faction."""
    return {
        "body": material("body", FACTION_BODY[faction]),
        "team": material("team", TEAM),
        "dark": material("dark", DARK),
        "cage": material("cage", DARK),
    }


def _finish(obj, name, mat):
    obj.name = name
    obj.data.name = name
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def _bevel(obj, width, angle_limit=None):
    """Applies a one-segment bevel of `width` to edges sharper than the limit."""
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = 1
    mod.limit_method = "ANGLE"
    if angle_limit is not None:
        mod.angle_limit = angle_limit
    bpy.ops.object.modifier_apply(modifier=mod.name)


def box(name, size, location, mat, bevel=None):
    """Axis-aligned box of full extents `size` centred at `location`.

    `bevel` defaults to BEVEL when the smallest side is at least BEVEL_MIN_SIDE
    and to a sharp box otherwise; pass a width (or 0) to override it.
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel is None:
        bevel = BEVEL if min(size) >= BEVEL_MIN_SIDE else 0.0
    if bevel > 0:
        _bevel(obj, bevel)
    return _finish(obj, name, mat)


def cylinder(name, radius, depth, location, mat, vertices=8, axis="Z", bevel=None):
    """Cylinder along `axis` (X, Y or Z) centred at `location`; its caps get the
    box() default bevel when diameter and depth are at least BEVEL_MIN_SIDE."""
    rotation = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    obj = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    if bevel is None:
        bevel = BEVEL if min(2 * radius, depth) >= BEVEL_MIN_SIDE else 0.0
    if bevel > 0:
        _bevel(obj, bevel, CAP_ANGLE)
    return _finish(obj, name, mat)


def wedge(name, size, location, mat, slope=0.5):
    """Box whose top front edge is pulled back by `slope` of its depth (glacis)."""
    obj = box(name, size, location, mat)
    sx, sy, sz = size
    for v in obj.data.vertices:
        if v.co.z > 0 and v.co.y < 0:
            v.co.y += sy * slope
    return obj


def wheels(name, count, radius, width, length, half_track, z, mat, vertices=8):
    """`count` wheels per side spread along `length` (Y), at x = ±half_track."""
    parts = []
    step = length / max(count - 1, 1)
    for side in (-1, 1):
        for i in range(count):
            y = -length / 2 + i * step if count > 1 else 0.0
            parts.append(
                cylinder(f"{name}_{side}_{i}", radius, width, (side * half_track, y, z), mat, vertices, "X")
            )
    return join(parts, name)


def tracks(name, length, width, height, half_track, mat):
    """Two track blocks with bevelled ends, sitting on the ground."""
    parts = [
        box(f"{name}_{side}", (width, length, height), (side * half_track, 0, height / 2), mat, bevel=height * 0.3)
        for side in (-1, 1)
    ]
    return join(parts, name)


def barrel(name, length, radius, origin, mat, elevation=0.0):
    """Gun barrel pointing -Y from `origin`, raised by `elevation` radians."""
    ox, oy, oz = origin
    cy = oy - math.cos(elevation) * length / 2
    cz = oz + math.sin(elevation) * length / 2
    obj = cylinder(name, radius, length, (ox, cy, cz), mat, 6, "Y")
    obj.rotation_euler = (-elevation, 0, 0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return obj


def turret(parts, pivot, name="turret"):
    """Joins `parts` into the `turret` node with its origin on `pivot` (ring centre)."""
    obj = join(parts, name)
    cursor = bpy.context.scene.cursor
    cursor.location = pivot
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    cursor.location = (0, 0, 0)
    return obj


def bone(name, p1, p2, r1, r2, mat, segments=8):
    """Tapered cone/cylinder from p1 to p2 oriented along the bone vector."""
    v1, v2 = Vector(p1), Vector(p2)
    delta = v2 - v1
    length = delta.length
    if length < 1e-5:
        return None
    mid = (v1 + v2) / 2.0
    bpy.ops.mesh.primitive_cone_add(
        vertices=segments, radius1=r1, radius2=r2, depth=length, location=mid
    )
    obj = bpy.context.active_object
    obj.name = name
    rot = Vector((0, 0, 1)).rotation_difference(delta)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(mat)
    return obj


def dome(name, radius, location, mat, segments=10, rings=6, z_scale=0.8):
    """Hemispherical / rounded dome for ballistic helmets."""
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=radius, location=location
    )
    obj = bpy.context.active_object
    obj.scale.z = z_scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(obj, name, mat)


def boot(name, location, size, mat):
    """Anatomical combat boot with sloped toe and heel."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sx, sy, sz = size
    for v in obj.data.vertices:
        if v.co.y < location[1] - sy * 0.2 and v.co.z > location[2]:
            v.co.z -= sz * 0.30
        if v.co.y > location[1] + sy * 0.2 and v.co.z > location[2]:
            v.co.z -= sz * 0.25
    return _finish(obj, name, mat)


def modern_soldier(
    name,
    weapon,
    mats,
    height=0.54,
    pose="standing",
    faction="ua",
    has_pack=True,
    has_rocket_pack=False,
    has_spare_crate=False,
):
    """Modern humanoid low-poly soldier facing -Y (C&C Generals style, spec 17).

    Features anatomical humanoid limbs, combat boots, knee pads, plate carrier
    vest, front mag pouches, assault pack, ballistic helmet dome with dark balaclava,
    articulated arms holding weapon, and seamless identification armbands.
    """
    s = height / 0.54
    body, team, dark = mats["body"], mats["team"], mats["dark"]
    parts = []

    if pose == "kneeling":
        # Kneeling posture (for ATGM operator)
        parts.append(boot(f"{name}_boot_r", (0.035 * s, 0.050 * s, 0.020 * s), (0.040 * s, 0.070 * s, 0.040 * s), dark))
        parts.append(bone(f"{name}_thigh_r", (0.030 * s, -0.01 * s, 0.18 * s), (0.030 * s, 0.04 * s, 0.04 * s), 0.028 * s, 0.024 * s, body, 6))
        parts.append(cylinder(f"{name}_kneepad_r", 0.022 * s, 0.018 * s, (0.030 * s, -0.015 * s, 0.03 * s), dark, 6, "Y"))

        parts.append(boot(f"{name}_boot_l", (-0.035 * s, -0.045 * s, 0.020 * s), (0.040 * s, 0.070 * s, 0.040 * s), dark))
        parts.append(bone(f"{name}_calf_l", (-0.035 * s, -0.04 * s, 0.04 * s), (-0.035 * s, -0.02 * s, 0.16 * s), 0.022 * s, 0.024 * s, body, 6))
        parts.append(bone(f"{name}_thigh_l", (-0.025 * s, 0.03 * s, 0.18 * s), (-0.035 * s, -0.02 * s, 0.16 * s), 0.028 * s, 0.024 * s, body, 6))
        parts.append(cylinder(f"{name}_kneepad_l", 0.022 * s, 0.018 * s, (-0.035 * s, -0.03 * s, 0.16 * s), dark, 6, "Y"))

        # Pelvis & Belt
        parts.append(bone(f"{name}_pelvis", (0, 0.02 * s, 0.16 * s), (0, 0.01 * s, 0.22 * s), 0.048 * s, 0.054 * s, body, 6))
        parts.append(box(f"{name}_belt", (0.11 * s, 0.07 * s, 0.022 * s), (0, 0.01 * s, 0.22 * s), dark, bevel=0.003))

        # Torso & Plate carrier
        parts.append(bone(f"{name}_torso", (0, 0.01 * s, 0.22 * s), (0, -0.01 * s, 0.33 * s), 0.052 * s, 0.065 * s, body, 6))
        parts.append(box(f"{name}_vest", (0.115 * s, 0.070 * s, 0.090 * s), (0, -0.005 * s, 0.285 * s), body, bevel=0.01))
        parts.append(box(f"{name}_pouches", (0.080 * s, 0.020 * s, 0.040 * s), (0, -0.045 * s, 0.265 * s), dark, bevel=0.003))
        if has_pack:
            parts.append(box(f"{name}_pack", (0.090 * s, 0.048 * s, 0.095 * s), (0, 0.045 * s, 0.290 * s), body, bevel=0.008))

        # Collar & Head
        parts.append(cylinder(f"{name}_collar", 0.036 * s, 0.018 * s, (0, -0.015 * s, 0.335 * s), body, 6, "Z"))
        parts.append(bone(f"{name}_balaclava", (0, -0.018 * s, 0.335 * s), (0, -0.022 * s, 0.390 * s), 0.028 * s, 0.026 * s, dark, 6))
        parts.append(dome(f"{name}_helmet", 0.042 * s, (0, -0.020 * s, 0.390 * s), body, segments=10, rings=6))
        parts.append(box(f"{name}_goggles", (0.048 * s, 0.014 * s, 0.012 * s), (0, -0.052 * s, 0.378 * s), dark, bevel=0.002))
        parts.append(box(f"{name}_nvg", (0.014 * s, 0.008 * s, 0.014 * s), (0, -0.058 * s, 0.392 * s), dark))

        # Operator arms reaching forward
        r_sh = (0.065 * s, 0, 0.325 * s)
        r_el = (0.075 * s, -0.03 * s, 0.235 * s)
        r_wr = (0.025 * s, -0.09 * s, 0.14 * s)

        l_sh = (-0.065 * s, 0, 0.325 * s)
        l_el = (-0.060 * s, -0.04 * s, 0.235 * s)
        l_wr = (-0.025 * s, -0.09 * s, 0.14 * s)

        parts.append(bone(f"{name}_arm_up_r", r_sh, r_el, 0.024 * s, 0.019 * s, body, 6))
        parts.append(bone(f"{name}_arm_up_l", l_sh, l_el, 0.024 * s, 0.019 * s, body, 6))

        p_b1_r = Vector(r_sh) * 0.65 + Vector(r_el) * 0.35
        p_b2_r = Vector(r_sh) * 0.35 + Vector(r_el) * 0.65
        parts.append(bone(f"{name}_band_r", p_b1_r, p_b2_r, 0.0255 * s, 0.024 * s, team, 6))

        p_b1_l = Vector(l_sh) * 0.65 + Vector(l_el) * 0.35
        p_b2_l = Vector(l_sh) * 0.35 + Vector(l_el) * 0.65
        parts.append(bone(f"{name}_band_l", p_b1_l, p_b2_l, 0.0255 * s, 0.024 * s, team, 6))

        parts.append(bone(f"{name}_fore_r", r_el, r_wr, 0.019 * s, 0.015 * s, body, 6))
        parts.append(bone(f"{name}_fore_l", l_el, l_wr, 0.019 * s, 0.015 * s, body, 6))
        parts.append(box(f"{name}_glove_r", (0.018 * s, 0.022 * s, 0.018 * s), r_wr, dark, bevel=0.003))
        parts.append(box(f"{name}_glove_l", (0.018 * s, 0.022 * s, 0.018 * s), l_wr, dark, bevel=0.003))

    else:
        # Standing dynamic combat stance
        l_hip = (-0.042 * s, 0.005 * s, 0.28 * s)
        l_knee = (-0.048 * s, -0.020 * s, 0.16 * s)
        l_ankle = (-0.048 * s, -0.015 * s, 0.042 * s)

        r_hip = (0.042 * s, 0.005 * s, 0.28 * s)
        r_knee = (0.048 * s, 0.018 * s, 0.16 * s)
        r_ankle = (0.048 * s, 0.020 * s, 0.042 * s)

        # Boots
        parts.append(boot(f"{name}_boot_l", (l_ankle[0], l_ankle[1] - 0.015 * s, 0.020 * s), (0.040 * s, 0.080 * s, 0.040 * s), dark))
        parts.append(boot(f"{name}_boot_r", (r_ankle[0], r_ankle[1] - 0.015 * s, 0.020 * s), (0.040 * s, 0.080 * s, 0.040 * s), dark))

        # Thighs & Calves
        parts.append(bone(f"{name}_thigh_l", l_hip, l_knee, 0.034 * s, 0.026 * s, body, 8))
        parts.append(bone(f"{name}_thigh_r", r_hip, r_knee, 0.034 * s, 0.026 * s, body, 8))
        parts.append(cylinder(f"{name}_kneepad_l", 0.022 * s, 0.016 * s, (l_knee[0], l_knee[1] - 0.014 * s, l_knee[2]), dark, 8, "Y"))
        parts.append(cylinder(f"{name}_kneepad_r", 0.022 * s, 0.016 * s, (r_knee[0], r_knee[1] - 0.014 * s, r_knee[2]), dark, 8, "Y"))
        parts.append(bone(f"{name}_calf_l", l_knee, l_ankle, 0.026 * s, 0.022 * s, body, 8))
        parts.append(bone(f"{name}_calf_r", r_knee, r_ankle, 0.026 * s, 0.022 * s, body, 8))

        # Pelvis & War belt
        parts.append(bone(f"{name}_pelvis", (0, 0.005 * s, 0.27 * s), (0, 0.005 * s, 0.32 * s), 0.052 * s, 0.058 * s, body, 8))
        parts.append(box(f"{name}_belt", (0.120 * s, 0.076 * s, 0.025 * s), (0, 0.005 * s, 0.32 * s), dark, bevel=0.004))

        # Torso & Plate carrier
        parts.append(bone(f"{name}_torso", (0, 0.005 * s, 0.32 * s), (0, 0, 0.44 * s), 0.058 * s, 0.074 * s, body, 8))
        parts.append(box(f"{name}_vest", (0.128 * s, 0.078 * s, 0.120 * s), (0, 0.002 * s, 0.385 * s), body, bevel=0.014))
        parts.append(box(f"{name}_pouches", (0.090 * s, 0.022 * s, 0.045 * s), (0, -0.046 * s, 0.355 * s), dark, bevel=0.003))

        # Backpack
        if has_rocket_pack:
            parts.append(box(f"{name}_backpack", (0.095 * s, 0.055 * s, 0.11 * s), (0, 0.062 * s, 0.385 * s), dark, bevel=0.01))
            for rx_i, ro in enumerate((-0.028 * s, 0.028 * s)):
                parts.append(cylinder(f"{name}_rkt_tube_{rx_i}", 0.012 * s, 0.10 * s, (ro, 0.070 * s, 0.465 * s), body, 6, "Z"))
                parts.append(cylinder(f"{name}_rkt_cone_{rx_i}", 0.018 * s, 0.028 * s, (ro, 0.070 * s, 0.515 * s), dark, 6, "Z"))
        elif has_pack:
            parts.append(box(f"{name}_backpack", (0.096 * s, 0.046 * s, 0.110 * s), (0, 0.056 * s, 0.390 * s), body, bevel=0.010))

        # Ground crate for RPG gunner (to meet 35cm render box fill)
        if has_spare_crate:
            parts.append(box(f"{name}_crate", (0.042 * s, 0.090 * s, 0.040 * s), (-0.125 * s, -0.02 * s, 0.020 * s), dark, bevel=0.005))
            parts.append(cylinder(f"{name}_crate_rkt", 0.012 * s, 0.10 * s, (-0.125 * s, -0.02 * s, 0.045 * s), body, 6, "Y"))
            parts.append(cylinder(f"{name}_crate_tip", 0.022 * s, 0.03 * s, (-0.125 * s, -0.075 * s, 0.045 * s), dark, 6, "Y"))

        # Collar & Head
        parts.append(cylinder(f"{name}_collar", 0.040 * s, 0.020 * s, (0, -0.002 * s, 0.442 * s), body, 8, "Z"))
        parts.append(bone(f"{name}_balaclava", (0, -0.008 * s, 0.440 * s), (0, -0.008 * s, 0.495 * s), 0.030 * s, 0.028 * s, dark, 8))
        parts.append(dome(f"{name}_helmet", 0.044 * s, (0, -0.006 * s, 0.495 * s), body, segments=10, rings=6))
        parts.append(box(f"{name}_helmet_rails", (0.090 * s, 0.034 * s, 0.014 * s), (0, -0.006 * s, 0.485 * s), dark, bevel=0.003))
        parts.append(box(f"{name}_goggles", (0.050 * s, 0.014 * s, 0.014 * s), (0, -0.040 * s, 0.475 * s), dark, bevel=0.003))
        parts.append(box(f"{name}_nvg", (0.016 * s, 0.010 * s, 0.016 * s), (0, -0.046 * s, 0.495 * s), dark))

        # Arms
        if weapon == "rpg":
            r_sh = (0.078 * s, 0.005 * s, 0.425 * s)
            r_el = (0.105 * s, 0.015 * s, 0.355 * s)
            r_wr = (0.075 * s, -0.040 * s, 0.395 * s)

            l_sh = (-0.078 * s, 0.005 * s, 0.425 * s)
            l_el = (-0.095 * s, -0.040 * s, 0.345 * s)
            l_wr = (0.035 * s, -0.095 * s, 0.405 * s)
        else:
            r_sh = (0.078 * s, 0.005 * s, 0.425 * s)
            r_el = (0.096 * s, 0.018 * s, 0.330 * s)
            r_wr = (0.032 * s, -0.065 * s, 0.345 * s)

            l_sh = (-0.078 * s, 0.005 * s, 0.425 * s)
            l_el = (-0.094 * s, -0.025 * s, 0.330 * s)
            l_wr = (-0.015 * s, -0.095 * s, 0.345 * s)

        parts.append(bone(f"{name}_arm_up_r", r_sh, r_el, 0.026 * s, 0.020 * s, body, 8))
        parts.append(bone(f"{name}_arm_up_l", l_sh, l_el, 0.026 * s, 0.020 * s, body, 8))

        p_b1_r = Vector(r_sh) * 0.65 + Vector(r_el) * 0.35
        p_b2_r = Vector(r_sh) * 0.35 + Vector(r_el) * 0.65
        parts.append(bone(f"{name}_band_r", p_b1_r, p_b2_r, 0.0275 * s, 0.0255 * s, team, 8))

        p_b1_l = Vector(l_sh) * 0.65 + Vector(l_el) * 0.35
        p_b2_l = Vector(l_sh) * 0.35 + Vector(l_el) * 0.65
        parts.append(bone(f"{name}_band_l", p_b1_l, p_b2_l, 0.0275 * s, 0.0255 * s, team, 8))

        parts.append(bone(f"{name}_fore_r", r_el, r_wr, 0.020 * s, 0.016 * s, body, 8))
        parts.append(bone(f"{name}_fore_l", l_el, l_wr, 0.020 * s, 0.016 * s, body, 8))
        parts.append(box(f"{name}_glove_r", (0.020 * s, 0.024 * s, 0.020 * s), (r_wr[0], r_wr[1] - 0.004 * s, r_wr[2]), dark, bevel=0.003))
        parts.append(box(f"{name}_glove_l", (0.020 * s, 0.024 * s, 0.020 * s), (l_wr[0], l_wr[1] - 0.004 * s, l_wr[2]), dark, bevel=0.003))

        # Weapons
        if weapon == "rifle":
            gx, gz = 0.008 * s, 0.350 * s
            parts.append(box(f"{name}_rifle_stock", (0.016 * s, 0.045 * s, 0.025 * s), (gx + 0.024 * s, -0.005 * s, gz + 0.006 * s), dark, bevel=0.003))
            parts.append(box(f"{name}_rifle_body", (0.018 * s, 0.082 * s, 0.032 * s), (gx, -0.055 * s, gz), dark, bevel=0.003))
            parts.append(box(f"{name}_rifle_guard", (0.016 * s, 0.042 * s, 0.024 * s), (gx, -0.098 * s, gz + 0.002 * s), dark, bevel=0.003))
            parts.append(cylinder(f"{name}_rifle_barrel", 0.005 * s, 0.042 * s, (gx, -0.122 * s, gz + 0.004 * s), dark, 6, "Y"))
            parts.append(box(f"{name}_rifle_sight", (0.004 * s, 0.006 * s, 0.010 * s), (gx, -0.136 * s, gz + 0.014 * s), dark))
            if faction == "ru":
                parts.append(box(f"{name}_rifle_mag", (0.014 * s, 0.028 * s, 0.048 * s), (gx, -0.068 * s, gz - 0.032 * s), dark, bevel=0.002))
            else:
                parts.append(box(f"{name}_rifle_mag", (0.014 * s, 0.026 * s, 0.044 * s), (gx, -0.064 * s, gz - 0.030 * s), dark, bevel=0.002))
        elif weapon == "rpg":
            rx, rz = 0.065 * s, 0.445 * s
            parts.append(bone(f"{name}_rpg_exhaust", (rx, 0.120 * s, rz), (rx, 0.080 * s, rz), 0.022 * s, 0.015 * s, dark, 6))
            parts.append(cylinder(f"{name}_rpg_shield", 0.020 * s, 0.095 * s, (rx, 0.030 * s, rz), body, 8, "Y"))
            parts.append(cylinder(f"{name}_rpg_tube", 0.015 * s, 0.110 * s, (rx, -0.055 * s, rz), dark, 6, "Y"))
            parts.append(box(f"{name}_rpg_optic", (0.016 * s, 0.040 * s, 0.022 * s), (rx - 0.022 * s, -0.025 * s, rz + 0.020 * s), dark, bevel=0.002))
            parts.append(box(f"{name}_rpg_grip1", (0.012 * s, 0.016 * s, 0.032 * s), (rx, -0.025 * s, rz - 0.025 * s), dark))
            parts.append(box(f"{name}_rpg_grip2", (0.012 * s, 0.016 * s, 0.032 * s), (rx, -0.075 * s, rz - 0.025 * s), dark))
            parts.append(cylinder(f"{name}_pg7_stem", 0.013 * s, 0.030 * s, (rx, -0.110 * s, rz), dark, 6, "Y"))
            parts.append(bone(f"{name}_pg7_cone", (rx, -0.115 * s, rz), (rx, -0.140 * s, rz), 0.028 * s, 0.008 * s, dark, 6))

    return join([p for p in parts if p is not None], name)


soldier = modern_soldier


def join(objects, name):
    """Joins meshes into one object named `name` (keeps per-face materials)."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    return obj


def parent(child, parent_obj):
    """Parents `child` to `parent_obj` keeping its world transform."""
    child.parent = parent_obj
    child.matrix_parent_inverse = parent_obj.matrix_world.inverted()
    return child


def _hemisphere(count):
    """`count` fixed, cosine-weighted directions around +Z (Fibonacci spiral)."""
    golden = math.pi * (3 - math.sqrt(5))
    directions = []
    for i in range(count):
        r = math.sqrt((i + 0.5) / count)
        phi = i * golden
        directions.append(Vector((r * math.cos(phi), r * math.sin(phi), math.sqrt(1 - r * r))))
    return directions


def bake_ambient_occlusion():
    """Stores per-corner ambient occlusion in an active `AO` colour attribute of
    every mesh (spec 10 §5): the fraction of AO_RAYS hemisphere directions
    around the corner normal whose ray of AO_LENGTH tiles does not hit the
    model, mapped to AO_MIN + (1 - AO_MIN) × AO."""
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    points = []
    polygons = []
    for obj in meshes:
        offset = len(points)
        points.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
        polygons.extend([offset + i for i in p.vertices] for p in obj.data.polygons)
    tree = BVHTree.FromPolygons(points, polygons)
    hemisphere = _hemisphere(AO_RAYS)
    for obj in meshes:
        mesh = obj.data
        to_world = obj.matrix_world
        normal_to_world = to_world.to_3x3().inverted().transposed()
        attribute = mesh.color_attributes.new("AO", "FLOAT_COLOR", "CORNER")
        cache = {}
        for loop, corner in zip(mesh.loops, mesh.corner_normals):
            normal = (normal_to_world @ corner.vector).normalized()
            key = (loop.vertex_index, tuple(round(c, 4) for c in normal))
            if key not in cache:
                origin = to_world @ mesh.vertices[loop.vertex_index].co + normal * AO_OFFSET
                rotation = Vector((0, 0, 1)).rotation_difference(normal)
                free = sum(
                    1 for d in hemisphere if tree.ray_cast(origin, rotation @ d, AO_LENGTH)[0] is None
                )
                cache[key] = AO_MIN + (1 - AO_MIN) * free / AO_RAYS
            value = cache[key]
            attribute.data[loop.index].color = (value, value, value, 1.0)
        mesh.color_attributes.active_color = attribute
        mesh.color_attributes.render_color_index = mesh.color_attributes.find("AO")


def export(type_id, root):
    """Names `root` after the type, bakes ambient occlusion into COLOR_0 and
    writes client/public/models/<type_id>.glb."""
    root.name = type_id
    bake_ambient_occlusion()
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    path = os.path.join(OUT_DIR, f"{type_id}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
    )
    print(f"exported {path}", file=sys.stderr)


def load_lib_dir():
    """Lets model scripts `import lib` when run through blender --python."""
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
