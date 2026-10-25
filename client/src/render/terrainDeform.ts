import {
  BufferAttribute,
  BufferGeometry,
  type Group,
  Mesh,
  Uint32BufferAttribute,
} from "three";
import { type Elevation, flatElevation, SHADING_RELIEF } from "./elevation";

/** Visual-only ground relief (specs 24, 27). The simulation never reads it:
 *  the heights below only move the grass and dirt vertices and their normals.
 *
 *  Two height fields add up on top of whatever base height the ground mesh
 *  was built with:
 *  - `press`, one value per tile corner: the slow sinking under vehicles.
 *  - `crater`, `SUB` samples per tile side: blast craters. A tile a crater
 *    touches is "refined": its coarse quad collapses to nothing and a finer
 *    patch with the same material, UVs and dirt opacity is drawn instead, so
 *    craters are smooth bowls with a raised rim instead of one sunken vertex.
 *    Crater samples are zero on the outline of the refined area, so the
 *    patches meet the coarse tiles without seams. */

/** Seconds a crater takes to reach its full depth. */
export const CRATER_RISE_MS = 350;
/** Deepest total sink of any point, in tiles. */
export const MAX_SINK = 0.5;
/** Highest a crater rim can pile up, in tiles. */
export const MAX_RISE = 0.2;
/** Deepest sink a vehicle's weight alone digs on fully soft ground, in tiles. */
export const MAX_VEHICLE_SINK = 0.07;
/** Fine crater samples per tile side. */
export const SUB = 4;
/** Default rim height as a share of the crater depth. */
export const RIM_RATIO = 0.3;
/** Tiles of sink per tile driven on fully soft ground by a weight-1 vehicle. */
const SINK_PER_TILE = 0.05;
/** Tiles of radius of the vehicle imprint. */
const VEHICLE_RADIUS = 0.8;
/** Under this many tiles of movement per frame a vehicle counts as parked. */
const MIN_STEP = 0.004;
/** Vehicle sinking is flushed to the GPU at most this often, in ms. */
const SLOW_FLUSH_MS = 200;
/** Crater jobs kept at once; the oldest finishes instantly past this. */
const MAX_JOBS = 64;

/** Crater profile, in units of the crater radius: the rim crest sits at
 *  `RIM_AT`, has a width of `RIM_WIDTH` and fades out by `OUTER`. */
const RIM_AT = 0.92;
const RIM_WIDTH = 0.24;
const OUTER = 1.6;
/** Outline wobble of a crater (share of its radius) so no two are circles. */
const WOBBLE = [0.06, 0.04, 0.03] as const;
const WOBBLE_LOBES = [2, 3, 5] as const;

/** Damp, turned-up soil is darker: brightness lost at `DARKEN_DEPTH` of sink. */
const DARKEN = 0.45;
const DARKEN_DEPTH = 0.3;
/** Crater soil (bowl and rim) shows the dirt texture from this much change. */
const SOIL_FROM = 0.006;
const SOIL_FULL = 0.05;
const SOIL_ALPHA = 0.95;
/** Fresh ejecta on the rim is a little darker than the ground. */
const RIM_DARKEN = 0.1;
/** Brightness change per unit of crater curvature (1/tile), and its limits. */
const CURVATURE_SHADE = 0.12;
const CURVE_DARK = 0.3;
const CURVE_LIGHT = 0.25;
/** Crater floors burn black: brightness lost at `CRATER_SOOT_DEPTH` of bowl,
 *  so the inside reads black instead of grey (owner request 2026-10-25). */
const CRATER_SOOT = 0.7;
const CRATER_SOOT_DEPTH = 0.08;

const VERTICES_PER_TILE = 4;
/** Grid offset of the four corners of a tile, in `groundGeometry` order. */
const CORNER_DX = [0, 1, 1, 0] as const;
const CORNER_DZ = [0, 0, 1, 1] as const;
/** Vertices and indices of one refined tile patch. */
const PATCH_SIDE = SUB + 1;
const PATCH_VERTICES = PATCH_SIDE * PATCH_SIDE;
const PATCH_INDICES = SUB * SUB * 6;
/** Patch slots allocated first; the pool doubles when it fills. */
const FIRST_PATCHES = 64;
/** A collapsed coarse tile hides this far under its own corner. */
const HIDDEN_DROP = 4;

/** An entity as the deformer needs it: where it is and what weighs on the ground. */
export interface PressSource {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** 0 for nothing (infantry, buildings), 1 for tracks, ~0.5 for wheels. */
  readonly weight: number;
}

export interface DeformStats {
  /** Flushes that touched the geometry. */
  readonly flushes: number;
  /** Total ms spent in those flushes. */
  readonly flushMs: number;
  /** Vertices rewritten in total. */
  readonly vertices: number;
  /** Tiles drawn as fine crater patches. */
  readonly refined: number;
}

/** Called after the ground changed inside the tile rectangle. */
export type ReliefListener = (
  x0: number,
  z0: number,
  x1: number,
  z1: number,
) => void;

export interface TerrainDeformer {
  /** Schedules a crater at world tile (x, z); it sinks `depth` tiles over
   *  `CRATER_RISE_MS` starting at `startMs`, with a rim `rim` x `depth` high.
   *  Returns false when the crater cannot be drawn (no room for patches). */
  crater(
    x: number,
    z: number,
    radius: number,
    depth: number,
    startMs: number,
    rim?: number,
  ): boolean;
  /** Sinks the ground under moving weights, scaled by the softness there. */
  press(sources: readonly PressSource[], nowMs: number): void;
  /** Per-corner softness in 0..1 over a (width+1) x (height+1) grid, row
   *  major; null restores the default (the dirt patches). Snow layers use this. */
  setSoftness(softness: Float32Array<ArrayBuffer> | null): void;
  /** Surface height at a world position: the map elevation (spec 30) plus
   *  the relief on top of it (negative where it sank, positive on crater
   *  rims). */
  heightAt(x: number, z: number): number;
  /** Applies due craters and uploads the changed vertices. */
  update(nowMs: number): void;
  /** Tells `listener` where the ground changed after every upload. */
  onChange(listener: ReliefListener): void;
  stats(): DeformStats;
}

interface Job {
  x: number;
  z: number;
  radius: number;
  depth: number;
  rim: number;
  phases: readonly [number, number, number];
  startMs: number;
  applied: number;
}

function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  return ease((value - edge0) / (edge1 - edge0));
}

/** Radial falloff: 1 at the centre, 0 at `radius`, soft edge. */
function falloff(distance: number, radius: number): number {
  const t = distance / radius;
  if (t >= 1) return 0;
  const u = 1 - t * t;
  return u * u;
}

/** Crater height at `t` radii from the centre for unit depth: a round bowl
 *  (smooth at the bottom and where it meets the rim) plus a raised rim that
 *  falls off gently outside, like the ejecta of a real shell hole. */
export function craterProfile(t: number, rim: number): number {
  if (t >= OUTER) return 0;
  const bowl = t < 1 ? (1 - t * t) ** 2 : 0;
  const crest = Math.exp(-(((t - RIM_AT) / RIM_WIDTH) ** 2));
  const fade = t > 1.2 ? smoothstep(OUTER, 1.2, t) : 1;
  return -bowl + rim * crest * fade;
}

/** Cosmetic only: keeps crater outlines varied and the same every run. */
function createWobbleRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** The pooled fine patches drawn over one coarse ground mesh. */
interface PatchLayer {
  readonly source: Mesh;
  readonly mesh: Mesh;
  readonly colorSize: number;
  capacity: number;
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  uvs: Float32Array<ArrayBuffer>;
  colors: Float32Array<ArrayBuffer>;
  /** Dirt opacity of the base ground per patch vertex. */
  baseAlpha: Float32Array<ArrayBuffer>;
  /** Rock-face mix and its UVs, when the source mesh carries them (spec 30). */
  readonly withCliff: boolean;
  cliffUvs: Float32Array<ArrayBuffer>;
  cliffs: Float32Array<ArrayBuffer>;
}

function patchGeometry(layer: PatchLayer): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(layer.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(layer.normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(layer.uvs, 2));
  geometry.setAttribute(
    "color",
    new BufferAttribute(layer.colors, layer.colorSize),
  );
  if (layer.withCliff) {
    geometry.setAttribute("aCliffUv", new BufferAttribute(layer.cliffUvs, 2));
    geometry.setAttribute("aCliff", new BufferAttribute(layer.cliffs, 1));
  }
  const indices = new Uint32Array(layer.capacity * PATCH_INDICES);
  for (let slot = 0; slot < layer.capacity; slot++) {
    let offset = slot * PATCH_INDICES;
    for (let row = 0; row < SUB; row++) {
      for (let col = 0; col < SUB; col++) {
        const a = slot * PATCH_VERTICES + row * PATCH_SIDE + col;
        const b = a + 1;
        const c = a + PATCH_SIDE + 1;
        const d = a + PATCH_SIDE;
        // Same winding as the coarse tiles (terrain.ts).
        indices.set([a, c, b, a, d, c], offset);
        offset += 6;
      }
    }
  }
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  return geometry;
}

/** Makes the grass and dirt meshes of `terrain` deformable. `defaultSoftness`
 *  gives the softness of a grid corner when no mask was set. */
export function attachTerrainDeformer(
  terrain: Group,
  width: number,
  height: number,
  rockCells: Uint8Array,
  defaultSoftness: (cx: number, cz: number) => number,
  elevation: Elevation = flatElevation(width, height),
): TerrainDeformer {
  const stride = width + 1;
  const press = new Float32Array(stride * (height + 1));
  const defaults = new Float32Array(press.length);
  for (let z = 0; z <= height; z++) {
    for (let x = 0; x <= width; x++) {
      defaults[z * stride + x] = defaultSoftness(x, z);
    }
  }
  let softness: Float32Array<ArrayBuffer> = defaults;

  // Tile -> slot, in the order `groundGeometry` laid the passable tiles out.
  const slotOf = new Int32Array(width * height).fill(-1);
  let slots = 0;
  for (let tile = 0; tile < width * height; tile++) {
    if ((rockCells[tile] ?? 0) === 0) slotOf[tile] = slots++;
  }
  const rockAt = (tx: number, tz: number): boolean =>
    tx < 0 ||
    tz < 0 ||
    tx >= width ||
    tz >= height ||
    (slotOf[tz * width + tx] ?? -1) < 0;

  const meshes: Mesh[] = [];
  for (const name of ["grass", "dirt"]) {
    const mesh = terrain.getObjectByName(name);
    if (mesh instanceof Mesh) meshes.push(mesh);
  }

  // Base height of every corner: the map elevation (spec 30) the ground mesh
  // was built with. The relief adds to it, so craters dig on top of hills.
  const base = new Float32Array(press.length);
  for (let cz = 0; cz <= height; cz++) {
    for (let cx = 0; cx <= width; cx++) {
      base[cz * stride + cx] = elevation.corner(cx, cz);
    }
  }

  // Craters fade out next to rock, whose blocks do not move.
  const craterMask = new Float32Array(press.length);
  for (let cz = 0; cz <= height; cz++) {
    for (let cx = 0; cx <= width; cx++) {
      const nearRock =
        rockAt(cx - 1, cz - 1) ||
        rockAt(cx, cz - 1) ||
        rockAt(cx - 1, cz) ||
        rockAt(cx, cz);
      craterMask[cz * stride + cx] = nearRock ? 0 : 1;
    }
  }

  const fineWidth = width * SUB + 1;
  const fineHeight = height * SUB + 1;
  let crater: Float32Array | null = null;
  const craterField = (): Float32Array => {
    crater ??= new Float32Array(fineWidth * fineHeight);
    return crater;
  };

  // Refined tiles: tile -> patch slot, and the pools per ground mesh.
  const patchOf = new Int32Array(width * height).fill(-1);
  const patchTiles: number[] = [];
  const layers: PatchLayer[] = [];
  for (const source of meshes) {
    const colorSize = source.geometry.getAttribute("color")?.itemSize ?? 3;
    const layer: PatchLayer = {
      source,
      mesh: new Mesh(new BufferGeometry(), source.material),
      colorSize,
      capacity: 0,
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      colors: new Float32Array(0),
      baseAlpha: new Float32Array(0),
      withCliff: source.geometry.getAttribute("aCliff") !== undefined,
      cliffUvs: new Float32Array(0),
      cliffs: new Float32Array(0),
    };
    layer.mesh.name = `${source.name}-relief`;
    layer.mesh.receiveShadow = source.receiveShadow;
    layer.mesh.renderOrder = source.renderOrder;
    layer.mesh.frustumCulled = false;
    layer.mesh.visible = false;
    terrain.add(layer.mesh);
    layers.push(layer);
  }

  function grow(layer: PatchLayer, capacity: number): void {
    const copy = <T extends Float32Array<ArrayBuffer>>(
      old: T,
      size: number,
    ): Float32Array<ArrayBuffer> => {
      const next = new Float32Array(capacity * PATCH_VERTICES * size);
      next.set(old);
      return next;
    };
    layer.positions = copy(layer.positions, 3);
    layer.normals = copy(layer.normals, 3);
    layer.uvs = copy(layer.uvs, 2);
    layer.colors = copy(layer.colors, layer.colorSize);
    layer.baseAlpha = copy(layer.baseAlpha, 1);
    layer.cliffUvs = copy(layer.cliffUvs, 2);
    layer.cliffs = copy(layer.cliffs, 1);
    layer.capacity = capacity;
    const previous = layer.mesh.geometry;
    layer.mesh.geometry = patchGeometry(layer);
    previous.dispose();
  }

  /** Draws tile `tile` as a fine patch from now on. False when no room. */
  function refine(tile: number): boolean {
    if ((patchOf[tile] ?? -1) >= 0) return true;
    const coarse = slotOf[tile] ?? -1;
    if (coarse < 0) return false;
    const patch = patchTiles.length;
    const limit = width * height;
    for (const layer of layers) {
      if (patch < layer.capacity) continue;
      if (layer.capacity >= limit) return false;
      grow(layer, Math.min(limit, Math.max(FIRST_PATCHES, layer.capacity * 2)));
    }
    patchTiles.push(tile);
    patchOf[tile] = patch;
    for (const layer of layers) {
      const uv = layer.source.geometry.getAttribute("uv");
      const color = layer.source.geometry.getAttribute("color");
      const first = coarse * VERTICES_PER_TILE;
      // Corners 0..3 are (0,0), (1,0), (1,1), (0,1).
      for (let row = 0; row < PATCH_SIDE; row++) {
        const fz = row / SUB;
        for (let col = 0; col < PATCH_SIDE; col++) {
          const fx = col / SUB;
          const w0 = (1 - fx) * (1 - fz);
          const w1 = fx * (1 - fz);
          const w2 = fx * fz;
          const w3 = (1 - fx) * fz;
          const vertex = patch * PATCH_VERTICES + row * PATCH_SIDE + col;
          if (uv !== undefined) {
            for (let axis = 0; axis < 2; axis++) {
              const at = (corner: number): number =>
                uv.getComponent(first + corner, axis);
              layer.uvs[vertex * 2 + axis] =
                at(0) * w0 + at(1) * w1 + at(2) * w2 + at(3) * w3;
            }
          }
          let alpha = 1;
          if (color !== undefined && layer.colorSize === 4) {
            alpha =
              color.getW(first) * w0 +
              color.getW(first + 1) * w1 +
              color.getW(first + 2) * w2 +
              color.getW(first + 3) * w3;
          }
          layer.baseAlpha[vertex] = alpha;
          if (layer.withCliff) {
            const cliffUv = layer.source.geometry.getAttribute("aCliffUv");
            const cliff = layer.source.geometry.getAttribute("aCliff");
            for (let axis = 0; axis < 2; axis++) {
              const at = (corner: number): number =>
                cliffUv?.getComponent(first + corner, axis) ?? 0;
              layer.cliffUvs[vertex * 2 + axis] =
                at(0) * w0 + at(1) * w1 + at(2) * w2 + at(3) * w3;
            }
            layer.cliffs[vertex] =
              (cliff?.getX(first) ?? 0) * w0 +
              (cliff?.getX(first + 1) ?? 0) * w1 +
              (cliff?.getX(first + 2) ?? 0) * w2 +
              (cliff?.getX(first + 3) ?? 0) * w3;
          }
        }
      }
      const cliffUvAttribute = layer.mesh.geometry.getAttribute("aCliffUv");
      if (cliffUvAttribute !== undefined) cliffUvAttribute.needsUpdate = true;
      const cliffAttribute = layer.mesh.geometry.getAttribute("aCliff");
      if (cliffAttribute !== undefined) cliffAttribute.needsUpdate = true;
      const uvAttribute = layer.mesh.geometry.getAttribute("uv");
      if (uvAttribute !== undefined) uvAttribute.needsUpdate = true;
      layer.mesh.geometry.setDrawRange(0, patchTiles.length * PATCH_INDICES);
      layer.mesh.visible = true;
    }
    const tx = tile % width;
    const tz = Math.floor(tile / width);
    mark(tx, tz, tx + 1, tz + 1);
    return true;
  }

  const jobs: Job[] = [];
  const wobble = createWobbleRng(0xc2a7e5);
  const listeners: ReliefListener[] = [];
  const lastPos = new Map<number, [number, number]>();
  let dirtyX0 = Infinity;
  let dirtyX1 = -Infinity;
  let dirtyZ0 = Infinity;
  let dirtyZ1 = -Infinity;
  let slowDirty = false;
  let lastSlowFlush = -Infinity;
  let flushes = 0;
  let flushMs = 0;
  let vertices = 0;

  /** Marks the corner rectangle (inclusive) as changed. */
  function mark(x0: number, z0: number, x1: number, z1: number): void {
    dirtyX0 = Math.min(dirtyX0, x0);
    dirtyZ0 = Math.min(dirtyZ0, z0);
    dirtyX1 = Math.max(dirtyX1, x1);
    dirtyZ1 = Math.max(dirtyZ1, z1);
  }

  /** Adds `amount * falloff` (amount < 0 digs) to the press grid around
   *  (x, z), never below `floor(corner)`. Returns whether anything changed. */
  function stampPress(
    x: number,
    z: number,
    radius: number,
    amount: number,
    floorOf: (index: number) => number,
  ): boolean {
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(width, Math.ceil(x + radius));
    const z0 = Math.max(0, Math.floor(z - radius));
    const z1 = Math.min(height, Math.ceil(z + radius));
    let changed = false;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const weight = falloff(Math.hypot(cx - x, cz - z), radius);
        if (weight === 0) continue;
        const index = cz * stride + cx;
        const current = press[index] ?? 0;
        const next = Math.max(floorOf(index), current + amount * weight);
        if (next >= current) continue;
        press[index] = next;
        changed = true;
      }
    }
    if (changed) mark(x0, z0, x1, z1);
    return changed;
  }

  /** Tile rectangle a crater of `radius` at (x, z) can change. */
  function craterTiles(
    x: number,
    z: number,
    radius: number,
  ): [number, number, number, number] {
    const reach = radius * OUTER * (1 + WOBBLE[0] + WOBBLE[1] + WOBBLE[2]);
    return [
      Math.max(0, Math.floor(x - reach)),
      Math.max(0, Math.floor(z - reach)),
      Math.min(width - 1, Math.ceil(x + reach) - 1),
      Math.min(height - 1, Math.ceil(z + reach) - 1),
    ];
  }

  /** Adds `fraction` of a crater's profile to the fine crater field. */
  function digCrater(job: Job, fraction: number): void {
    const field = craterField();
    const [tx0, tz0, tx1, tz1] = craterTiles(job.x, job.z, job.radius);
    for (let fz = tz0 * SUB; fz <= (tz1 + 1) * SUB; fz++) {
      for (let fx = tx0 * SUB; fx <= (tx1 + 1) * SUB; fx++) {
        const px = fx / SUB;
        const pz = fz / SUB;
        const dx = px - job.x;
        const dz = pz - job.z;
        const angle = Math.atan2(dz, dx);
        let scale = 1;
        for (let k = 0; k < WOBBLE.length; k++) {
          scale +=
            (WOBBLE[k] ?? 0) *
            Math.sin((WOBBLE_LOBES[k] ?? 1) * angle + (job.phases[k] ?? 0));
        }
        const t = Math.hypot(dx, dz) / (job.radius * scale);
        if (t >= OUTER) continue;
        // Only samples inside refined tiles may move; on their outline the
        // field stays zero so patches meet the coarse ground exactly.
        if (!movable(fx, fz)) continue;
        const shape = craterProfile(t, job.rim) * job.depth * fraction;
        const index = fz * fineWidth + fx;
        const next = (field[index] ?? 0) + shape * maskAt(px, pz);
        field[index] = Math.min(MAX_RISE, Math.max(-MAX_SINK, next));
      }
    }
    mark(tx0, tz0, tx1 + 1, tz1 + 1);
  }

  /** A fine sample can move when every tile around it is refined. */
  function movable(fx: number, fz: number): boolean {
    const tx = Math.floor(fx / SUB);
    const tz = Math.floor(fz / SUB);
    // A sample on a tile edge or corner belongs to every tile around it;
    // tiles past the map edge do not count.
    const xs = fx % SUB === 0 ? [tx - 1, tx] : [tx];
    const zs = fz % SUB === 0 ? [tz - 1, tz] : [tz];
    let inside = false;
    for (const z of zs) {
      for (const x of xs) {
        if (x < 0 || z < 0 || x >= width || z >= height) continue;
        if ((patchOf[z * width + x] ?? -1) < 0) return false;
        inside = true;
      }
    }
    return inside;
  }

  /** Bilinear value of a per-corner grid at world (x, z). */
  function cornerBilinear(grid: Float32Array, x: number, z: number): number {
    const cx = Math.min(width - 1e-6, Math.max(0, x));
    const cz = Math.min(height - 1e-6, Math.max(0, z));
    const ix = Math.floor(cx);
    const iz = Math.floor(cz);
    const fx = cx - ix;
    const fz = cz - iz;
    const at = (gx: number, gz: number): number => grid[gz * stride + gx] ?? 0;
    const top = at(ix, iz) * (1 - fx) + at(ix + 1, iz) * fx;
    const bottom = at(ix, iz + 1) * (1 - fx) + at(ix + 1, iz + 1) * fx;
    return top * (1 - fz) + bottom * fz;
  }

  const maskAt = (x: number, z: number): number =>
    cornerBilinear(craterMask, x, z);

  function craterAt(fx: number, fz: number): number {
    if (crater === null) return 0;
    const x = Math.min(fineWidth - 1, Math.max(0, fx));
    const z = Math.min(fineHeight - 1, Math.max(0, fz));
    return crater[z * fineWidth + x] ?? 0;
  }

  /** Relief (press + crater) at fine sample (fx, fz). */
  function reliefFine(fx: number, fz: number): number {
    return cornerBilinear(press, fx / SUB, fz / SUB) + craterAt(fx, fz);
  }

  /** Base height plus relief at fine sample (fx, fz). */
  function surfaceFine(fx: number, fz: number): number {
    return cornerBilinear(base, fx / SUB, fz / SUB) + reliefFine(fx, fz);
  }

  /** The height the normals see: the elevation bent like the static mesh
   *  (spec 30 §4) so gentle hills still read, the relief as it is. */
  function shadedFine(fx: number, fz: number): number {
    return (
      SHADING_RELIEF * cornerBilinear(base, fx / SUB, fz / SUB) +
      reliefFine(fx, fz)
    );
  }

  /** Normal at fine sample (fx, fz) from differences `step` samples apart. */
  function normalAt(
    fx: number,
    fz: number,
    step: number,
    out: [number, number, number],
  ): void {
    const left = Math.max(0, fx - step);
    const right = Math.min(fineWidth - 1, fx + step);
    const back = Math.max(0, fz - step);
    const front = Math.min(fineHeight - 1, fz + step);
    const slopeX =
      ((shadedFine(right, fz) - shadedFine(left, fz)) * SUB) /
      Math.max(1, right - left);
    const slopeZ =
      ((shadedFine(fx, front) - shadedFine(fx, back)) * SUB) /
      Math.max(1, front - back);
    const inverse = 1 / Math.hypot(slopeX, 1, slopeZ);
    out[0] = -slopeX * inverse;
    out[1] = inverse;
    out[2] = -slopeZ * inverse;
  }

  /** Brightness of the ground at fine sample (fx, fz): damp sunk soil is
   *  darker, crater curvature adds a cheap ambient occlusion (hollows darker,
   *  crests lighter) and the bowl floor is soot-black (owner request
   *  2026-10-25) so the shape reads from the high camera. */
  function shadeAt(fx: number, fz: number): number {
    const relief = reliefFine(fx, fz);
    const wet =
      relief >= 0
        ? 1 - RIM_DARKEN * Math.min(1, relief / (MAX_RISE * 0.5))
        : 1 - DARKEN * Math.min(1, -relief / DARKEN_DEPTH);
    if (crater === null) return wet;
    const centre = craterAt(fx, fz);
    const laplacian =
      (craterAt(fx + 1, fz) +
        craterAt(fx - 1, fz) +
        craterAt(fx, fz + 1) +
        craterAt(fx, fz - 1) -
        4 * centre) *
      SUB *
      SUB;
    const occlusion = Math.min(
      CURVE_LIGHT,
      Math.max(-CURVE_DARK, -CURVATURE_SHADE * laplacian),
    );
    const soot =
      centre < 0
        ? 1 - CRATER_SOOT * Math.min(1, -centre / CRATER_SOOT_DEPTH)
        : 1;
    return wet * (1 + occlusion) * soot;
  }

  const normal: [number, number, number] = [0, 1, 0];

  /** Rewrites positions, normals and colours of every tile touching the
   *  dirty corners, coarse or refined. */
  function flush(): void {
    if (dirtyX0 > dirtyX1) return;
    const started = performance.now();
    // A corner's normal reads its neighbours, so widen by one.
    const tx0 = Math.max(0, dirtyX0 - 2);
    const tx1 = Math.min(width - 1, dirtyX1 + 1);
    const tz0 = Math.max(0, dirtyZ0 - 2);
    const tz1 = Math.min(height - 1, dirtyZ1 + 1);
    for (const layer of layers) {
      const source = layer.source.geometry;
      const position = source.getAttribute("position") as BufferAttribute;
      const normals = source.getAttribute("normal") as BufferAttribute;
      const color = source.getAttribute("color") as BufferAttribute;
      let firstSlot = Infinity;
      let lastSlot = -1;
      let firstPatch = Infinity;
      let lastPatch = -1;
      for (let tz = tz0; tz <= tz1; tz++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const tile = tz * width + tx;
          const slot = slotOf[tile] ?? -1;
          if (slot < 0) continue;
          firstSlot = Math.min(firstSlot, slot);
          lastSlot = Math.max(lastSlot, slot);
          const patch = patchOf[tile] ?? -1;
          if (patch >= 0) {
            // The fine patch draws this tile; fold the coarse quad away.
            const y = (base[tz * stride + tx] ?? 0) - HIDDEN_DROP;
            for (let corner = 0; corner < VERTICES_PER_TILE; corner++) {
              position.setXYZ(slot * VERTICES_PER_TILE + corner, tx, y, tz);
            }
            firstPatch = Math.min(firstPatch, patch);
            lastPatch = Math.max(lastPatch, patch);
            writePatch(layer, patch, tx, tz);
            continue;
          }
          for (let corner = 0; corner < VERTICES_PER_TILE; corner++) {
            const cx = tx + (CORNER_DX[corner] ?? 0);
            const cz = tz + (CORNER_DZ[corner] ?? 0);
            const fx = cx * SUB;
            const fz = cz * SUB;
            const vertex = slot * VERTICES_PER_TILE + corner;
            position.setXYZ(vertex, cx, surfaceFine(fx, fz), cz);
            normalAt(fx, fz, SUB, normal);
            normals.setXYZ(vertex, normal[0], normal[1], normal[2]);
            const shade = shadeAt(fx, fz);
            color.setXYZ(vertex, shade, shade, shade);
            vertices++;
          }
        }
      }
      if (lastSlot >= firstSlot) {
        const first = firstSlot * VERTICES_PER_TILE;
        const count = (lastSlot - firstSlot + 1) * VERTICES_PER_TILE;
        for (const attribute of [position, normals, color]) {
          attribute.clearUpdateRanges();
          attribute.addUpdateRange(
            first * attribute.itemSize,
            count * attribute.itemSize,
          );
          attribute.needsUpdate = true;
        }
      }
      if (lastPatch >= firstPatch) {
        const first = firstPatch * PATCH_VERTICES;
        const count = (lastPatch - firstPatch + 1) * PATCH_VERTICES;
        for (const name of ["position", "normal", "color"]) {
          const attribute = layer.mesh.geometry.getAttribute(
            name,
          ) as BufferAttribute;
          attribute.clearUpdateRanges();
          attribute.addUpdateRange(
            first * attribute.itemSize,
            count * attribute.itemSize,
          );
          attribute.needsUpdate = true;
        }
      }
    }
    for (const listener of listeners) {
      listener(tx0, tz0, tx1 + 1, tz1 + 1);
    }
    dirtyX0 = Infinity;
    dirtyX1 = -Infinity;
    dirtyZ0 = Infinity;
    dirtyZ1 = -Infinity;
    flushes++;
    flushMs += performance.now() - started;
  }

  /** Writes the fine vertices of the patch drawing tile (tx, tz). */
  function writePatch(
    layer: PatchLayer,
    patch: number,
    tx: number,
    tz: number,
  ): void {
    for (let row = 0; row < PATCH_SIDE; row++) {
      for (let col = 0; col < PATCH_SIDE; col++) {
        const fx = tx * SUB + col;
        const fz = tz * SUB + row;
        const vertex = patch * PATCH_VERTICES + row * PATCH_SIDE + col;
        layer.positions[vertex * 3] = fx / SUB;
        layer.positions[vertex * 3 + 1] = surfaceFine(fx, fz);
        layer.positions[vertex * 3 + 2] = fz / SUB;
        normalAt(fx, fz, 1, normal);
        layer.normals.set(normal, vertex * 3);
        const shade = shadeAt(fx, fz);
        const size = layer.colorSize;
        layer.colors[vertex * size] = shade;
        layer.colors[vertex * size + 1] = shade;
        layer.colors[vertex * size + 2] = shade;
        if (size === 4) {
          // Torn-up soil in the bowl and on the rim shows the dirt texture.
          const soil = smoothstep(
            SOIL_FROM,
            SOIL_FULL,
            Math.abs(craterAt(fx, fz)),
          );
          layer.colors[vertex * size + 3] = Math.max(
            layer.baseAlpha[vertex] ?? 0,
            soil * SOIL_ALPHA,
          );
        }
        vertices++;
      }
    }
  }

  return {
    crater(x, z, radius, depth, startMs, rim = RIM_RATIO) {
      if (radius <= 0 || depth <= 0) return false;
      const [tx0, tz0, tx1, tz1] = craterTiles(x, z, radius);
      for (let tz = tz0; tz <= tz1; tz++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (rockAt(tx, tz)) continue;
          if (!refine(tz * width + tx)) return false;
        }
      }
      if (jobs.length >= MAX_JOBS) {
        const oldest = jobs.shift();
        if (oldest !== undefined) digCrater(oldest, 1 - oldest.applied);
      }
      const tau = Math.PI * 2;
      jobs.push({
        x,
        z,
        radius,
        depth,
        rim,
        phases: [wobble() * tau, wobble() * tau, wobble() * tau],
        startMs,
        applied: 0,
      });
      return true;
    },

    press(sources, nowMs) {
      const seen = new Set<number>();
      for (const source of sources) {
        if (source.weight <= 0) continue;
        seen.add(source.id);
        const before = lastPos.get(source.id);
        lastPos.set(source.id, [source.x, source.y]);
        if (before === undefined) continue;
        const step = Math.hypot(source.x - before[0], source.y - before[1]);
        // A teleport or a respawn is not driving.
        if (step < MIN_STEP || step > 1) continue;
        const amount = -SINK_PER_TILE * step * source.weight;
        if (
          stampPress(
            source.x,
            source.y,
            VEHICLE_RADIUS,
            amount,
            (index) => -MAX_VEHICLE_SINK * (softness[index] ?? 0),
          )
        ) {
          slowDirty = true;
        }
      }
      for (const id of lastPos.keys()) if (!seen.has(id)) lastPos.delete(id);
      void nowMs;
    },

    setSoftness(mask) {
      softness = mask ?? defaults;
    },

    heightAt(x, z) {
      const ground = elevation.at(x, z);
      const pressed = ground + cornerBilinear(press, x, z);
      if (crater === null) return pressed;
      const gx = Math.min(fineWidth - 1 - 1e-6, Math.max(0, x * SUB));
      const gz = Math.min(fineHeight - 1 - 1e-6, Math.max(0, z * SUB));
      const ix = Math.floor(gx);
      const iz = Math.floor(gz);
      const fx = gx - ix;
      const fz = gz - iz;
      const top = craterAt(ix, iz) * (1 - fx) + craterAt(ix + 1, iz) * fx;
      const bottom =
        craterAt(ix, iz + 1) * (1 - fx) + craterAt(ix + 1, iz + 1) * fx;
      return pressed + top * (1 - fz) + bottom * fz;
    },

    update(nowMs) {
      let craterTouched = false;
      for (let index = jobs.length - 1; index >= 0; index--) {
        const job = jobs[index];
        if (job === undefined || nowMs < job.startMs) continue;
        const fraction = ease((nowMs - job.startMs) / CRATER_RISE_MS);
        const delta = fraction - job.applied;
        if (delta > 0) {
          digCrater(job, delta);
          craterTouched = true;
          job.applied = fraction;
        }
        if (fraction >= 1) jobs.splice(index, 1);
      }
      // Crater growth must be smooth, so it flushes every frame; the slow
      // sinking under vehicles is invisible frame to frame and waits.
      if (
        craterTouched ||
        (slowDirty && nowMs - lastSlowFlush >= SLOW_FLUSH_MS)
      ) {
        flush();
        slowDirty = false;
        lastSlowFlush = nowMs;
      }
    },

    onChange(listener) {
      listeners.push(listener);
    },

    stats() {
      return { flushes, flushMs, vertices, refined: patchTiles.length };
    },
  };
}
