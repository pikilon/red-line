import { type BufferAttribute, type Group, Mesh } from "three";

/** Visual-only ground relief (spec 22). The simulation never reads it: the
 *  heights below only move the grass and dirt vertices and their normals. */

/** Seconds a crater takes to reach its full depth. */
export const CRATER_RISE_MS = 350;
/** Deepest total sink of any vertex, in tiles. */
export const MAX_SINK = 0.5;
/** Deepest sink a vehicle's weight alone digs on fully soft ground, in tiles. */
export const MAX_VEHICLE_SINK = 0.07;
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

/** Damp, turned-up soil is darker: brightness lost at `DARKEN_DEPTH` of sink. */
const DARKEN = 0.45;
const DARKEN_DEPTH = 0.3;

const VERTICES_PER_TILE = 4;
/** Grid offset of the four corners of a tile, in `groundGeometry` order. */
const CORNER_DX = [0, 1, 1, 0] as const;
const CORNER_DZ = [0, 0, 1, 1] as const;

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
}

export interface TerrainDeformer {
  /** Schedules a crater at world tile (x, z); it sinks `depth` tiles over
   *  `CRATER_RISE_MS` starting at `startMs`. */
  crater(
    x: number,
    z: number,
    radius: number,
    depth: number,
    startMs: number,
  ): void;
  /** Sinks the ground under moving weights, scaled by the softness there. */
  press(sources: readonly PressSource[], nowMs: number): void;
  /** Per-corner softness in 0..1 over a (width+1) x (height+1) grid, row
   *  major; null restores the default (the dirt patches). Snow layers use this. */
  setSoftness(softness: Float32Array<ArrayBuffer> | null): void;
  /** Sink (<= 0) at a world position, bilinear. */
  heightAt(x: number, z: number): number;
  /** Applies due craters and uploads the changed vertices. */
  update(nowMs: number): void;
  stats(): DeformStats;
}

interface Job {
  x: number;
  z: number;
  radius: number;
  depth: number;
  startMs: number;
  applied: number;
}

function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Radial falloff: 1 at the centre, 0 at `radius`, flat bottom, soft edge. */
function falloff(distance: number, radius: number): number {
  const t = distance / radius;
  if (t >= 1) return 0;
  const u = 1 - t * t;
  return u * u;
}

/** Makes the grass and dirt meshes of `terrain` deformable. `defaultSoftness`
 *  gives the softness of a grid corner when no mask was set. */
export function attachTerrainDeformer(
  terrain: Group,
  width: number,
  height: number,
  rockCells: Uint8Array,
  defaultSoftness: (cx: number, cz: number) => number,
): TerrainDeformer {
  const stride = width + 1;
  const sink = new Float32Array(stride * (height + 1));
  let softness: Float32Array<ArrayBuffer> = new Float32Array(sink.length);
  const defaults = new Float32Array(sink.length);
  for (let z = 0; z <= height; z++) {
    for (let x = 0; x <= width; x++) {
      defaults[z * stride + x] = defaultSoftness(x, z);
    }
  }
  softness = defaults;

  // Tile -> slot, in the order `groundGeometry` laid the passable tiles out.
  const slotOf = new Int32Array(width * height).fill(-1);
  let slots = 0;
  for (let tile = 0; tile < width * height; tile++) {
    if ((rockCells[tile] ?? 0) === 0) slotOf[tile] = slots++;
  }

  const meshes: Mesh[] = [];
  for (const name of ["grass", "dirt"]) {
    const mesh = terrain.getObjectByName(name);
    if (mesh instanceof Mesh) meshes.push(mesh);
  }

  const jobs: Job[] = [];
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

  function mark(x0: number, z0: number, x1: number, z1: number): void {
    dirtyX0 = Math.min(dirtyX0, x0);
    dirtyZ0 = Math.min(dirtyZ0, z0);
    dirtyX1 = Math.max(dirtyX1, x1);
    dirtyZ1 = Math.max(dirtyZ1, z1);
  }

  /** Adds `amount * falloff` (amount < 0 digs) around (x, z), never below
   *  `floor(corner)`. Returns whether anything changed. */
  function stamp(
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
        const current = sink[index] ?? 0;
        const next = Math.max(floorOf(index), current + amount * weight);
        if (next >= current) continue;
        sink[index] = next;
        changed = true;
      }
    }
    if (changed) mark(x0, z0, x1, z1);
    return changed;
  }

  const craterFloor = (): number => -MAX_SINK;

  function sinkAt(cx: number, cz: number): number {
    const x = Math.min(width, Math.max(0, cx));
    const z = Math.min(height, Math.max(0, cz));
    return sink[z * stride + x] ?? 0;
  }

  /** Rewrites positions and normals of every tile touching the dirty corners. */
  function flush(): void {
    if (dirtyX0 > dirtyX1) return;
    const started = performance.now();
    // A corner's normal reads its neighbours, so widen by one.
    const tx0 = Math.max(0, dirtyX0 - 2);
    const tx1 = Math.min(width - 1, dirtyX1 + 1);
    const tz0 = Math.max(0, dirtyZ0 - 2);
    const tz1 = Math.min(height - 1, dirtyZ1 + 1);
    let firstSlot = Infinity;
    let lastSlot = -1;
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute(
        "position",
      ) as BufferAttribute;
      const normal = mesh.geometry.getAttribute("normal") as BufferAttribute;
      const color = mesh.geometry.getAttribute("color") as BufferAttribute;
      for (let tz = tz0; tz <= tz1; tz++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const slot = slotOf[tz * width + tx] ?? -1;
          if (slot < 0) continue;
          firstSlot = Math.min(firstSlot, slot);
          lastSlot = Math.max(lastSlot, slot);
          for (let corner = 0; corner < VERTICES_PER_TILE; corner++) {
            const cx = tx + (CORNER_DX[corner] ?? 0);
            const cz = tz + (CORNER_DZ[corner] ?? 0);
            const vertex = slot * VERTICES_PER_TILE + corner;
            position.setY(vertex, sinkAt(cx, cz));
            const slopeX = (sinkAt(cx + 1, cz) - sinkAt(cx - 1, cz)) / 2;
            const slopeZ = (sinkAt(cx, cz + 1) - sinkAt(cx, cz - 1)) / 2;
            const inverse = 1 / Math.hypot(slopeX, 1, slopeZ);
            normal.setXYZ(
              vertex,
              -slopeX * inverse,
              inverse,
              -slopeZ * inverse,
            );
            const shade =
              1 - DARKEN * Math.min(1, -sinkAt(cx, cz) / DARKEN_DEPTH);
            color.setXYZ(vertex, shade, shade, shade);
            vertices++;
          }
        }
      }
      if (lastSlot >= firstSlot) {
        const first = firstSlot * VERTICES_PER_TILE;
        const count = (lastSlot - firstSlot + 1) * VERTICES_PER_TILE;
        position.clearUpdateRanges();
        position.addUpdateRange(first * 3, count * 3);
        position.needsUpdate = true;
        normal.clearUpdateRanges();
        normal.addUpdateRange(first * 3, count * 3);
        normal.needsUpdate = true;
        color.clearUpdateRanges();
        color.addUpdateRange(first * color.itemSize, count * color.itemSize);
        color.needsUpdate = true;
      }
    }
    dirtyX0 = Infinity;
    dirtyX1 = -Infinity;
    dirtyZ0 = Infinity;
    dirtyZ1 = -Infinity;
    flushes++;
    flushMs += performance.now() - started;
  }

  return {
    crater(x, z, radius, depth, startMs) {
      if (jobs.length >= MAX_JOBS) {
        const oldest = jobs.shift();
        if (oldest !== undefined) {
          stamp(
            oldest.x,
            oldest.z,
            oldest.radius,
            -oldest.depth * (1 - oldest.applied),
            craterFloor,
          );
        }
      }
      jobs.push({ x, z, radius, depth, startMs, applied: 0 });
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
          stamp(
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
      const cx = Math.min(width - 1e-6, Math.max(0, x));
      const cz = Math.min(height - 1e-6, Math.max(0, z));
      const ix = Math.floor(cx);
      const iz = Math.floor(cz);
      const fx = cx - ix;
      const fz = cz - iz;
      const top = sinkAt(ix, iz) * (1 - fx) + sinkAt(ix + 1, iz) * fx;
      const bottom =
        sinkAt(ix, iz + 1) * (1 - fx) + sinkAt(ix + 1, iz + 1) * fx;
      return top * (1 - fz) + bottom * fz;
    },

    update(nowMs) {
      let craterTouched = false;
      for (let index = jobs.length - 1; index >= 0; index--) {
        const job = jobs[index];
        if (job === undefined || nowMs < job.startMs) continue;
        const fraction = ease((nowMs - job.startMs) / CRATER_RISE_MS);
        const delta = fraction - job.applied;
        if (delta > 0) {
          if (
            stamp(job.x, job.z, job.radius, -job.depth * delta, craterFloor)
          ) {
            craterTouched = true;
          }
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

    stats() {
      return { flushes, flushMs, vertices };
    },
  };
}
