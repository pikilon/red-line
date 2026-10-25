import {
  BufferGeometry,
  Float32BufferAttribute,
  Plane,
  type Ray,
  Uint32BufferAttribute,
  Vector3,
} from "three";

/** Terrain elevation as the client draws it (spec 30). The heights are the
 *  sim's own corner bytes from the ruleset map, so units stand where the sim
 *  says the ground is. */

/** Height steps per tile, like the sim's `HEIGHT_STEPS_PER_TILE`. */
export const HEIGHT_STEPS_PER_TILE = 16;

/** Ground normals bend this much more than the real slope, so gentle hills
 *  still read under the high isometric sun (spec 30 §4). Shading only. */
export const SHADING_RELIEF = 2.5;

export interface Elevation {
  readonly width: number;
  readonly height: number;
  /** Corner heights in tiles, row-major over (width + 1) x (height + 1). */
  readonly corners: Float32Array;
  /** False when every corner is at 0. */
  readonly raised: boolean;
  /** Highest corner, in tiles. */
  readonly top: number;
  /** Ground height at (x, z) in tiles: the cell triangle plane, split along
   *  the (x, z)-(x + 1, z + 1) diagonal like the sim and the ground mesh. */
  at(x: number, z: number): number;
  /** Corner height, clamped to the map edge. */
  corner(cx: number, cz: number): number;
  /** Steepness at a corner: |gradient| in tiles of rise per tile. */
  slope(cx: number, cz: number): number;
}

/** The map as the ruleset gives it: `heights` is two hex digits per corner. */
export interface ElevationMap {
  readonly width: number;
  readonly height: number;
  readonly heights?: string;
}

/** Decodes the ruleset hex; a missing or malformed string is a flat map. */
export function elevationOf(map: ElevationMap): Elevation {
  const count = (map.width + 1) * (map.height + 1);
  const corners = new Float32Array(count);
  const hex = map.heights ?? "";
  if (hex.length === count * 2) {
    for (let i = 0; i < count; i++) {
      const value = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      corners[i] = Number.isNaN(value) ? 0 : value / HEIGHT_STEPS_PER_TILE;
    }
  }
  return fromCorners(map.width, map.height, corners);
}

/** A flat elevation of the given size. */
export function flatElevation(width: number, height: number): Elevation {
  return fromCorners(
    width,
    height,
    new Float32Array((width + 1) * (height + 1)),
  );
}

export function fromCorners(
  width: number,
  height: number,
  corners: Float32Array,
): Elevation {
  const stride = width + 1;
  let top = 0;
  for (const value of corners) top = Math.max(top, value);
  const corner = (cx: number, cz: number): number => {
    const x = Math.min(width, Math.max(0, cx));
    const z = Math.min(height, Math.max(0, cz));
    return corners[z * stride + x] ?? 0;
  };
  return {
    width,
    height,
    corners,
    raised: top > 0,
    top,
    corner,
    at(x, z) {
      if (top === 0) return 0;
      const px = Math.min(width, Math.max(0, x));
      const pz = Math.min(height, Math.max(0, z));
      const cx = Math.min(width - 1, Math.floor(px));
      const cz = Math.min(height - 1, Math.floor(pz));
      const fx = px - cx;
      const fz = pz - cz;
      const h00 = corner(cx, cz);
      const h10 = corner(cx + 1, cz);
      const h01 = corner(cx, cz + 1);
      const h11 = corner(cx + 1, cz + 1);
      return fx >= fz
        ? h00 + (h10 - h00) * fx + (h11 - h10) * fz
        : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    },
    slope(cx, cz) {
      const gx = (corner(cx + 1, cz) - corner(cx - 1, cz)) / 2;
      const gz = (corner(cx, cz + 1) - corner(cx, cz - 1)) / 2;
      return Math.hypot(gx, gz);
    },
  };
}

let current: Elevation = flatElevation(1, 1);
/** Visual surface on top of the elevation (craters and tread press, spec 24). */
let reliefAt: ((x: number, y: number) => number) | null = null;

/** Makes `elevation` the ground every renderer stands things on. */
export function setGroundElevation(elevation: Elevation | null): void {
  current = elevation ?? flatElevation(1, 1);
  reliefAt = null;
}

/** Makes `heightOf` the visual surface the renderer stands things on: the
 *  elevation plus the craters and the sinking under vehicles (spec 24). The
 *  skirmish passes `TerrainDeformer.heightAt`. `null` clears it. */
export function setGroundRelief(
  heightOf: ((x: number, y: number) => number) | null,
): void {
  reliefAt = heightOf;
}

export function groundElevation(): Elevation {
  return current;
}

/** Ground height at sim tile (x, y), in tiles (Three y), including the visual
 *  relief under it (spec 24). */
export function groundY(x: number, y: number): number {
  return reliefAt === null ? current.at(x, y) : reliefAt(x, y);
}

/** Ground a building of `w` x `d` tiles centred at (x, y) stands on: the
 *  lowest of its corners and centre, so it never floats over a slope (Zero
 *  Hour flattens the ground under it instead; spec 30 §4). */
export function footprintGround(
  x: number,
  y: number,
  w: number,
  d: number,
): number {
  if (!current.raised) return 0;
  const hw = w / 2;
  const hd = d / 2;
  return Math.min(
    current.at(x, y),
    current.at(x - hw, y - hd),
    current.at(x + hw, y - hd),
    current.at(x + hw, y + hd),
    current.at(x - hw, y + hd),
  );
}

/** Pitch and roll, in radians, that sit a body of `length` x `width` tiles
 *  facing `yaw` on the ground at (x, y): the slope between its front and
 *  back, and between its sides (spec 30 §4), including any crater relief
 *  under it (spec 24). Three's YXZ Euler convention: negative pitch lifts the
 *  nose, positive roll lifts the right side. */
export function groundTilt(
  x: number,
  y: number,
  yaw: number,
  length: number,
  width: number,
): { pitch: number; roll: number } {
  if (!current.raised && reliefAt === null) return { pitch: 0, roll: 0 };
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const halfLength = Math.max(0.25, length / 2);
  const halfWidth = Math.max(0.25, width / 2);
  const front = groundY(x + fx * halfLength, y + fz * halfLength);
  const back = groundY(x - fx * halfLength, y - fz * halfLength);
  // Right of the hull: Three rotates +x to (cos yaw, -sin yaw).
  const right = groundY(x + fz * halfWidth, y - fx * halfWidth);
  const left = groundY(x - fz * halfWidth, y + fx * halfWidth);
  return {
    pitch: -Math.atan2(front - back, 2 * halfLength),
    roll: Math.atan2(right - left, 2 * halfWidth),
  };
}

const PICK_STEP = 0.25;
const plane = new Plane(new Vector3(0, 1, 0), 0);
const hit = new Vector3();

/** Where `ray` first meets the ground, as sim tiles; on a flat map the y = 0
 *  plane. Marches down from the highest corner, then bisects. */
export function pickGround(ray: Ray): { x: number; y: number } | null {
  const elevation = current;
  plane.constant = 0;
  const flat = ray.intersectPlane(plane, hit);
  if (!elevation.raised || flat === null) {
    return flat === null ? null : { x: flat.x, y: flat.z };
  }
  plane.constant = -elevation.top;
  const start = ray.intersectPlane(plane, new Vector3());
  if (start === null) return { x: flat.x, y: flat.z };
  const end = flat.clone();
  const distance = start.distanceTo(end);
  const steps = Math.max(1, Math.ceil(distance / PICK_STEP));
  const point = new Vector3();
  let previous = start.clone();
  for (let i = 1; i <= steps; i++) {
    point.lerpVectors(start, end, i / steps);
    if (point.y <= elevation.at(point.x, point.z)) {
      let low = previous.clone();
      let high = point.clone();
      for (let k = 0; k < 12; k++) {
        const mid = low.clone().lerp(high, 0.5);
        if (mid.y <= elevation.at(mid.x, mid.z)) high = mid;
        else low = mid;
      }
      return { x: high.x, y: high.z };
    }
    previous = point.clone();
  }
  return { x: end.x, y: end.z };
}

/** A grid over the map whose vertices sit `lift` tiles above the ground, with
 *  the ground mesh's diagonal, for overlays that drape over hills (fog, snow).
 *  UVs run 0..1 with v = 0 at z = 0. */
export function drapedGrid(elevation: Elevation, lift: number): BufferGeometry {
  const { width, height } = elevation;
  const stride = width + 1;
  const positions = new Float32Array(stride * (height + 1) * 3);
  const uvs = new Float32Array(stride * (height + 1) * 2);
  for (let z = 0; z <= height; z++) {
    for (let x = 0; x <= width; x++) {
      const vertex = z * stride + x;
      positions.set([x, elevation.corner(x, z) + lift, z], vertex * 3);
      uvs.set([x / width, z / height], vertex * 2);
    }
  }
  const indices = new Uint32Array(width * height * 6);
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const a = z * stride + x;
      const b = a + 1;
      const c = a + stride + 1;
      const d = a + stride;
      indices.set([a, c, b, a, d, c], (z * width + x) * 6);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}
