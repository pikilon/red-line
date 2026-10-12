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
