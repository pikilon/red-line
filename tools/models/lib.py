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

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(REPO, "client", "public", "models")

FACTION_BODY = {"ukraine": "#5b6b3a", "russia": "#6b6650", "neutral": "#8b5a2b"}
TEAM = "#ffffff"
DARK = "#2a2a2a"


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
    """A flat, non-metallic material; `name` must be body, team or dark."""
    if name not in ("body", "team", "dark"):
        raise ValueError(f"material name must be body, team or dark, got {name}")
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
    }


def _finish(obj, name, mat):
    obj.name = name
    obj.data.name = name
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def box(name, size, location, mat, bevel=0.0):
    """Axis-aligned box of full extents `size` centred at `location`."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return _finish(obj, name, mat)


def cylinder(name, radius, depth, location, mat, vertices=8, axis="Z"):
    """Cylinder along `axis` (X, Y or Z) centred at `location`."""
    rotation = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    obj = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
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


def soldier(name, weapon, mats, height=0.5):
    """Low-poly standing soldier facing -Y; weapon is rifle or launcher."""
    s = height / 0.5
    body, team, dark = mats["body"], mats["team"], mats["dark"]
    parts = [
        box(f"{name}_legs", (0.12 * s, 0.08 * s, 0.22 * s), (0, 0, 0.11 * s), body),
        box(f"{name}_torso", (0.16 * s, 0.1 * s, 0.17 * s), (0, 0, 0.305 * s), body),
        box(f"{name}_vest", (0.17 * s, 0.11 * s, 0.08 * s), (0, 0, 0.33 * s), team),
        box(f"{name}_head", (0.08 * s, 0.08 * s, 0.08 * s), (0, 0, 0.44 * s), body),
        box(f"{name}_helmet", (0.1 * s, 0.1 * s, 0.04 * s), (0, 0, 0.48 * s), dark),
    ]
    if weapon == "launcher":
        parts.append(cylinder(f"{name}_tube", 0.03 * s, 0.32 * s, (0.09 * s, -0.02 * s, 0.4 * s), dark, 6, "Y"))
    else:
        parts.append(box(f"{name}_rifle", (0.03 * s, 0.22 * s, 0.03 * s), (0.07 * s, -0.1 * s, 0.3 * s), dark))
    return join(parts, name)


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


def export(type_id, root):
    """Names `root` after the type and writes client/public/models/<type_id>.glb."""
    root.name = type_id
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
    )
    print(f"exported {path}", file=sys.stderr)


def load_lib_dir():
    """Lets model scripts `import lib` when run through blender --python."""
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
