"""Process Meshy raw ground textures into seamless 512x512 WebP textures for Modern Conquest: Red Line."""

import os
import sys
import bpy
import numpy as np

BORDER_PIXELS = 16
OUTPUT_SIZE = 512
QUALITY = 90

TEXTURES = [
    ("grass", "/home/pikilon/Work/red-line/.tmp/meshy/grass-raw.png", "/home/pikilon/Work/red-line/client/public/textures/grass.webp"),
    ("dirt", "/home/pikilon/Work/red-line/.tmp/meshy/dirt-raw.png", "/home/pikilon/Work/red-line/client/public/textures/dirt.webp"),
    ("rock", "/home/pikilon/Work/red-line/.tmp/meshy/rock-raw.png", "/home/pikilon/Work/red-line/client/public/textures/rock.webp"),
]

def smooth(t):
    return t * t * (3.0 - 2.0 * t)

def make_tileable(arr, border=BORDER_PIXELS):
    """
    Make 2D RGBA array tileable with a border-width wrap blend.
    arr: (H, W, C) float32 in [0, 1]
    """
    h, w, c = arr.shape
    rolled = np.roll(arr, (h // 2, w // 2), axis=(0, 1))

    x = np.arange(w)
    dx = np.minimum(x, w - 1 - x)
    tx = np.clip(dx / float(border), 0.0, 1.0)
    mx = smooth(tx)

    y = np.arange(h)
    dy = np.minimum(y, h - 1 - y)
    ty = np.clip(dy / float(border), 0.0, 1.0)
    my = smooth(ty)

    m = (my[:, None] * mx[None, :])[:, :, None]

    blended = arr * m + rolled * (1.0 - m)
    blended[:, :, 3] = 1.0  # Solid alpha
    return blended

def process_texture(name, in_path, out_path):
    if not os.path.exists(in_path):
        raise FileNotFoundError(f"Input image not found: {in_path}")

    print(f"[{name}] Loading {in_path}...")
    img = bpy.data.images.load(in_path)
    print(f"[{name}] Original size: {img.size[0]}x{img.size[1]}, scaling to {OUTPUT_SIZE}x{OUTPUT_SIZE}...")
    img.scale(OUTPUT_SIZE, OUTPUT_SIZE)

    # Get pixels
    px = np.empty(OUTPUT_SIZE * OUTPUT_SIZE * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    arr = px.reshape((OUTPUT_SIZE, OUTPUT_SIZE, 4))

    print(f"[{name}] Applying {BORDER_PIXELS}-pixel seamless border wrap...")
    blended = make_tileable(arr, border=BORDER_PIXELS).astype(np.float32)

    # Put pixels back into image
    img.pixels.foreach_set(blended.ravel())
    img.update()

    # Configure render settings for WebP
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.quality = QUALITY

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save_render(out_path, scene=scene)
    print(f"[{name}] Saved WebP to {out_path} ({os.path.getsize(out_path):,} bytes)")

    # Save a 2x2 tiled preview PNG for verification
    preview_path = f"/home/pikilon/Work/red-line/.tmp/meshy/{name}-tile2x2.png"
    # Create 2x2 tile
    top_row = np.hstack([blended, blended])
    bottom_row = np.hstack([blended, blended])
    tile2x2 = np.vstack([bottom_row, top_row]).astype(np.float32)  # bottom to top for Blender

    tile_img = bpy.data.images.new(f"{name}_preview", width=OUTPUT_SIZE * 2, height=OUTPUT_SIZE * 2)
    tile_img.pixels.foreach_set(tile2x2.ravel())
    tile_img.update()

    scene.render.image_settings.file_format = 'PNG'
    tile_img.save_render(preview_path, scene=scene)
    print(f"[{name}] Saved 2x2 tile preview to {preview_path}")

    # Clean up
    bpy.data.images.remove(img)
    bpy.data.images.remove(tile_img)

def main():
    for name, in_path, out_path in TEXTURES:
        process_texture(name, in_path, out_path)
    print("All textures processed successfully.")

if __name__ == "__main__":
    main()
