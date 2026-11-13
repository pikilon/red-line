"""Import and post-process a Meshy GLB into a game-ready model in client/public/models/.

Usage:
    blender --background --factory-startup --python tools/models/meshy_import.py -- <type-id> <input-glb> [--walk <walk-glb>] [--run <run-glb>] [--combat <combat-glb>]
"""

import json
import math
import os
import shutil
import subprocess
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import lib  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
RULESET_PATH = os.path.join(REPO, "data", "generated", "ruleset.json")
MESHY_DIR = os.path.join(REPO, "client", "public", "models", "meshy")
TERRAIN_DIR = os.path.join(REPO, "client", "public", "models", "terrain")

TURRETED = {
    "ua-bradley",
    "ua-leopard-2a4",
    "ua-himars",
    "ua-kozak-scout",
    "ua-defense",
    "ua-tw-12-7",
    "ua-gepard",
    "ua-patriot",
    "ru-bmp-2",
    "ru-t-72b3",
    "ru-tos-1a",
    "ru-brdm-scout",
    "ru-defense",
    "ru-pantsir",
}

INFANTRY_TYPES = {
    "ua-rifleman",
    "ru-rifleman",
    "ru-rpg-gunner",
    "ua-stugna-team",
    "ua-fpv-team",
    "ru-molniya-crew",
}

BUDGETS = {"unit": 1500, "building": 3000, "depot": 1000}


def parse_args():
    argv = sys.argv
    if "--" not in argv:
        raise SystemExit("Usage: blender ... --python meshy_import.py -- <type_id> <input_glb>")
    args = argv[argv.index("--") + 1 :]
    if len(args) < 2:
        raise SystemExit("Expected <type_id> <input_glb>")
    type_id = args[0]
    input_glb = os.path.abspath(args[1])
    extras = {}
    i = 2
    while i < len(args):
        if args[i] in ("--walk", "--run", "--combat", "--rigged") and i + 1 < len(args):
            extras[args[i].lstrip("-")] = os.path.abspath(args[i + 1])
            i += 2
        else:
            i += 1
    return type_id, input_glb, extras


def extract_first_image():
    """Finds the first baseColor image in any material of the current scene and scales it to 512x512."""
    for mat in bpy.data.materials:
        tree = getattr(mat, "node_tree", None)
        if tree is None:
            continue
        for node in tree.nodes:
            if node.type == "TEX_IMAGE" and getattr(node, "image", None) is not None:
                img = node.image
                try:
                    img.scale(512, 512)
                    img.pack()
                except Exception:
                    pass
                return img
    for img in bpy.data.images:
        if img.name not in ("Render Result", "Viewer Node") and img.size[0] > 0:
            try:
                img.scale(512, 512)
                img.pack()
            except Exception:
                pass
            return img
    return None


def attach_image_to_material(mat, img):
    """Connects `img` as Base Color texture of `mat`'s Principled BSDF."""
    if img is None:
        return mat
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes.get("Principled BSDF")
    if bsdf is None:
        return mat
    tex_node = None
    for node in tree.nodes:
        if node.type == "TEX_IMAGE":
            tex_node = node
            break
    if tex_node is None:
        tex_node = tree.nodes.new("ShaderNodeTexImage")
    tex_node.image = img
    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.85
    tree.links.new(bsdf.inputs["Base Color"], tex_node.outputs["Color"])
    return mat


def import_and_consolidate(glb_path, body_mat, target_tris):
    """Imports a GLB, merges all meshes into one object with `body_mat`, and decimates to `target_tris`."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == "MESH" and len(obj.data.polygons) > 0]
    if not meshes:
        raise RuntimeError(f"No mesh geometry found in {glb_path}")

    img = extract_first_image()
    attach_image_to_material(body_mat, img)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            if mod.type == "ARMATURE":
                obj.modifiers.remove(mod)
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    merged = bpy.context.active_object

    for obj in list(imported):
        if obj != merged and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    # Clean loose geometry and ensure UVs
    bm = bmesh.new()
    bm.from_mesh(merged.data)
    loose_verts = [v for v in bm.verts if not v.link_faces]
    if loose_verts:
        bmesh.ops.delete(bm, geom=loose_verts, context="VERTS")
    if not bm.loops.layers.uv:
        bm.loops.layers.uv.new("UVMap")
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(merged.data)
    bm.free()

    # Decimate if over target_tris
    current_tris = len(merged.data.polygons)
    if current_tris > target_tris:
        ratio = max(0.02, min(0.98, (target_tris * 0.92) / current_tris))
        mod = merged.modifiers.new("decimate", "DECIMATE")
        mod.ratio = ratio
        bpy.context.view_layer.objects.active = merged
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bm = bmesh.new()
        bm.from_mesh(merged.data)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.to_mesh(merged.data)
        bm.free()

    # Hard cap in case decimate left slightly more than target_tris
    while len(merged.data.polygons) > target_tris:
        mod = merged.modifiers.new("decimate_cap", "DECIMATE")
        mod.ratio = 0.85
        bpy.context.view_layer.objects.active = merged
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bm = bmesh.new()
        bm.from_mesh(merged.data)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.to_mesh(merged.data)
        bm.free()

    merged.data.materials.clear()
    merged.data.materials.append(body_mat)
    for poly in merged.data.polygons:
        poly.material_index = 0
    return merged


def fit_bounds(obj, w, d, h, fill_xy=0.86, fill_z=0.90):
    """Orients and scales `obj` to fit [-w/2, w/2] x [-d/2, d/2] x [0, h] with >=70% fill."""
    verts = obj.data.vertices
    if not verts:
        return
    xs = [v.co.x for v in verts]
    ys = [v.co.y for v in verts]
    zs = [v.co.z for v in verts]
    span_x = max(xs) - min(xs)
    span_y = max(ys) - min(ys)

    # Align longer horizontal axis with ruleset's longer horizontal axis
    if abs(d - w) > 0.12 and (d - w) * (span_y - span_x) < 0:
        rot = Matrix.Rotation(math.pi / 2, 4, "Z")
        obj.data.transform(rot)
        xs = [v.co.x for v in verts]
        ys = [v.co.y for v in verts]
        zs = [v.co.z for v in verts]
        span_x = max(xs) - min(xs)
        span_y = max(ys) - min(ys)

    span_z = max(zs) - min(zs)
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    min_z = min(zs)

    sx = (w * fill_xy) / max(span_x, 1e-4)
    sy = (d * fill_xy) / max(span_y, 1e-4)
    sz = (h * fill_z) / max(span_z, 1e-4)

    for v in verts:
        v.co.x = (v.co.x - cx) * sx
        v.co.y = (v.co.y - cy) * sy
        v.co.z = 0.002 + (v.co.z - min_z) * sz
    obj.data.update()


def split_turret(hull_obj, body_mat, dark_mat, w, d, h):
    """Splits upper turret geometry from `hull_obj` into a `turret` object with origin at pivot."""
    zs = [v.co.z for v in hull_obj.data.vertices]
    max_z = max(zs) if zs else h * 0.8
    split_z = max_z * 0.55

    bm_hull = bmesh.new()
    bm_hull.from_mesh(hull_obj.data)
    bm_turret = bm_hull.copy()

    hull_drop = [f for f in bm_hull.faces if f.calc_center_median().z >= split_z]
    turret_drop = [f for f in bm_turret.faces if f.calc_center_median().z < split_z]

    # Ensure neither part is empty
    if len(hull_drop) < len(bm_hull.faces) and len(turret_drop) < len(bm_turret.faces):
        bmesh.ops.delete(bm_hull, geom=hull_drop, context="FACES")
        bmesh.ops.delete(bm_turret, geom=turret_drop, context="FACES")
        for bm in (bm_hull, bm_turret):
            loose = [v for v in bm.verts if not v.link_faces]
            if loose:
                bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm_hull.to_mesh(hull_obj.data)
        hull_obj.data.update()

        turret_mesh = bpy.data.meshes.new("turret")
        bm_turret.to_mesh(turret_mesh)
        turret_mesh.materials.append(body_mat)
        turret_obj = bpy.data.objects.new("turret", turret_mesh)
        bpy.context.scene.collection.objects.link(turret_obj)
        pivot = (0.0, 0.0, split_z)
        cursor = bpy.context.scene.cursor
        cursor.location = pivot
        bpy.ops.object.select_all(action="DESELECT")
        turret_obj.select_set(True)
        bpy.context.view_layer.objects.active = turret_obj
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        cursor.location = (0, 0, 0)
    else:
        pivot = (0.0, 0.0, max_z * 0.6)
        gun = lib.barrel("turret_gun", d * 0.35, min(w, d) * 0.03, pivot, dark_mat)
        turret_obj = lib.turret([gun], pivot)

    bm_hull.free()
    bm_turret.free()
    return turret_obj


def build_terrain_feature(type_id, input_glb):
    os.makedirs(TERRAIN_DIR, exist_ok=True)
    lib.reset_scene()
    m = lib.palette("ukraine")
    merged = import_and_consolidate(input_glb, m["body"], 600)
    fit_bounds(merged, 1.0, 1.0, 1.0, fill_xy=0.90, fill_z=0.98)
    merged.name = type_id
    lib.bake_ambient_occlusion()
    bpy.ops.object.select_all(action="SELECT")
    out_path = os.path.join(TERRAIN_DIR, f"{type_id}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
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
    print(f"exported terrain feature {out_path}", file=sys.stderr)


def main():
    type_id, input_glb, extras = parse_args()
    os.makedirs(MESHY_DIR, exist_ok=True)

    # Save a copy of the raw Meshy GLB and any animation GLBs in client/public/models/meshy/
    shutil.copy2(input_glb, os.path.join(MESHY_DIR, f"{type_id}.glb"))
    for kind, path in extras.items():
        if os.path.exists(path):
            shutil.copy2(path, os.path.join(MESHY_DIR, f"{type_id}-{kind}.glb"))

    if type_id.startswith("terrain-"):
        build_terrain_feature(type_id, input_glb)
        return

    if type_id in INFANTRY_TYPES:
        script = os.path.join(HERE, f"{type_id}.py")
        subprocess.run(
            ["blender", "--background", "--factory-startup", "--python", script],
            check=True,
        )
        return

    with open(RULESET_PATH, "r", encoding="utf-8") as f:
        ruleset = json.load(f)
    type_def = next((t for t in ruleset["types"] if t["id"] == type_id), None)
    if type_def is None:
        raise SystemExit(f"Unknown type_id in ruleset: {type_id}")

    w, h, d = [v / 100.0 for v in type_def["render"]["size"]]
    category = type_def["category"]
    budget = BUDGETS[category]
    faction = "russia" if type_id.startswith("ru-") else "ukraine" if type_id.startswith("ua-") else "neutral"

    lib.reset_scene()
    m = lib.palette(faction)
    merged = import_and_consolidate(input_glb, m["body"], budget - 60)
    fit_bounds(merged, w, d, h, fill_xy=0.86, fill_z=0.90)

    # Add subtle team marking strip inside the footprint so `team` slot exists
    strip = lib.box(
        "team_strip",
        (w * 0.25, d * 0.06, h * 0.06),
        (0.0, -d * 0.36, h * 0.35),
        m["team"],
        bevel=0.0,
    )
    root = lib.join([merged, strip], type_id)

    if type_id in TURRETED:
        turret_obj = split_turret(root, m["body"], m["dark"], w, d, h)
        lib.parent(turret_obj, root)

    lib.export(type_id, root)


if __name__ == "__main__":
    main()
