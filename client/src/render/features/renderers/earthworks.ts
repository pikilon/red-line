import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
} from "three";
import type { FeatureContext, FeatureInstance } from "../layers";
import { registerFeatureRenderer } from "../registry";
import {
  craterChanges,
  nearestStroke,
  publishTrenchStrokes,
  setDigSites,
  TRENCH_CREST,
  TRENCH_DEPTH,
  TRENCH_HALF_WIDTH,
  type TrenchPoint,
  trenchLines,
  trenchReliefAt,
  trenchStrokes,
  withBattered,
} from "../trenchNetwork";

/** Spec 35: trenches soldiers dig (family `earthwork`). The channel itself
 *  is carved into the ground by the terrain deformer (`trenchNetwork.ts`),
 *  so it reads like a crater pulled along a line. This renderer dresses it:
 *  sandbags on both berms and duckboards on the floor where the trench is
 *  finished, a covered shelter on `variant` 1 pieces, and survey stakes with
 *  tape on pieces still being dug (the construction mark). */

const BAG = new MeshLambertMaterial({ color: 0xffffff });
const WOOD = new MeshLambertMaterial({ color: 0x6b4a2b });
const PLANK = new MeshLambertMaterial({ color: 0x5f4630 });
const TAPE = new MeshLambertMaterial({ color: 0xd8c23a });
const ROOF = new MeshLambertMaterial({ color: 0x4f3a24 });

const BAG_COLORS = [0xb8a477, 0xa99668, 0xc2b082, 0x9e8c5f].map(
  (hex) => new Color(hex),
);
/** Sandbag size in tiles: long, deep, high. */
const BAG_SIZE = [0.26, 0.15, 0.1] as const;
/** Bags along each berm, centre to centre. */
const BAG_STEP = 0.24;
/** Distance of the bag rows from the centreline, in tiles. */
const BAG_OFFSET = TRENCH_HALF_WIDTH * 1.15;
/** Duckboard spacing along the floor. */
const BOARD_STEP = 0.2;

const bagGeometry = new SphereGeometry(0.5, 8, 5);
const box = new BoxGeometry(1, 1, 1);
const log = new CylinderGeometry(0.5, 0.5, 1, 6);

interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  color?: Color;
}

/** Points every `step` tiles along a polyline, with the heading there. */
function along(
  line: readonly TrenchPoint[],
  step: number,
  phase = 0,
): {
  x: number;
  z: number;
  dug: number;
  kept: number;
  dx: number;
  dz: number;
}[] {
  const out: {
    x: number;
    z: number;
    dug: number;
    kept: number;
    dx: number;
    dz: number;
  }[] = [];
  let carry = phase;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as TrenchPoint;
    const b = line[i] as TrenchPoint;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length === 0) continue;
    const dx = (b.x - a.x) / length;
    const dz = (b.z - a.z) / length;
    let s = carry;
    for (; s < length; s += step) {
      const t = s / length;
      out.push({
        x: a.x + dx * s,
        z: a.z + dz * s,
        dug: a.dug + (b.dug - a.dug) * t,
        kept: a.kept + (b.kept - a.kept) * t,
        dx,
        dz,
      });
    }
    carry = s - length;
  }
  return out;
}

function instanced(
  geometry: BoxGeometry | SphereGeometry | CylinderGeometry,
  material: MeshLambertMaterial,
  placements: readonly Placement[],
  name: string,
): InstancedMesh | null {
  if (placements.length === 0) return null;
  const mesh = new InstancedMesh(geometry, material, placements.length);
  mesh.name = name;
  const dummy = new Object3D();
  placements.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.set(p.sx, p.sy, p.sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (p.color !== undefined) mesh.setColorAt(i, p.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Cosmetic jitter, the same on every rebuild. */
function hash(x: number, z: number, salt: number): number {
  let h = Math.imul(
    Math.round(x * 97) ^ Math.imul(Math.round(z * 89), 31),
    2654435761,
  );
  h ^= salt * 374761393;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 0x100000000;
}

function createEarthworks(
  instances: readonly FeatureInstance[],
  ctx: FeatureContext,
): Group {
  const group = new Group();
  group.name = "earthworks";
  const pieces = withBattered(instances);
  craterChanges(pieces);
  const lines = trenchLines(pieces);
  const strokes = trenchStrokes(lines);
  publishTrenchStrokes(strokes);
  setDigSites(pieces.filter((piece) => piece.state > 0 && !piece.battered));
  const surface = (x: number, z: number): number =>
    ctx.elevation.at(x, z) + trenchReliefAt(strokes, x, z);

  const bags: Placement[] = [];
  const boards: Placement[] = [];
  for (const line of lines) {
    // Sandbags: two staggered courses on each berm where the trench is done.
    for (const course of [0, 1]) {
      for (const p of along(line, BAG_STEP, course * BAG_STEP * 0.5)) {
        if (p.kept < 0.5) continue;
        for (const side of [-1, 1]) {
          const offset = BAG_OFFSET + (course === 1 ? -0.02 : 0.03);
          const x = p.x - p.dz * side * offset;
          const z = p.z + p.dx * side * offset;
          // Skip bags that would sit in another channel (joins, crossings).
          if (
            nearestStroke(strokes, x, z).distance <
            TRENCH_HALF_WIDTH * 0.95
          ) {
            continue;
          }
          const jitter = hash(x, z, course);
          // Shelling has knocked bags off a worn-down stretch.
          if (p.dug < 0.9 && hash(x, z, 11) < 0.45) continue;
          bags.push({
            x,
            y:
              surface(x, z) +
              BAG_SIZE[2] * (course === 0 ? 0.35 : 1.15) -
              0.005,
            z,
            yaw: Math.atan2(-p.dz, p.dx) + (jitter - 0.5) * 0.35,
            sx: BAG_SIZE[0] * (0.9 + jitter * 0.2),
            sy: BAG_SIZE[2],
            sz: BAG_SIZE[1],
            color: BAG_COLORS[Math.floor(jitter * BAG_COLORS.length)],
          });
        }
      }
    }
    // Duckboards across the floor of the finished stretches.
    for (const p of along(line, BOARD_STEP)) {
      if (p.kept < 0.5) continue;
      boards.push({
        x: p.x,
        y: surface(p.x, p.z) + 0.006,
        z: p.z,
        yaw: Math.atan2(-p.dz, p.dx) + Math.PI / 2,
        sx: TRENCH_HALF_WIDTH * 1.05,
        sy: 0.012,
        sz: BOARD_STEP * 0.7,
      });
    }
  }

  const wood: Placement[] = [];
  const tape: Placement[] = [];
  const roofs: Placement[] = [];
  const logs: Placement[] = [];
  for (const piece of pieces) {
    const cx = piece.x + piece.width / 2;
    const cz = piece.y + piece.height / 2;
    const alongX = piece.width >= piece.height;
    const yaw = alongX ? 0 : Math.PI / 2;
    const length = alongX ? piece.width : piece.height;
    if (piece.state > 0 && piece.battered) continue;
    if (piece.state > 0) {
      // Construction mark: four stakes and a tape on each long side.
      const half = length / 2 - 0.08;
      const side = 0.46;
      for (const u of [-half, half]) {
        for (const v of [-side, side]) {
          const x = cx + (alongX ? u : v);
          const z = cz + (alongX ? v : u);
          wood.push({
            x,
            y: ctx.elevation.at(x, z) + 0.07,
            z,
            yaw: 0,
            sx: 0.03,
            sy: 0.14,
            sz: 0.03,
          });
        }
      }
      for (const v of [-side, side]) {
        const x = cx + (alongX ? 0 : v);
        const z = cz + (alongX ? v : 0);
        tape.push({
          x,
          y: ctx.elevation.at(x, z) + 0.11,
          z,
          yaw,
          sx: length - 0.16,
          sy: 0.012,
          sz: 0.012,
        });
      }
      continue;
    }
    if (piece.variant !== 1) continue;
    // Shelter: a log roof across the channel, heaped with sandbags.
    const top = ctx.elevation.at(cx, cz) + TRENCH_DEPTH * 0.3;
    const span = TRENCH_HALF_WIDTH * TRENCH_CREST * 2;
    roofs.push({ x: cx, y: top, z: cz, yaw, sx: 0.9, sy: 0.05, sz: span });
    for (const u of [-0.36, -0.12, 0.12, 0.36]) {
      const x = cx + (alongX ? u : 0);
      const z = cz + (alongX ? 0 : u);
      logs.push({
        x,
        y: top - 0.03,
        z,
        yaw: yaw + Math.PI / 2,
        sx: 0.06,
        sy: span + 0.08,
        sz: 0.06,
      });
    }
    for (const [row, v] of [
      [0, -0.18],
      [0, 0.18],
      [1, 0],
    ] as const) {
      for (const u of row === 0 ? [-0.3, -0.1, 0.1, 0.3] : [-0.2, 0, 0.2]) {
        const x = cx + (alongX ? u : v);
        const z = cz + (alongX ? v : u);
        const jitter = hash(x, z, 7);
        bags.push({
          x,
          y: top + 0.025 + BAG_SIZE[2] * (row === 0 ? 0.45 : 1.3),
          z,
          yaw: yaw + (jitter - 0.5) * 0.3,
          sx: BAG_SIZE[0] * 1.1,
          sy: BAG_SIZE[2],
          sz: BAG_SIZE[1] * 1.2,
          color: BAG_COLORS[Math.floor(jitter * BAG_COLORS.length)],
        });
      }
    }
  }

  const parts = [
    instanced(bagGeometry, BAG, bags, "trench-sandbags"),
    instanced(box, PLANK, boards, "trench-duckboards"),
    instanced(box, WOOD, wood, "trench-stakes"),
    instanced(box, TAPE, tape, "trench-tape"),
    instanced(box, ROOF, roofs, "trench-shelter-roof"),
    logShelf(logs),
  ];
  for (const part of parts) if (part !== null) group.add(part);
  return group;
}

/** Roof logs: upright cylinders laid on their side across the trench. */
function logShelf(placements: readonly Placement[]): InstancedMesh | null {
  if (placements.length === 0) return null;
  const mesh = new InstancedMesh(log, WOOD, placements.length);
  mesh.name = "trench-shelter-logs";
  const turn = new Matrix4().makeRotationX(Math.PI / 2);
  const dummy = new Object3D();
  placements.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    const scale = new Matrix4().makeScale(p.sx, p.sy, p.sz);
    mesh.setMatrixAt(i, dummy.matrix.clone().multiply(turn).multiply(scale));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  return mesh;
}

registerFeatureRenderer("earthwork", createEarthworks);
