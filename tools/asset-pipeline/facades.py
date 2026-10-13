#!/usr/bin/env python3
"""Building facade textures (spec 16) from CC0 Poly Haven sources of the asset library.

Run with the ComfyUI venv (numpy + Pillow):
  ~/.local/share/comfyui/.venv/bin/python tools/asset-pipeline/facades.py [--out DIR]

Reads only `04_CC0_Public_Domain` (CC0-1.0) from $ASSET_LIBRARY (default
~/Pictures/c&c assets) and writes `<id>.webp` (512 px, real colour, not a
detail map) into DIR (default client/public/textures of this checkout):

  ua-wall  weathered silicate brick: common in Ukrainian Soviet-era buildings
  ua-roof  weathered grey corrugated asbestos-cement ("shyfer") roofs

Russian buildings keep `ru-concrete` (owner decision 2026-10-14).
"""
import argparse, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
LIBRARY = os.environ.get("ASSET_LIBRARY", os.path.expanduser("~/Pictures/c&c assets"))
FACADE = "04_CC0_Public_Domain/polyhaven/models/modular_factory_facade/textures"
BRICK = f"{FACADE}/modular_factory_facade_brick_diff_1k.jpg"
# Ambient occlusion (R), roughness (G), metalness (B): the AO is dark in the
# mortar joints.
BRICK_ARM = f"{FACADE}/modular_factory_facade_brick_arm_1k.jpg"
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


def periodic_noise(shape, seed, beta, freq_x=1.0, freq_y=1.0):
    """Tileable fractal noise in -1..1: white noise filtered by 1/f^beta in the
    frequency domain, so it wraps at the edges. `freq_*` stretch the spectrum."""
    rng = np.random.default_rng(seed)
    h, w = shape
    fy = np.fft.fftfreq(h)[:, None] * h / freq_y
    fx = np.fft.fftfreq(w)[None, :] * w / freq_x
    f = np.sqrt(fx**2 + fy**2)
    f[0, 0] = 1.0
    spectrum = np.fft.fft2(rng.standard_normal(shape)) / f**beta
    spectrum[0, 0] = 0
    n = np.real(np.fft.ifft2(spectrum))
    return n / max(float(np.abs(n).max()), 1e-6)


GRIME = np.array((104, 98, 88), dtype=np.float32)


def weather(a, seed, grime, streaks):
    """Blotchy grime and vertical rain streaks over `a`, tileable."""
    shape = a.shape[:2]
    blotch = np.clip(periodic_noise(shape, seed, 1.6), 0, 1) ** 1.5
    # Streaks: fine along x, long along y (v runs up the wall).
    streak = np.clip(periodic_noise(shape, seed + 1, 1.2, freq_x=6.0, freq_y=0.25), 0, 1)
    k = np.clip(grime * blotch + streaks * streak, 0, 0.8)[..., None]
    return a * (1 - k) + GRIME * k


def ua_wall():
    lum = luminance(resize(read(BRICK)))
    ao = resize(read(BRICK_ARM))[..., 0] / 255
    # Off-white silicate bricks keep the brick-to-brick variation of the source
    # (its dark bricks become grey ones); the joints are shaded by the AO so
    # the mortar reads darker than the bricks; grime and rain streaks on top.
    a = tint(lum, (176, 173, 164), 0.12) * (0.35 + 0.65 * ao**2)[..., None]
    return weather(a, seed=7, grime=0.55, streaks=0.4)


def shutter():
    a = read(GARAGE)[SHUTTER_ROWS[0] : SHUTTER_ROWS[1]]
    # Transposed: roofs project (x, z), so the corrugation runs along z, down
    # the slope of the gable roofs whose ridge runs along x.
    return luminance(resize(a)).T


def ua_roof():
    a = tint(shutter(), (138, 138, 130), 0.2)
    return weather(a, seed=11, grime=0.5, streaks=0.15)


TEXTURES = {"ua-wall": ua_wall, "ua-roof": ua_roof}


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
