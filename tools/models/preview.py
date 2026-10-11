"""Renders committed models side by side from the game's isometric angle.

blender --background --factory-startup --python tools/models/preview.py -- <out.png> <type-id>...
Set PREVIEW_SPACING (tiles, default 1.15) for larger models such as buildings.
"""

import math
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :]
out, ids = args[0], args[1:]
models = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "client", "public", "models")

bpy.ops.wm.read_factory_settings(use_empty=True)
spacing = float(os.environ.get("PREVIEW_SPACING", "1.15"))
for i, type_id in enumerate(ids):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(models, f"{type_id}.glb"))
    for obj in set(bpy.data.objects) - before:
        if obj.parent is None:
            obj.location.x += i * spacing
            obj.location.y += i * spacing

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "MATERIAL"
scene.render.resolution_x, scene.render.resolution_y = 400 * max(len(ids), 1), 400
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.ortho_scale = 1.43 * spacing * max(len(ids), 1)
centre = (len(ids) - 1) * spacing / 2
cam.location = (centre + 6, centre - 6, 6.3)
cam.rotation_euler = (math.radians(54.7), 0, math.radians(45))
scene.camera = cam
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
