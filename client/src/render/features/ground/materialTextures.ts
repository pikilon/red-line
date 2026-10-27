import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import {
  createRng,
  TEXTURE_SIZE,
  terrainPixels,
  valueNoise,
} from "../../terrainTexture";

/** Spec 26 Phase 3: the generated, seamless texture of every ground material.
 *  Grass, dirt and rock reuse the terrain's own pixels, so a patch of dirt
 *  matches the dirt the terrain already shows. */
export const GROUND_MATERIALS = [
  "grass",
  "dirt",
  "sand",
  "rock",
  "mud",
  "gravel",
  "asphalt",
  "concrete",
  "snow-field",
] as const;
export type GroundMaterial = (typeof GROUND_MATERIALS)[number];

type Rgb = readonly [number, number, number];

const SIZE = TEXTURE_SIZE;

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

/** Seamless two-octave noise in [0, 1] (wraps every 256 px). */
const noise = (x: number, y: number, coarse: number, seed: number): number =>
  valueNoise(x, y, coarse, seed) * 0.65 + valueNoise(x, y, 16, seed + 7) * 0.35;

function put(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  [r, g, b]: Rgb,
): void {
  const px = ((x % SIZE) + SIZE) % SIZE;
  const py = ((y % SIZE) + SIZE) % SIZE;
  const o = (py * SIZE + px) * 4;
  pixels[o] = r;
  pixels[o + 1] = g;
  pixels[o + 2] = b;
  pixels[o + 3] = 255;
}

function get(pixels: Uint8ClampedArray, x: number, y: number): Rgb {
  const px = ((x % SIZE) + SIZE) % SIZE;
  const py = ((y % SIZE) + SIZE) % SIZE;
  const o = (py * SIZE + px) * 4;
  return [pixels[o] ?? 0, pixels[o + 1] ?? 0, pixels[o + 2] ?? 0];
}

/** Fills the texture with `shade(x, y, rng)`. */
function paint(
  seed: number,
  shade: (x: number, y: number, rng: () => number) => Rgb,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
  const rng = createRng(seed * 31 + 5);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) put(pixels, x, y, shade(x, y, rng));
  }
  return pixels;
}

/** Scatters `count` round stones of radius `[min, max]` px; wraps at the edges. */
function stones(
  pixels: Uint8ClampedArray,
  seed: number,
  count: number,
  min: number,
  max: number,
  tones: readonly Rgb[],
): void {
  const rng = createRng(seed);
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(rng() * SIZE);
    const cy = Math.floor(rng() * SIZE);
    const radius = min + rng() * (max - min);
    const tone = tones[Math.floor(rng() * tones.length)] ??
      tones[0] ?? [0, 0, 0];
    const reach = Math.ceil(radius + 1);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        // Lit from the top-left: light cap, dark underside.
        const light = 1 + (-dx - dy) * 0.045 - (d / radius) * 0.18;
        put(pixels, cx + dx, cy + dy, scale(tone, light));
      }
    }
    // A short shadow beside each stone.
    for (let k = 0; k < radius; k++) {
      const x = cx + Math.round(radius) + 1;
      const y = cy + Math.round(radius * 0.4) + k - 1;
      put(pixels, x, y, scale(get(pixels, x, y), 0.62));
    }
  }
}

const SAND_LIGHT: Rgb = [226, 204, 150];
const SAND_DARK: Rgb = [186, 160, 108];

function sandPixels(seed: number): Uint8ClampedArray {
  return paint(seed, (x, y, rng) => {
    const n = noise(x, y, 128, seed);
    // Wind ripples: soft diagonal waves bent by noise.
    const ripple =
      Math.sin(((x * 0.6 + y * 0.8) / SIZE) * Math.PI * 2 * 9 + n * 6) * 0.5 +
      0.5;
    let c = mixRgb(
      SAND_DARK,
      SAND_LIGHT,
      0.35 + n * 0.4 + (ripple - 0.5) * 0.28,
    );
    const grain = rng();
    if (grain < 0.06) c = scale(c, 0.88);
    else if (grain > 0.96) c = scale(c, 1.08);
    return c;
  });
}

const MUD_DARK: Rgb = [70, 52, 36];
const MUD_LIGHT: Rgb = [104, 80, 56];

function mudPixels(seed: number): Uint8ClampedArray {
  return paint(seed, (x, y, rng) => {
    const n =
      valueNoise(x, y, 256, seed) * 0.8 + valueNoise(x, y, 64, seed + 2) * 0.2;
    let c = mixRgb(MUD_DARK, MUD_LIGHT, n);
    c = scale(c, 0.95 + rng() * 0.1);
    // Wet puddle sheen where the noise peaks.
    const wet = valueNoise(x, y, 256, seed + 3);
    if (wet > 0.58)
      c = mixRgb(c, [84, 86, 88], Math.min(0.5, (wet - 0.58) * 2.5));
    return c;
  });
}

function gravelPixels(seed: number): Uint8ClampedArray {
  const base = paint(seed, (x, y) =>
    mixRgb([92, 88, 82], [128, 122, 114], noise(x, y, 64, seed)),
  );
  stones(base, seed + 1, 520, 2, 4.2, [
    [150, 144, 134],
    [172, 166, 154],
    [118, 112, 104],
    [140, 128, 112],
    [188, 180, 168],
  ]);
  return base;
}

function asphaltPixels(seed: number): Uint8ClampedArray {
  return paint(seed, (x, y, rng) => {
    const n = noise(x, y, 64, seed);
    let c = mixRgb([58, 60, 64], [84, 86, 88], n);
    if (rng() < 0.12) c = scale(c, rng() < 0.5 ? 0.82 : 1.18);
    if (Math.abs(valueNoise(x, y, 64, seed + 9) - 0.5) < 0.012)
      c = scale(c, 0.45);
    return c;
  });
}

function concretePixels(seed: number): Uint8ClampedArray {
  return paint(seed, (x, y, rng) => {
    const n = noise(x, y, 128, seed);
    let c = mixRgb([150, 150, 144], [184, 183, 174], n);
    c = scale(c, 0.97 + rng() * 0.06);
    // Slab joints every two tiles (128 px) with a darker groove.
    const jx = Math.min(x % 128, 128 - (x % 128));
    const jy = Math.min(y % 128, 128 - (y % 128));
    if (jx < 2 || jy < 2) c = scale(c, 0.68);
    else if (jx < 4 || jy < 4) c = scale(c, 1.06);
    // Stains and a few hairline cracks.
    if (valueNoise(x, y, 64, seed + 11) > 0.7) c = scale(c, 0.9);
    if (Math.abs(valueNoise(x, y, 32, seed + 13) - 0.5) < 0.008)
      c = scale(c, 0.6);
    return c;
  });
}

function snowPixels(seed: number): Uint8ClampedArray {
  return paint(seed, (x, y, rng) => {
    const n = noise(x, y, 128, seed);
    let c = mixRgb([214, 224, 236], [246, 249, 252], n);
    if (rng() < 0.01) c = [255, 255, 255];
    return c;
  });
}

function rockPixels(seed: number): Uint8ClampedArray {
  return terrainPixels("rock", seed);
}

const GENERATORS: Record<GroundMaterial, (seed: number) => Uint8ClampedArray> =
  {
    grass: (seed) => terrainPixels("grass", seed),
    dirt: (seed) => terrainPixels("dirt", seed),
    sand: sandPixels,
    rock: rockPixels,
    mud: mudPixels,
    gravel: gravelPixels,
    asphalt: asphaltPixels,
    concrete: concretePixels,
    "snow-field": snowPixels,
  };

/** RGBA pixels (`TEXTURE_SIZE`²×4) of one material. */
export function groundMaterialPixels(
  material: GroundMaterial,
  seed: number,
): Uint8ClampedArray {
  return GENERATORS[material](seed);
}

/** All materials as the layers of one array texture (layer = ground byte). */
export function createGroundMaterialTexture(seed: number): DataArrayTexture {
  const layerSize = SIZE * SIZE * 4;
  const data = new Uint8Array(layerSize * GROUND_MATERIALS.length);
  GROUND_MATERIALS.forEach((material, layer) => {
    data.set(
      groundMaterialPixels(material, seed + layer * 17),
      layer * layerSize,
    );
  });
  const texture = new DataArrayTexture(
    data,
    SIZE,
    SIZE,
    GROUND_MATERIALS.length,
  );
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
