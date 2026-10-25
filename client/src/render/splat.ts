import {
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";

/** Side of the splat texture, texels. */
const SIZE = 128;
/** Satellite drops and thin streaks round the main pool. */
const DROPS = 11;
const STREAKS = 6;

/** Small seeded generator so every run paints the same splat. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** An irregular blood splat (spec 22 §4): a wobbly pool darker in the middle,
 *  scattered drops and a few streaks, soft at the edge, drawn into the alpha
 *  channel of a small RGBA texture over a unit square. */
export function createSplatTexture(): DataTexture {
  const rnd = random(0x5ba7);
  const wobble = [0, 1, 2].map(() => rnd() * Math.PI * 2);
  const drops = Array.from({ length: DROPS }, () => ({
    angle: rnd() * Math.PI * 2,
    distance: 0.36 + rnd() * 0.12,
    radius: 0.012 + rnd() * 0.03,
  }));
  const streaks = Array.from({ length: STREAKS }, () => ({
    angle: rnd() * Math.PI * 2,
    from: 0.3 + rnd() * 0.05,
    length: 0.07 + rnd() * 0.08,
    width: 0.008 + rnd() * 0.008,
  }));
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = (px + 0.5) / SIZE - 0.5;
      const y = (py + 0.5) / SIZE - 0.5;
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      const edge =
        0.3 +
        0.045 * Math.sin(3 * a + (wobble[0] ?? 0)) +
        0.035 * Math.sin(5 * a + (wobble[1] ?? 0)) +
        0.02 * Math.sin(9 * a + (wobble[2] ?? 0));
      let alpha = 1 - smoothstep(edge - 0.035, edge + 0.01, r);
      for (const drop of drops) {
        const d = Math.hypot(
          x - Math.cos(drop.angle) * drop.distance,
          y - Math.sin(drop.angle) * drop.distance,
        );
        alpha = Math.max(
          alpha,
          1 - smoothstep(drop.radius * 0.6, drop.radius, d),
        );
      }
      for (const streak of streaks) {
        // Distance to the streak's centre line, along and across it.
        const ux = Math.cos(streak.angle);
        const uy = Math.sin(streak.angle);
        const along = x * ux + y * uy - streak.from;
        const across = Math.abs(-x * uy + y * ux);
        if (along > 0 && along < streak.length) {
          const taper = streak.width * (1 - along / streak.length);
          alpha = Math.max(alpha, 1 - smoothstep(taper * 0.5, taper, across));
        }
      }
      // Dark and thick in the middle, redder and thinner towards the edge.
      const depth = 1 - smoothstep(0, Math.max(edge, 0.05), r);
      const o = (py * SIZE + px) * 4;
      data[o] = Math.round(34 + 36 * (1 - depth));
      data[o + 1] = Math.round(2 + 5 * (1 - depth));
      data[o + 2] = Math.round(3 + 6 * (1 - depth));
      data[o + 3] = Math.round(255 * (0.82 + 0.18 * depth) * alpha);
    }
  }
  const texture = new DataTexture(
    data,
    SIZE,
    SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Side of the dust puff texture, texels. */
const PUFF_SIZE = 64;
/** Lumps on the outline of a puff. */
const PUFF_LOBES = 7;

/** A soft, lumpy puff of dust (spec 29 §3): white with a darker, denser core
 *  so the tint per instance gives the soil colour; alpha falls off softly. */
export function createPuffTexture(): DataTexture {
  const rnd = random(0xd057);
  const lobes = Array.from({ length: PUFF_LOBES }, () => ({
    angle: rnd() * Math.PI * 2,
    distance: 0.12 + rnd() * 0.14,
    radius: 0.13 + rnd() * 0.1,
  }));
  const data = new Uint8Array(PUFF_SIZE * PUFF_SIZE * 4);
  for (let py = 0; py < PUFF_SIZE; py++) {
    for (let px = 0; px < PUFF_SIZE; px++) {
      const x = (px + 0.5) / PUFF_SIZE - 0.5;
      const y = (py + 0.5) / PUFF_SIZE - 0.5;
      let density = 1 - smoothstep(0.05, 0.3, Math.hypot(x, y));
      for (const lobe of lobes) {
        const d = Math.hypot(
          x - Math.cos(lobe.angle) * lobe.distance,
          y - Math.sin(lobe.angle) * lobe.distance,
        );
        density = Math.max(density, 1 - smoothstep(0, lobe.radius, d));
      }
      // Sunlit top, shaded bottom: the puff reads as a volume.
      const shade = 0.78 + 0.22 * smoothstep(-0.3, 0.3, y);
      const o = (py * PUFF_SIZE + px) * 4;
      const value = Math.round(255 * shade);
      data[o] = value;
      data[o + 1] = value;
      data[o + 2] = value;
      data[o + 3] = Math.round(255 * density * density);
    }
  }
  const texture = new DataTexture(
    data,
    PUFF_SIZE,
    PUFF_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Side of the fireball texture, texels. */
const FIREBALL_SIZE = 128;
/** Ragged flame lobes around the fireball. */
const FIREBALL_LOBES = 9;

/** A camera-facing fireball for explosions (spec 07 §3): a white-hot core,
 *  orange flames with ragged lobes and a sooty red edge, alpha falling to
 *  zero well inside the quad so it never reads as a lit box or square. */
export function createFireballTexture(): DataTexture {
  const rnd = random(0xf1e8);
  const lobes = Array.from({ length: FIREBALL_LOBES }, () => ({
    angle: rnd() * Math.PI * 2,
    distance: 0.13 + rnd() * 0.16,
    radius: 0.07 + rnd() * 0.1,
  }));
  const wobble = [0, 1, 2].map(() => rnd() * Math.PI * 2);
  const data = new Uint8Array(FIREBALL_SIZE * FIREBALL_SIZE * 4);
  for (let py = 0; py < FIREBALL_SIZE; py++) {
    for (let px = 0; px < FIREBALL_SIZE; px++) {
      const x = (px + 0.5) / FIREBALL_SIZE - 0.5;
      const y = (py + 0.5) / FIREBALL_SIZE - 0.5;
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      const edge =
        0.3 +
        0.05 * Math.sin(3 * a + (wobble[0] ?? 0)) +
        0.04 * Math.sin(5 * a + (wobble[1] ?? 0)) +
        0.025 * Math.sin(9 * a + (wobble[2] ?? 0));
      let density = 1 - smoothstep(edge - 0.07, edge + 0.02, r);
      for (const lobe of lobes) {
        const d = Math.hypot(
          x - Math.cos(lobe.angle) * lobe.distance,
          y - Math.sin(lobe.angle) * lobe.distance,
        );
        density = Math.max(density, 1 - smoothstep(0, lobe.radius, d));
      }
      const heat = 1 - smoothstep(0.02, 0.44, r);
      const white = 1 - smoothstep(0.03, 0.2, r);
      const red = Math.round(120 + 135 * heat);
      const green = Math.round(20 + 230 * heat ** 1.4);
      const blue = Math.round(4 + 190 * heat ** 3);
      const o = (py * FIREBALL_SIZE + px) * 4;
      data[o] = Math.round(red + (255 - red) * white * 0.85);
      data[o + 1] = Math.round(green + (248 - green) * white * 0.85);
      data[o + 2] = Math.round(blue + (210 - blue) * white * 0.85);
      data[o + 3] = Math.round(255 * density ** 1.15);
    }
  }
  const texture = new DataTexture(
    data,
    FIREBALL_SIZE,
    FIREBALL_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
