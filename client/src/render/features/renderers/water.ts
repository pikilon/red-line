import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  Mesh,
  type Object3D,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
} from "three";
import { climateFor } from "../../weather";
import {
  type FeatureContext,
  type TerrainLayers,
  WATER_DEEP,
  WATER_DEPTH_MASK,
  WATER_KIND_SHIFT,
} from "../layers";
import { registerWaterRenderer } from "../registry";

/** Spec 26 phase 4: rivers, lakes and sea as one animated water surface.
 *
 *  One mesh (one draw call) covers every water cell plus a one cell margin.
 *  The water layer becomes a small coverage field (4 texels per cell, blurred)
 *  so shores are smooth curves instead of cell squares; the fragment shader
 *  reads coverage, depth and kind from it and adds: scrolling generated
 *  normals (sea waves stronger than lake, rivers flow), the shallow to deep
 *  colour ramp, lighter fords and shallows, foam where water meets land, a
 *  dark wet bank on the land side so banks read clearly, and frozen edges
 *  when a snow climate is active. */

/** Texels of the coverage field per map cell. */
const FIELD_SCALE = 4;
/** Water above the ground, so the surface never z-fights the terrain. */
const WATER_LIFT = 0.06;
/** Field value of shallow water; deep is 1. */
const SHALLOW_DEPTH = 0.22;
/** Size of the tileable generated normal map. */
const NORMAL_SIZE = 128;
/** Tiles of map one repeat of the normal map covers. */
const NORMAL_TILE = 10;

/** Kind encoded in the field: 0 river, 0.5 lake, 1 sea. */
const KIND_VALUE = [0, 0, 0.5, 1] as const;

/** Separable box blur of one interleaved RGB field, edges clamped. */
function blur(
  data: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  const tmp = new Float32Array(data.length);
  const out = new Float32Array(data.length);
  const span = radius * 2 + 1;
  const clampX = (x: number): number => Math.min(w - 1, Math.max(0, x));
  const clampY = (y: number): number => Math.min(h - 1, Math.max(0, y));
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += data[(y * w + clampX(k)) * 3 + c] ?? 0;
      }
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 3 + c] = sum / span;
        sum -= data[(y * w + clampX(x - radius)) * 3 + c] ?? 0;
        sum += data[(y * w + clampX(x + radius + 1)) * 3 + c] ?? 0;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += tmp[(clampY(k) * w + x) * 3 + c] ?? 0;
      }
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 3 + c] = sum / span;
        sum -= tmp[(clampY(y - radius) * w + x) * 3 + c] ?? 0;
        sum += tmp[(clampY(y + radius + 1) * w + x) * 3 + c] ?? 0;
      }
    }
  }
  return out;
}

/** RGBA field texture: R coverage, G depth, B kind (both 0 on land). */
export function waterFieldOf(layers: TerrainLayers): DataTexture {
  const w = layers.width * FIELD_SCALE;
  const h = layers.height * FIELD_SCALE;
  let field: Float32Array = new Float32Array(w * h * 3);
  for (let y = 0; y < layers.height; y++) {
    for (let x = 0; x < layers.width; x++) {
      const byte = layers.water[y * layers.width + x] ?? 0;
      const depth = byte & WATER_DEPTH_MASK;
      if (depth === 0) continue;
      const d = depth === WATER_DEEP ? 1 : SHALLOW_DEPTH;
      const kind = KIND_VALUE[byte >> WATER_KIND_SHIFT] ?? 0;
      for (let ty = 0; ty < FIELD_SCALE; ty++) {
        for (let tx = 0; tx < FIELD_SCALE; tx++) {
          const i = ((y * FIELD_SCALE + ty) * w + x * FIELD_SCALE + tx) * 3;
          field[i] = 1;
          field[i + 1] = d;
          field[i + 2] = kind;
        }
      }
    }
  }
  field = blur(blur(field, w, h, 2), w, h, 1);
  const pixels = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const coverage = field[i * 3] ?? 0;
    pixels[i * 4] = Math.round(coverage * 255);
    // Depth and kind were only written on water texels, so the blurred value
    // divided by the blurred coverage is the average over the water alone.
    const norm = coverage > 0.001 ? 1 / coverage : 0;
    pixels[i * 4 + 1] = Math.round(
      Math.min(1, (field[i * 3 + 1] ?? 0) * norm) * 255,
    );
    pixels[i * 4 + 2] = Math.round(
      Math.min(1, (field[i * 3 + 2] ?? 0) * norm) * 255,
    );
    pixels[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(pixels, w, h, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Tileable value noise lattice (deterministic). */
function lattice(period: number, seed: number): Float32Array {
  const values = new Float32Array(period * period);
  let s = seed >>> 0;
  for (let i = 0; i < values.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    values[i] = s / 4294967296;
  }
  return values;
}

/** Generated tileable normal map: RG = normal xy, B and A = height noise. */
export function waterNormalsTexture(size = NORMAL_SIZE): DataTexture {
  const height = new Float32Array(size * size);
  const octaves: [number, number, number][] = [
    [4, 1, 11],
    [8, 0.5, 23],
    [16, 0.25, 37],
    [32, 0.12, 51],
  ];
  for (const [period, amp, seed] of octaves) {
    const grid = lattice(period, seed);
    const at = (gx: number, gy: number): number =>
      grid[(gy % period) * period + (gx % period)] ?? 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * period;
        const fy = (y / size) * period;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const bottom =
          at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        height[y * size + x] =
          (height[y * size + x] ?? 0) + (top + (bottom - top) * sy) * amp;
      }
    }
  }
  const pixels = new Uint8Array(size * size * 4);
  const h = (x: number, y: number): number =>
    height[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (h(x - 1, y) - h(x + 1, y)) * 3;
      const ny = (h(x, y - 1) - h(x, y + 1)) * 3;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      pixels[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      pixels[i + 2] = Math.round(Math.min(1, h(x, y) / 1.9) * 255);
      pixels[i + 3] = Math.round(Math.min(1, h(x + 5, y + 3) / 1.9) * 255);
    }
  }
  const texture = new DataTexture(
    pixels,
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const VERTEX = /* glsl */ `
varying vec2 vWorld;
void main() {
  vWorld = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uField;
uniform sampler2D uNormals;
uniform vec2 uMapSize;
uniform float uTime;
uniform float uFrost;
uniform float uNormalTile;
varying vec2 vWorld;

void main() {
  vec3 f = texture2D(uField, vWorld / uMapSize).rgb;
  float cover = f.r;
  if (cover < 0.12) discard;
  float depth = f.g;
  float kind = f.b;
  float sea = smoothstep(0.7, 1.0, kind);
  float lake = 1.0 - abs(kind - 0.5) * 2.0;
  float river = 1.0 - smoothstep(0.0, 0.3, kind);

  // Two normal layers drifting apart; rivers flow downstream (+z), the sea
  // rolls in larger, faster swells.
  vec2 uv = vWorld / uNormalTile;
  vec2 drift = vec2(0.012 * sea - 0.006 * lake, 0.045 * river + 0.015 * sea + 0.01 * lake);
  vec4 a = texture2D(uNormals, uv + drift * uTime);
  vec4 b = texture2D(uNormals, uv * 1.9 + vec2(0.31, 0.17) - drift * 0.7 * uTime);
  float strength = 0.25 + 0.25 * river + 0.5 * sea + 0.18 * lake;
  vec2 n = ((a.rg + b.rg) - 1.0) * strength;
  vec3 normal = normalize(vec3(n.x, 1.0, n.y));

  vec3 sun = normalize(vec3(-0.45, 0.8, -0.4));
  float diffuse = clamp(dot(normal, sun), 0.0, 1.0);
  vec3 view = normalize(vec3(0.0, 0.8, 0.6));
  float spec = pow(clamp(dot(reflect(-sun, normal), view), 0.0, 1.0), 40.0);

  // Shallow to deep ramp; the kind tints the deep end.
  vec3 shallow = vec3(0.50, 0.80, 0.78);
  vec3 sand = vec3(0.80, 0.78, 0.60);
  vec3 deep = mix(vec3(0.10, 0.31, 0.52), vec3(0.06, 0.22, 0.46), sea);
  deep = mix(deep, vec3(0.10, 0.36, 0.42), lake);
  deep = mix(deep, vec3(0.10, 0.33, 0.46), river);
  float d = smoothstep(0.1, 0.9, depth);
  vec3 col = mix(shallow, deep, d);
  // Fords and beaches: the bed shows through as sand.
  col = mix(col, sand, (1.0 - smoothstep(0.0, 0.5, depth)) * 0.45);
  col *= 0.78 + 0.34 * diffuse;
  col += vec3(1.0, 0.97, 0.88) * spec * (0.25 + 0.3 * sea);

  // Whitecaps on the sea swells.
  float crest = smoothstep(0.62, 0.8, a.b * 0.6 + b.b * 0.5);
  col = mix(col, vec3(0.92, 0.97, 1.0), crest * sea * 0.18 * smoothstep(0.4, 0.9, depth));

  float alpha = mix(0.52, 0.93, smoothstep(0.05, 0.8, depth));

  // Shore: foam on the water side of the coastline, drifting with the waves,
  // and a dark wet bank on the land side.
  float edge = smoothstep(0.5, 0.75, cover);
  float wobble = a.a * 0.6 + b.a * 0.4;
  float foamBand = (1.0 - edge) * smoothstep(0.38, 0.62, wobble + (1.0 - edge) * 0.55);
  foamBand *= 0.6 + 0.4 * sin(uTime * (1.2 + sea) + wobble * 12.0);
  float foamAmount = clamp(foamBand * (0.7 + 0.5 * sea), 0.0, 1.0);

  float water = smoothstep(0.46, 0.52, cover);
  vec3 bank = vec3(0.17, 0.15, 0.11);
  vec3 colour = mix(bank, col, water);
  float alphaOut = mix(0.38 * smoothstep(0.12, 0.46, cover), alpha, water);
  colour = mix(colour, vec3(0.95, 0.98, 1.0), foamAmount * water);
  alphaOut = max(alphaOut, foamAmount * water * 0.9);

  // Frozen edges (snow climates): ice from the shore inwards.
  float ice = uFrost * (1.0 - smoothstep(0.55, 0.9, cover + wobble * 0.15)) * water;
  colour = mix(colour, vec3(0.86, 0.93, 0.97), ice);
  alphaOut = mix(alphaOut, 0.96, ice);

  gl_FragColor = vec4(colour, alphaOut);
}`;

/** Quads of every water cell and its one cell margin, draped on the ground. */
function surfaceGeometry(
  layers: TerrainLayers,
  ctx: FeatureContext,
): BufferGeometry | null {
  const { width, height } = layers;
  const positions: number[] = [];
  const indices: number[] = [];
  const wet = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    ((layers.water[y * width + x] ?? 0) & WATER_DEPTH_MASK) !== 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (wet(x + dx, y + dy)) {
            near = true;
            break;
          }
        }
      }
      if (!near) continue;
      const base = positions.length / 3;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        positions.push(
          x + dx,
          ctx.elevation.corner(x + dx, y + dy) + WATER_LIFT,
          y + dy,
        );
      }
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  if (indices.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function createWater(
  layers: TerrainLayers,
  ctx: FeatureContext,
): Object3D | null {
  const geometry = surfaceGeometry(layers, ctx);
  if (geometry === null) return null;
  const frost =
    typeof window !== "undefined" &&
    climateFor(new URLSearchParams(window.location.search)) !== null
      ? 1
      : 0;
  const material = new ShaderMaterial({
    uniforms: {
      uField: { value: waterFieldOf(layers) },
      uNormals: { value: waterNormalsTexture() },
      uMapSize: { value: new Vector2(layers.width, layers.height) },
      uTime: { value: 0 },
      uFrost: { value: frost },
      uNormalTile: { value: NORMAL_TILE },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "water";
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  const origin = typeof performance !== "undefined" ? performance.now() : 0;
  mesh.onBeforeRender = () => {
    const time = material.uniforms.uTime;
    if (time) time.value = (performance.now() - origin) / 1000;
  };
  return mesh;
}

registerWaterRenderer(createWater);
