import {
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  Points,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
} from "three";
import weatherData from "../../../data/weather/weather.json";
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
const MAP_CLIMATE = weatherData.mapClimate as Record<string, string>;

/** Ground cover sits under the fog plane (y 0.02) and above the grass. */
const COVER_Y = 0.012;
const COVER_NOISE_PERIOD = 48;
const COVER_EDGE = 0.14;

/** Climate of `mapId`, overridden by the `?weather` URL parameter
 *  (`none` or a climate name); null means clear weather (spec 22 §2). */
export function climateFor(
  mapId: string,
  params: URLSearchParams,
): Climate | null {
  const override = params.get("weather");
  const name = override ?? MAP_CLIMATE[mapId];
  if (name === undefined || name === "none") return null;
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
      const value = rockCells[cell] === 1 ? 1 : broad * 0.7 + fine * 0.3;
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
void main() {
  float speed = uFall * (0.7 + 0.6 * aSeed.w);
  float y = mod(aSeed.y * uHeight - speed * uTime, uHeight);
  vec2 anchor = aSeed.xz * uBox + uWind * uTime
    + vec2(sin(uTime * 0.9 + aSeed.w * 40.0), cos(uTime * 0.7 + aSeed.x * 40.0)) * uSway;
  vec2 rel = mod(anchor - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 world = vec3(uCenter.x + rel.x, y, uCenter.y + rel.y);
  vFade = smoothstep(0.0, 3.0, y) * smoothstep(uHeight, uHeight - 4.0, y)
    * (1.0 - smoothstep(0.38 * uBox, 0.5 * uBox, length(rel)));
  gl_PointSize = uSize * (0.6 + 0.8 * aSeed.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const FLAKE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.4, 1.0, d)) * uAlpha * vFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const COVER_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const COVER_FRAGMENT = /* glsl */ `
uniform sampler2D uMask;
uniform float uCover;
uniform float uEdge;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float threshold = texture2D(uMask, vUv).r;
  float a = smoothstep(threshold, threshold + uEdge, uCover) * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

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
  const coverGeometry = new PlaneGeometry(width, height);
  coverGeometry.rotateX(-Math.PI / 2);
  const uv = coverGeometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
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
  cover.position.set(width / 2, COVER_Y, height / 2);
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
