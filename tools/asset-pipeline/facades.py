#!/usr/bin/env python3
"""Building facade textures (spec 16) from CC0 Poly Haven sources of the asset library.

Run with the ComfyUI venv (numpy + Pillow):
  ~/.local/share/comfyui/.venv/bin/python tools/asset-pipeline/facades.py [--out DIR]

Reads only `04_CC0_Public_Domain` (CC0-1.0) from $ASSET_LIBRARY (default
~/Pictures/c&c assets) and writes `<id>.webp` (512 px, real colour, not a
detail map) into DIR (default client/public/textures of this checkout):

  ru-wall  red brick: Soviet-era Russian military barracks
  ua-wall  white silicate brick: common in Ukrainian Soviet-era buildings
  ru-roof  green-painted corrugated steel: Russian barracks and depots
  ua-roof  grey corrugated asbestos-cement ("shyfer"): Ukrainian roofs
"""
import argparse, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
LIBRARY = os.environ.get("ASSET_LIBRARY", os.path.expanduser("~/Pictures/c&c assets"))
FACADE = "04_CC0_Public_Domain/polyhaven/models/modular_factory_facade/textures"
BRICK = f"{FACADE}/modular_factory_facade_brick_diff_1k.jpg"
GARAGE = f"{FACADE}/modular_factory_facade_garage_diff_1k.jpg"
# Rows of the garage shutter between two panel seams: one vertical period of
# the corrugation, so the crop tiles in both directions.
SHUTTER_ROWS = (442, 732)
SIZE = 512


def read(rel):
    return np.asarray(Image.open(os.path.join(LIBRARY, rel)).convert("RGB"), dtype=np.float32)


def resize(a, size=SIZE):
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return np.asarray(img.resize((size, size), Image.LANCZOS), dtype=np.float32)


def luminance(a):
    return a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)


def tint(lum, colour, contrast):
    """`colour` (RGB 0..255) modulated by the normalised luminance."""
    n = (lum - lum.mean()) / max(float(lum.std()), 1.0)
    return np.array(colour, dtype=np.float32) * (1 + contrast * n)[..., None]


def ru_wall():
    a = resize(read(BRICK))
    grey = luminance(a)[..., None]
    # Slightly weathered: 15 % towards grey.
    return a * 0.85 + grey * 0.15


def ua_wall():
    lum = luminance(resize(read(BRICK)))
    # Silicate bricks are pale; the mortar between them reads darker and greyer,
    # so the brick/mortar contrast of the red source is inverted.
    return tint(lum, (206, 204, 194), -0.09)


def shutter():
    a = read(GARAGE)[SHUTTER_ROWS[0] : SHUTTER_ROWS[1]]
    # Transposed: roofs project (x, z), so the corrugation runs along z, down
    # the slope of the gable roofs whose ridge runs along x.
    return luminance(resize(a)).T


def ru_roof():
    return tint(shutter(), (74, 112, 70), 0.22)


def ua_roof():
    return tint(shutter(), (150, 152, 146), 0.18)


TEXTURES = {"ru-wall": ru_wall, "ua-wall": ua_wall, "ru-roof": ru_roof, "ua-roof": ua_roof}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=os.path.join(REPO, "client", "public", "textures"))
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for tid, make in TEXTURES.items():
        image = Image.fromarray(np.clip(make(), 0, 255).astype(np.uint8))
        target = os.path.join(args.out, f"{tid}.webp")
        image.save(target, "WEBP", quality=90, method=6)
        print("wrote", target)


if __name__ == "__main__":
    main()
