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
      data[o] = Math.round(70 + 60 * (1 - depth));
      data[o + 1] = Math.round(6 + 10 * (1 - depth));
      data[o + 2] = Math.round(8 + 10 * (1 - depth));
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
