import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { climateFor } from "../../weather";
import type { FeatureContext, FeatureInstance } from "../layers";
import { registerFeatureRenderer } from "../registry";

/** Procedural vegetation (spec 26 §5.3, Phase 6): ten low-poly types built from
 *  cones, cylinders and lumpy icospheres, merged into one geometry per type and
 *  drawn with one InstancedMesh per type (at most ten draw calls for the whole
 *  family). Variants and per-position jitter (spin, size, tint, offset) come
 *  from an integer hash of the instance cell, so the same map always looks the
 *  same. The shared material sways the crowns in the vertex shader and whitens
 *  upward-facing surfaces while snow is on. */

// ---------------------------------------------------------------- shader uniforms

const uniforms = {
  uTime: { value: 0 },
  uSnow: { value: 0 },
};

/** Snow on the branches, 0 (none) to 1 (fully covered). The climate in the page
 *  URL (`?weather=snow`) sets it when a map is built; a later phase can drive
 *  it from the progressive cover of spec 22. */
export function setVegetationSnow(amount: number): void {
  uniforms.uSnow.value = Math.min(1, Math.max(0, amount));
}

const SNOW_WHEN_SNOWING = 0.8;

function snowFromPage(): number {
  if (typeof window === "undefined") return 0;
  try {
    const params = new URLSearchParams(window.location.search);
    return climateFor(params) === null ? 0 : SNOW_WHEN_SNOWING;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------- hashing

/** 32-bit integer mix of a cell and a type (no floats, no hash-order). */
export function cellHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h ^= Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const unit = (hash: number, shift: number): number =>
  ((hash >>> shift) & 0xff) / 255;

// ---------------------------------------------------------------- geometry kit

const TAU = Math.PI * 2;

interface Build {
  readonly parts: BufferGeometry[];
}

/** Moves every vertex by a hash of its position, so shared corners stay shared. */
function lump(geometry: BufferGeometry, amount: number, seed: number): void {
  const pos = geometry.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const qx = Math.round(pos.getX(i) * 1000);
    const qy = Math.round(pos.getY(i) * 1000);
    const qz = Math.round(pos.getZ(i) * 1000);
    const h = cellHash(qx, qy ^ (qz << 7), seed);
    pos.setXYZ(
      i,
      pos.getX(i) + (unit(h, 0) - 0.5) * amount,
      pos.getY(i) + (unit(h, 8) - 0.5) * amount,
      pos.getZ(i) + (unit(h, 16) - 0.5) * amount,
    );
  }
}

/** Adds a flat-shaded, coloured piece. `sway` (0..1) is how much of the wind
 *  motion the piece takes, scaled by height in `finish`. */
function add(
  build: Build,
  source: BufferGeometry,
  colour: Color,
  matrix: Matrix4,
  options: { lump?: number; seed?: number; shade?: number } = {},
): void {
  const geometry = source.index === null ? source : source.toNonIndexed();
  geometry.deleteAttribute("uv");
  if (options.lump !== undefined) {
    lump(geometry, options.lump, options.seed ?? 1);
  }
  geometry.applyMatrix4(matrix);
  geometry.computeVertexNormals();
  const count = geometry.getAttribute("position").count;
  const colours = new Float32Array(count * 3);
  const shade = options.shade ?? 1;
  for (let i = 0; i < count; i++) {
    colours[i * 3] = colour.r * shade;
    colours[i * 3 + 1] = colour.g * shade;
    colours[i * 3 + 2] = colour.b * shade;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  build.parts.push(geometry);
}

const at = (x: number, y: number, z: number): Matrix4 =>
  new Matrix4().makeTranslation(x, y, z);

const place = (
  position: Vector3,
  rotation: [number, number, number] = [0, 0, 0],
  scale: Vector3 = new Vector3(1, 1, 1),
): Matrix4 =>
  new Matrix4().compose(
    position,
    new Quaternion().setFromEuler(
      new Euler(rotation[0], rotation[1], rotation[2]),
    ),
    scale,
  );

const brown = (): Color => new Color("#5a4129");
const lighten = (c: Color, k: number): Color => c.clone().multiplyScalar(k);

/** Cone standing on `y0`. */
function cone(
  build: Build,
  radius: number,
  height: number,
  y0: number,
  colour: Color,
  seed: number,
  sides = 7,
): void {
  add(
    build,
    new ConeGeometry(radius, height, sides, 1),
    colour,
    at(0, y0 + height / 2, 0),
    { lump: radius * 0.18, seed },
  );
}

function trunk(
  build: Build,
  rTop: number,
  rBottom: number,
  height: number,
  colour: Color,
  y0 = 0,
): void {
  add(
    build,
    new CylinderGeometry(rTop, rBottom, height, 6, 1),
    colour,
    at(0, y0 + height / 2, 0),
  );
}

function blob(
  build: Build,
  radius: number,
  position: [number, number, number],
  squash: [number, number, number],
  colour: Color,
  seed: number,
  roughness = 0.2,
): void {
  add(
    build,
    new IcosahedronGeometry(radius, radius >= 0.45 ? 1 : 0),
    colour,
    place(
      new Vector3(...position),
      [0, 0, 0],
      new Vector3(squash[0], squash[1], squash[2]),
    ),
    { lump: radius * roughness, seed },
  );
}

type Builder = (build: Build, base: Color) => { sway: number };

const BUILDERS: Record<string, Builder> = {
  pine(build, base) {
    trunk(build, 0.07, 0.11, 0.55, brown());
    cone(build, 0.66, 1.0, 0.35, lighten(base, 0.82), 11);
    cone(build, 0.5, 0.95, 0.95, lighten(base, 0.95), 12);
    cone(build, 0.34, 0.85, 1.55, lighten(base, 1.1), 13);
    return { sway: 1 };
  },
  fir(build, base) {
    trunk(build, 0.06, 0.1, 0.5, brown());
    const radii = [0.52, 0.46, 0.39, 0.31, 0.22];
    radii.forEach((r, i) => {
      cone(
        build,
        r,
        0.85,
        0.4 + i * 0.52,
        lighten(base, 0.8 + i * 0.07),
        20 + i,
        8,
      );
    });
    return { sway: 0.8 };
  },
  oak(build, base) {
    trunk(build, 0.12, 0.18, 0.85, brown());
    blob(build, 0.62, [0, 1.35, 0], [1.1, 0.85, 1.1], lighten(base, 0.95), 31);
    blob(build, 0.46, [0.42, 1.1, 0.15], [1, 0.85, 1], lighten(base, 0.8), 32);
    blob(
      build,
      0.44,
      [-0.4, 1.12, -0.1],
      [1, 0.85, 1],
      lighten(base, 0.85),
      33,
    );
    blob(build, 0.4, [0.05, 1.7, -0.15], [1, 0.8, 1], lighten(base, 1.15), 34);
    return { sway: 1 };
  },
  birch(build, base) {
    const bark = new Color("#d9d5c9");
    trunk(build, 0.045, 0.07, 1.5, bark);
    for (const y of [0.35, 0.7, 1.05]) {
      add(
        build,
        new CylinderGeometry(0.075, 0.08, 0.05, 6, 1),
        new Color("#35332f"),
        at(0, y, 0),
      );
    }
    blob(build, 0.46, [0, 1.65, 0], [0.9, 1.3, 0.9], lighten(base, 0.95), 41);
    blob(
      build,
      0.34,
      [0.26, 1.35, 0.08],
      [0.9, 1.2, 0.9],
      lighten(base, 0.8),
      42,
    );
    blob(
      build,
      0.32,
      [-0.22, 1.3, -0.08],
      [0.9, 1.2, 0.9],
      lighten(base, 0.88),
      43,
    );
    return { sway: 1.2 };
  },
  poplar(build, base) {
    trunk(build, 0.05, 0.09, 0.7, brown());
    blob(build, 0.34, [0, 1.05, 0], [1, 1.5, 1], lighten(base, 0.82), 51, 0.15);
    blob(build, 0.34, [0, 1.65, 0], [1, 1.6, 1], lighten(base, 0.95), 52, 0.15);
    blob(build, 0.26, [0, 2.3, 0], [1, 1.7, 1], lighten(base, 1.12), 53, 0.15);
    return { sway: 1.1 };
  },
  palm(build, base) {
    const bark = new Color("#8a6d4a");
    const pts: [number, number][] = [0, 1, 2, 3, 4].map((i) => [
      0.022 * i * i,
      0.5 * i,
    ]);
    for (let i = 0; i < 4; i++) {
      const [x0, y0] = pts[i] as [number, number];
      const [x1, y1] = pts[i + 1] as [number, number];
      const length = Math.hypot(x1 - x0, y1 - y0);
      add(
        build,
        new CylinderGeometry(0.06 - i * 0.004, 0.08 - i * 0.004, length, 6, 1),
        i % 2 === 0 ? bark : lighten(bark, 0.85),
        place(new Vector3((x0 + x1) / 2, (y0 + y1) / 2, 0), [
          0,
          0,
          -Math.atan2(x1 - x0, y1 - y0),
        ]),
      );
    }
    const [topX, topY] = pts[4] as [number, number];
    for (let k = 0; k < 8; k++) {
      const frond = new BoxGeometry(0.95, 0.025, 0.24);
      frond.translate(0.47, 0, 0);
      const droop = 0.35 + (k % 2) * 0.35;
      const yaw = (k / 8) * TAU;
      const m = new Matrix4()
        .makeTranslation(topX, topY, 0)
        .multiply(new Matrix4().makeRotationY(yaw))
        .multiply(new Matrix4().makeRotationZ(-droop));
      add(build, frond, lighten(base, k % 2 === 0 ? 1 : 0.8), m);
    }
    for (const [dx, dz] of [
      [0.07, 0.05],
      [-0.06, 0.07],
      [0, -0.08],
    ] as const) {
      add(
        build,
        new IcosahedronGeometry(0.075, 0),
        new Color("#4a3320"),
        at(topX + dx, topY - 0.08, dz),
      );
    }
    return { sway: 1.3 };
  },
  "dead-tree"(build, base) {
    const wood = lighten(base, 1);
    add(
      build,
      new CylinderGeometry(0.05, 0.14, 1.7, 6, 1),
      wood,
      place(new Vector3(0, 0.85, 0), [0.04, 0, -0.05]),
    );
    const branches: [number, number, number, number][] = [
      [0.75, 0.2, 0.9, 0.55],
      [1.0, 2.6, -0.9, 0.5],
      [1.25, 4.2, 1.0, 0.45],
      [1.45, 5.6, -0.8, 0.35],
      [0.55, 3.6, 1.1, 0.4],
    ];
    for (const [y, yaw, lean, length] of branches) {
      const piece = new CylinderGeometry(0.012, 0.04, length, 5, 1);
      piece.translate(0, length / 2, 0);
      const m = new Matrix4()
        .makeTranslation(0, y, 0)
        .multiply(new Matrix4().makeRotationY(yaw))
        .multiply(new Matrix4().makeRotationZ(-lean));
      add(build, piece, lighten(wood, 0.85), m);
    }
    return { sway: 0.35 };
  },
  "burnt-stump"(build, base) {
    add(
      build,
      new CylinderGeometry(0.2, 0.3, 0.45, 7, 1),
      base,
      at(0, 0.225, 0),
      { lump: 0.06, seed: 61 },
    );
    add(
      build,
      new BoxGeometry(0.1, 0.35, 0.08),
      lighten(base, 0.8),
      place(new Vector3(0.1, 0.55, 0), [0, 0.4, 0.18]),
    );
    add(
      build,
      new BoxGeometry(0.08, 0.22, 0.08),
      lighten(base, 0.9),
      place(new Vector3(-0.1, 0.5, 0.04), [0.2, 0, -0.25]),
    );
    add(
      build,
      new IcosahedronGeometry(0.5, 1),
      new Color("#46423d"),
      place(new Vector3(0, 0, 0), [0, 0, 0], new Vector3(1, 0.1, 1)),
      { lump: 0.08, seed: 62 },
    );
    return { sway: 0 };
  },
  bush(build, base) {
    blob(
      build,
      0.34,
      [0, 0.3, 0],
      [1.1, 0.9, 1.1],
      lighten(base, 0.95),
      71,
      0.25,
    );
    blob(
      build,
      0.27,
      [0.3, 0.22, 0.12],
      [1, 0.85, 1],
      lighten(base, 0.8),
      72,
      0.25,
    );
    blob(
      build,
      0.25,
      [-0.24, 0.22, 0.2],
      [1, 0.85, 1],
      lighten(base, 1.1),
      73,
      0.25,
    );
    blob(
      build,
      0.2,
      [0.02, 0.2, -0.28],
      [1, 0.8, 1],
      lighten(base, 0.88),
      74,
      0.25,
    );
    return { sway: 0.5 };
  },
  hedge(build, base) {
    add(
      build,
      new BoxGeometry(1.85, 0.5, 0.55),
      lighten(base, 0.7),
      at(0, 0.25, 0),
    );
    [-0.68, -0.23, 0.23, 0.68].forEach((x, i) => {
      blob(
        build,
        0.4,
        [x, 0.5, 0],
        [1.1, 0.9, 0.85],
        lighten(base, 0.9 + (i % 2) * 0.18),
        81 + i,
        0.18,
      );
    });
    return { sway: 0.35 };
  },
};

// ---------------------------------------------------------------- merged models

interface Model {
  readonly geometry: BufferGeometry;
  /** Natural height before scaling to `render.height`. */
  readonly height: number;
}

/** Merges the pieces, bakes the sway weight (0 at the ground, 1 at the top, times
 *  the model's own wind factor) and finds the natural height. */
function finish(build: Build, wind: number): Model {
  const merged = mergeGeometries(build.parts, false);
  if (merged === null) throw new Error("vegetation: could not merge a model");
  merged.computeBoundingBox();
  const height = Math.max(0.01, merged.boundingBox?.max.y ?? 1);
  const pos = merged.getAttribute("position");
  const sway = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / height));
    sway[i] = t * t * wind;
  }
  merged.setAttribute("aSway", new Float32BufferAttribute(sway, 1));
  for (const part of build.parts) part.dispose();
  return { geometry: merged, height };
}

function modelFor(modelId: string, colour: string): Model {
  const builder = BUILDERS[modelId] ?? BUILDERS.oak;
  const build: Build = { parts: [] };
  const { sway } = (builder as Builder)(build, new Color(colour));
  return finish(build, sway);
}

// ---------------------------------------------------------------- material

function vegetationMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.95,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSnow = uniforms.uSnow;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uTime;
uniform float uSnow;
attribute float aSway;
varying float vSnow;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec2 wp = instanceMatrix[3].xz;
#else
  vec2 wp = vec2(0.0);
#endif
  float ph = wp.x * 0.7 + wp.y * 0.45;
  float gust = sin(uTime * 1.3 + ph) + 0.5 * sin(uTime * 2.9 + ph * 1.7);
  transformed.x += gust * 0.05 * aSway;
  transformed.z += cos(uTime * 1.1 + ph) * 0.035 * aSway;
  vSnow = uSnow * smoothstep(0.1, 0.55, objectNormal.y);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vSnow;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), vSnow * 0.88);`,
      );
  };
  material.customProgramCacheKey = () => "vegetation-sway-snow";
  return material;
}

// ---------------------------------------------------------------- renderer

const numberOf = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const stringOf = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

/** Variant shapes: width and height multipliers, and a colour multiplier. */
const VARIANTS: readonly {
  readonly width: number;
  readonly height: number;
  readonly tint: readonly [number, number, number];
}[] = [
  { width: 1, height: 1, tint: [1, 1, 1] },
  { width: 0.84, height: 1.18, tint: [1.08, 1.04, 0.88] },
  { width: 1.16, height: 0.88, tint: [0.9, 1, 1.08] },
];

const KEEP_WIDTH = new Set(["hedge"]);

function groundUnder(ctx: FeatureContext, instance: FeatureInstance): number {
  const cx = instance.x + instance.width / 2;
  const cy = instance.y + instance.height / 2;
  if (instance.width * instance.height <= 1) return ctx.elevation.at(cx, cy);
  // A hedge spans cells: sit on the lowest ground under it.
  let low = Number.POSITIVE_INFINITY;
  for (let y = instance.y; y <= instance.y + instance.height; y++) {
    for (let x = instance.x; x <= instance.x + instance.width; x++) {
      low = Math.min(low, ctx.elevation.corner(x, y));
    }
  }
  return low;
}

export function vegetationRenderer(
  instances: readonly FeatureInstance[],
  ctx: FeatureContext,
): Object3D {
  uniforms.uSnow.value = Math.max(uniforms.uSnow.value, snowFromPage());
  const material = vegetationMaterial();
  const byType = new Map<number, FeatureInstance[]>();
  for (const instance of instances) {
    const list = byType.get(instance.typeIndex);
    if (list === undefined) byType.set(instance.typeIndex, [instance]);
    else list.push(instance);
  }
  const root = new Group();
  root.name = "features-vegetation";
  const m = new Matrix4();
  const q = new Quaternion();
  const colour = new Color();
  const yAxis = new Vector3(0, 1, 0);
  for (const [, list] of [...byType.entries()].sort((a, b) => a[0] - b[0])) {
    const type = (list[0] as FeatureInstance).type;
    const modelId = stringOf(type.render.model, type.id);
    const model = modelFor(modelId, stringOf(type.render.color, "#4f8a3a"));
    const targetHeight = numberOf(type.render.height, model.height);
    const baseScale = targetHeight / model.height;
    const keepWidth = KEEP_WIDTH.has(modelId);
    const mesh = new InstancedMesh(model.geometry, material, list.length);
    list.forEach((instance, index) => {
      const hash = cellHash(instance.x, instance.y, instance.typeIndex + 1);
      const variantCount = Math.max(
        1,
        Math.min(VARIANTS.length, type.variants),
      );
      const variant = VARIANTS[instance.variant % variantCount] ?? VARIANTS[0];
      const v = variant as (typeof VARIANTS)[number];
      const size = 0.9 + unit(hash, 8) * 0.22;
      const horizontal = keepWidth
        ? 1
        : baseScale * v.width * size * (0.94 + unit(hash, 16) * 0.12);
      const vertical = baseScale * v.height * size;
      const yaw = keepWidth
        ? (instance.rot * Math.PI) / 2 + (unit(hash, 0) - 0.5) * 0.06
        : unit(hash, 0) * TAU;
      const jitter = instance.width * instance.height <= 1 ? 0.3 : 0;
      const px =
        instance.x + instance.width / 2 + (unit(hash, 24) - 0.5) * jitter;
      const pz =
        instance.y + instance.height / 2 + (unit(hash, 4) - 0.5) * jitter;
      const py = groundUnder(ctx, instance) - 0.03;
      q.setFromAxisAngle(yAxis, yaw);
      m.compose(
        new Vector3(px, py, pz),
        q,
        new Vector3(horizontal, vertical, keepWidth ? vertical : horizontal),
      );
      mesh.setMatrixAt(index, m);
      const bright = 0.88 + unit(hash, 12) * 0.24;
      colour.setRGB(v.tint[0] * bright, v.tint[1] * bright, v.tint[2] * bright);
      mesh.setColorAt(index, colour);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = type.blocks !== "none";
    mesh.receiveShadow = false;
    mesh.name = `vegetation-${type.id}`;
    mesh.onBeforeRender = () => {
      uniforms.uTime.value = performance.now() / 1000;
    };
    root.add(mesh);
  }
  return root;
}

registerFeatureRenderer("vegetation", vegetationRenderer);
