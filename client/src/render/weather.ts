import {
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Mesh,
  Points,
  RedFormat,
  ShaderMaterial,
  Uint32BufferAttribute,
  UnsignedByteType,
  Vector2,
} from "three";
import weatherData from "../../../data/weather/weather.json";
import { type Elevation, flatElevation } from "./elevation";
import { createRng, valueNoise } from "./terrainTexture";

/** One climate of `data/weather/weather.json` (spec 22 §3). */
export interface Climate {
  readonly flakes: number;
  readonly fallSpeed: number;
  readonly windX: number;
  readonly windZ: number;
  readonly swayAmplitude: number;
  readonly boxTiles: number;
  readonly boxHeight: number;
  readonly flakeSize: number;
  readonly flakeAlpha: number;
  readonly flakeColor: string;
  readonly coverColor: string;
  readonly coverSeconds: number;
  readonly maxCover: number;
  readonly coverOpacity: number;
}

const CLIMATES = weatherData.climates as Record<string, Climate>;

/** Ground cover sits under the fog plane (y 0.02) and above the grass. */
const COVER_Y = 0.012;
const COVER_NOISE_PERIOD = 48;
const COVER_EDGE = 0.14;
/** Cover mesh samples per tile side: enough to follow crater bowls and rims. */
const COVER_SUB = 2;
/** Thresholds stay below this so the cover is nearly complete at the end. */
const THRESHOLD_CEILING = 0.85;
/** Sink (tiles) from which a crater floor shows fresh dirt, and fully. */
const BARE_FROM = 0.05;
const BARE_FULL = 0.13;

/** Share of fresh dirt shown where the ground sank `sink` tiles below its
 *  base (a recent crater floor); snow settles on the rest of the bowl. */
export function bareDirt(sink: number): number {
  const t = Math.min(
    1,
    Math.max(0, (sink - BARE_FROM) / (BARE_FULL - BARE_FROM)),
  );
  return t * t * (3 - 2 * t);
}

/** The relief the cover follows (spec 24): height above the map elevation
 *  plus change notifications. */
export interface CoverRelief {
  heightAt(x: number, z: number): number;
  onChange(
    listener: (x0: number, z0: number, x1: number, z1: number) => void,
  ): void;
}

/** Climate named by the `?weather` URL parameter (`none` or a climate name);
 *  null means clear weather, the default on every map (spec 22 §2). */
export function climateFor(params: URLSearchParams): Climate | null {
  const name = params.get("weather");
  if (name === null || name === "none") return null;
  return CLIMATES[name] ?? null;
}

/** `?snow=<n>` density multiplier, clamped to [0, 2]; 1 when absent or invalid. */
export function densityFrom(params: URLSearchParams): number {
  const raw = params.get("snow");
  if (raw === null) return 1;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 1;
}

/** `?cover=<0..1>` start progress as seconds of snowfall already elapsed. */
export function startSecondsFrom(
  params: URLSearchParams,
  climate: Climate,
): number {
  const value = Number(params.get("cover") ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value)) * climate.coverSeconds;
}

/** How much of the ground is covered after `elapsedSeconds`, in [0, maxCover]. */
export function coverAfter(elapsedSeconds: number, climate: Climate): number {
  const progress = Math.min(
    1,
    Math.max(0, elapsedSeconds / climate.coverSeconds),
  );
  return progress * climate.maxCover;
}

/** Per-cell cover thresholds (0 covers first, 1 never), one byte per cell. */
export function coverThresholds(
  width: number,
  height: number,
  rockCells: Uint8Array,
  seed: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      const broad = valueNoise(x, y, COVER_NOISE_PERIOD, seed);
      const fine = valueNoise(x, y, COVER_NOISE_PERIOD / 4, seed + 7);
      const value =
        rockCells[cell] === 1
          ? 1
          : (broad * 0.7 + fine * 0.3) * THRESHOLD_CEILING;
      out[cell] = Math.round(Math.min(1, Math.max(0, value)) * 255);
    }
  }
  return out;
}

/** Flake seeds: x, y, z in [0, 1) and a speed jitter; seeded, client only. */
export function flakeSeeds(count: number, seed: number): Float32Array {
  const rng = createRng(seed);
  const out = new Float32Array(count * 4);
  for (let i = 0; i < out.length; i++) out[i] = rng();
  return out;
}

const FLAKE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uBox;
uniform float uHeight;
uniform float uFall;
uniform vec2 uWind;
uniform float uSway;
uniform float uSize;
uniform vec2 uCenter;
attribute vec4 aSeed;
varying float vFade;
varying float vSoft;
void main() {
  // Big flakes are rarer, nearer and slower; small ones are many and quick.
  float big = aSeed.w * aSeed.w;
  float speed = uFall * (1.15 - 0.55 * big);
  float y = mod(aSeed.y * uHeight - speed * uTime, uHeight);
  vec2 anchor = aSeed.xz * uBox + uWind * uTime
    + vec2(sin(uTime * 0.5 + aSeed.w * 40.0), cos(uTime * 0.4 + aSeed.x * 40.0)) * uSway;
  vec2 rel = mod(anchor - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 world = vec3(uCenter.x + rel.x, y, uCenter.y + rel.y);
  vFade = smoothstep(0.0, 3.0, y) * smoothstep(uHeight, uHeight - 4.0, y)
    * (1.0 - smoothstep(0.38 * uBox, 0.5 * uBox, length(rel)))
    * (0.35 + 0.65 * (0.3 + 0.7 * big));
  vSoft = 0.4 + 0.6 * big;
  gl_PointSize = uSize * (0.45 + 2.1 * big);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const FLAKE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vFade;
varying float vSoft;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * (2.0 + 3.0 * (1.0 - vSoft))) * (1.0 - smoothstep(0.8, 1.0, d))
    * uAlpha * vFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const COVER_VERTEX = /* glsl */ `
attribute float aHold;
attribute float aBare;
varying vec2 vUv;
varying float vHold;
varying float vBare;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vHold = aHold;
  vBare = aBare;
  vWorld = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const COVER_FRAGMENT = /* glsl */ `
uniform sampler2D uMask;
uniform float uCover;
uniform float uEdge;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
varying float vHold;
varying float vBare;
varying vec3 vWorld;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 7.0) + 0.2 * vnoise(p * 4.3 + 19.0);
}
void main() {
  vec2 xz = vWorld.xz;
  // Soft drifts: the per-cell threshold is bent by broad noise.
  float drift = fbm(xz * 0.35);
  float threshold = texture2D(uMask, vUv).r + (drift - 0.5) * 0.16;
  float amount = smoothstep(threshold, threshold + uEdge, uCover);
  float a = amount * uOpacity * vHold;
  if (a < 0.01) discard;

  // Own snow surface: blue-tinted hollows, bright grain, never the dirt below.
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (normal.y < 0.0) normal = -normal;
  vec3 sun = normalize(vec3(-0.45, 0.8, -0.35));
  float lit = dot(normal, sun);
  float tilt = 1.0 - normal.y;
  vec3 shade = vec3(0.62, 0.72, 0.88);
  float hollow = smoothstep(0.35, 0.8, fbm(xz * 0.9 + 3.0));
  float grain = vnoise(xz * 9.0) * 0.06 + vnoise(xz * 2.6) * 0.05;
  vec3 snow = mix(uColor, shade, 0.22 * (1.0 - hollow) + 0.5 * clamp(-lit * 2.0 + tilt * 3.0, 0.0, 1.0));
  snow = snow * (0.96 + grain) + vec3(0.05) * smoothstep(0.08, 0.3, tilt) * max(lit, 0.0);
  // Fresh crater floors show dark dirt, softened as the snow settles.
  vec3 dirt = vec3(0.13, 0.105, 0.09);
  float bare = vBare * (1.0 - 0.45 * amount);
  gl_FragColor = vec4(mix(snow, dirt, bare), a);
}`;

/** Slopes (tiles of rise per tile) where snow starts to slide off, and where
 *  none holds. */
const SNOW_SLIDE_LOW = 0.6;
const SNOW_SLIDE_HIGH = 1.1;

/** Share of the snow cover a corner of `slope` keeps: 1 on flat ground. */
export function snowHold(slope: number): number {
  const t = Math.min(
    1,
    Math.max(0, (slope - SNOW_SLIDE_LOW) / (SNOW_SLIDE_HIGH - SNOW_SLIDE_LOW)),
  );
  return 1 - t * t * (3 - 2 * t);
}

/** The cover grid (`COVER_SUB` samples per tile side) lifted over the ground
 *  and its crater relief. `attach` subscribes to relief changes so the snow
 *  keeps following bowls and rims; `aBare` marks fresh crater floors. */
function createCoverMesh(
  elevation: Elevation,
  relief: CoverRelief | null,
): { geometry: BufferGeometry; attach(): void } {
  const { width, height } = elevation;
  const nx = width * COVER_SUB + 1;
  const nz = height * COVER_SUB + 1;
  const base = (x: number, z: number): number => {
    const x0 = Math.min(width - 1, Math.floor(x));
    const z0 = Math.min(height - 1, Math.floor(z));
    const tx = x - x0;
    const tz = z - z0;
    const top =
      elevation.corner(x0, z0) * (1 - tx) + elevation.corner(x0 + 1, z0) * tx;
    const bottom =
      elevation.corner(x0, z0 + 1) * (1 - tx) +
      elevation.corner(x0 + 1, z0 + 1) * tx;
    return top * (1 - tz) + bottom * tz;
  };
  const positions = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  const holds = new Float32Array(nx * nz);
  const bares = new Float32Array(nx * nz);
  const place = (ix: number, iz: number): void => {
    const x = ix / COVER_SUB;
    const z = iz / COVER_SUB;
    const ground = base(x, z);
    const top = relief === null ? ground : relief.heightAt(x, z);
    const vertex = iz * nx + ix;
    positions.set([x, top + COVER_Y, z], vertex * 3);
    bares[vertex] = bareDirt(ground - top);
  };
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      place(ix, iz);
      const vertex = iz * nx + ix;
      uvs.set([ix / COVER_SUB / width, iz / COVER_SUB / height], vertex * 2);
      holds[vertex] = snowHold(
        elevation.slope(
          Math.min(width, Math.round(ix / COVER_SUB)),
          Math.min(height, Math.round(iz / COVER_SUB)),
        ),
      );
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix;
      indices.set(
        [a, a + nx + 1, a + 1, a, a + nx, a + nx + 1],
        (iz * (nx - 1) + ix) * 6,
      );
    }
  }
  const geometry = new BufferGeometry();
  const position = new Float32BufferAttribute(positions, 3);
  const bare = new Float32BufferAttribute(bares, 1);
  geometry.setAttribute("position", position);
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("aHold", new Float32BufferAttribute(holds, 1));
  geometry.setAttribute("aBare", bare);
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  return {
    geometry,
    attach() {
      relief?.onChange((x0, z0, x1, z1) => {
        const ix0 = Math.max(0, Math.floor(x0 * COVER_SUB) - 1);
        const iz0 = Math.max(0, Math.floor(z0 * COVER_SUB) - 1);
        const ix1 = Math.min(nx - 1, Math.ceil(x1 * COVER_SUB) + 1);
        const iz1 = Math.min(nz - 1, Math.ceil(z1 * COVER_SUB) + 1);
        for (let iz = iz0; iz <= iz1; iz++) {
          for (let ix = ix0; ix <= ix1; ix++) place(ix, iz);
        }
        position.needsUpdate = true;
        bare.needsUpdate = true;
      });
    },
  };
}

/** Falling snow and the white ground cover of one match (spec 22). Visual
 *  only: nothing here reaches the simulation. */
export interface Weather {
  readonly group: Group;
  /** Advances the clock by `dtSeconds` and centres the snowfall on `focus`. */
  update(dtSeconds: number, focus: { x: number; y: number }): void;
  /** Shows or hides the whole effect without resetting the cover. */
  setEnabled(enabled: boolean): void;
  /** Current ground cover in [0, maxCover]. */
  cover(): number;
}

/** Builds the snowfall (`density` scales the flake count) and the cover layer
 *  for a `width` × `height` map. */
export function createWeather(
  climate: Climate,
  width: number,
  height: number,
  rockCells: Uint8Array,
  seed: number,
  density = 1,
  startSeconds = 0,
  elevation: Elevation = flatElevation(width, height),
  relief: CoverRelief | null = null,
): Weather {
  const group = new Group();
  group.name = "weather";

  const count = Math.round(climate.flakes * density);
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array(count * 3), 3),
  );
  geometry.setAttribute(
    "aSeed",
    new Float32BufferAttribute(flakeSeeds(count, seed ^ 0x5ee0), 4),
  );
  const flakeMaterial = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBox: { value: climate.boxTiles },
      uHeight: { value: climate.boxHeight },
      uFall: { value: climate.fallSpeed },
      uWind: { value: new Vector2(climate.windX, climate.windZ) },
      uSway: { value: climate.swayAmplitude },
      uSize: { value: climate.flakeSize },
      uCenter: { value: new Vector2(width / 2, height / 2) },
      uColor: { value: new Color(climate.flakeColor) },
      uAlpha: { value: climate.flakeAlpha },
    },
    vertexShader: FLAKE_VERTEX,
    fragmentShader: FLAKE_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const flakes = new Points(geometry, flakeMaterial);
  flakes.frustumCulled = false;
  flakes.renderOrder = 10;
  flakes.name = "snowfall";

  const mask = new DataTexture(
    coverThresholds(width, height, rockCells, seed),
    width,
    height,
    RedFormat,
    UnsignedByteType,
  );
  mask.magFilter = LinearFilter;
  mask.minFilter = LinearFilter;
  mask.needsUpdate = true;
  // The cover drapes over hills and follows crater relief; snow does not
  // hold on cliffs (spec 30 §4, spec 22 §4).
  const cover3d = createCoverMesh(elevation, relief);
  const coverGeometry = cover3d.geometry;
  const coverMaterial = new ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uCover: { value: 0 },
      uEdge: { value: COVER_EDGE },
      uOpacity: { value: climate.coverOpacity },
      uColor: { value: new Color(climate.coverColor) },
    },
    vertexShader: COVER_VERTEX,
    fragmentShader: COVER_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const cover = new Mesh(coverGeometry, coverMaterial);
  cover3d.attach();

  cover.renderOrder = -1;
  cover.name = "snow-cover";

  group.add(cover, flakes);

  const timeUniform = { value: 0 };
  const centerUniform = { value: new Vector2(width / 2, height / 2) };
  const coverUniform = { value: 0 };
  flakeMaterial.uniforms.uTime = timeUniform;
  flakeMaterial.uniforms.uCenter = centerUniform;
  coverMaterial.uniforms.uCover = coverUniform;
  let elapsed = startSeconds;
  return {
    group,
    update(dtSeconds, focus) {
      elapsed += dtSeconds;
      timeUniform.value = elapsed;
      centerUniform.value.set(focus.x, focus.y);
      coverUniform.value = coverAfter(elapsed, climate);
    },
    setEnabled(enabled) {
      group.visible = enabled;
    },
    cover: () => coverAfter(elapsed, climate),
  };
}
