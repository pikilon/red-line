import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import { typeDef } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  NEUTRAL,
} from "../sim/matchSnapshot";

export const OWNER_COLORS = [0x2563eb, 0xdc2626] as const;
export const NEUTRAL_COLOR = 0x8b5a2b;
export const SELECTED_COLOR = 0xfacc15;
export const HEALTH_COLORS = {
  high: 0x22c55e,
  mid: 0xeab308,
  low: 0xef4444,
} as const; // > 50 %, > 25 %, else

const GHOST_OPACITY = 0.4;
const BAR_HEIGHT = 0.12;
const BAR_GAP = 0.3;
const BAR_MIN_SCALE = 0.05;
const TRACER_Y = 0.5;
const PROGRESS_FULL = 1000;

export interface EntityRenderer {
  readonly group: Group; // children: units, buildings, ghosts, bars (InstancedMesh), tracers (LineSegments)
  readonly units: InstancedMesh;
  readonly buildings: InstancedMesh;
  readonly ghosts: InstancedMesh;
  readonly bars: InstancedMesh;
  readonly tracers: LineSegments;
  update(entities: readonly EntityState[], selected: ReadonlySet<number>): void;
}

function instanced(
  geometry: BufferGeometry,
  material: MeshBasicMaterial,
  capacity: number,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  // Instances move every frame; bounds computed at creation would cull them.
  mesh.frustumCulled = false;
  return mesh;
}

function finish(mesh: InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) {
    mesh.instanceColor.needsUpdate = true;
  }
}

function ownerColor(owner: number): number {
  return owner === NEUTRAL
    ? NEUTRAL_COLOR
    : (OWNER_COLORS[owner] ?? NEUTRAL_COLOR);
}

function healthColor(ratio: number): number {
  if (ratio > 0.5) return HEALTH_COLORS.high;
  return ratio > 0.25 ? HEALTH_COLORS.mid : HEALTH_COLORS.low;
}

export function createEntityRenderer(capacity: number): EntityRenderer {
  const box = new BoxGeometry(1, 1, 1);
  const units = instanced(box, new MeshBasicMaterial(), capacity);
  const buildings = instanced(box, new MeshBasicMaterial(), capacity);
  const ghosts = instanced(
    box,
    new MeshBasicMaterial({ transparent: true, opacity: GHOST_OPACITY }),
    capacity,
  );
  const bars = instanced(
    new PlaneGeometry(1, BAR_HEIGHT),
    new MeshBasicMaterial({ side: DoubleSide }),
    capacity,
  );
  const tracerPositions = new Float32BufferAttribute(capacity * 2 * 3, 3);
  const tracerColors = new Float32BufferAttribute(capacity * 2 * 3, 3);
  const tracerGeometry = new BufferGeometry();
  tracerGeometry.setAttribute("position", tracerPositions);
  tracerGeometry.setAttribute("color", tracerColors);
  tracerGeometry.setDrawRange(0, 0);
  const tracers = new LineSegments(
    tracerGeometry,
    new LineBasicMaterial({ vertexColors: true }),
  );
  tracers.frustumCulled = false;

  const group = new Group();
  group.add(units, buildings, ghosts, bars, tracers);

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const color = new Color();

  function place(mesh: InstancedMesh, index: number, hex: number): void {
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, color.setHex(hex));
  }

  return {
    group,
    units,
    buildings,
    ghosts,
    bars,
    tracers,
    update(entities, selected) {
      const counts = { units: 0, buildings: 0, ghosts: 0, bars: 0 };
      const byId = new Map(entities.map((entity) => [entity.id, entity]));
      let tracerCount = 0;

      for (const entity of entities) {
        const type = typeDef(entity.kind);
        const [w, h, d] = type.render.size.map((size) => size / 100) as [
          number,
          number,
          number,
        ];
        const isSelected = selected.has(entity.id);
        const hex = isSelected ? SELECTED_COLOR : ownerColor(entity.owner);
        const isGhost = hasFlag(entity, ENTITY_FLAGS.ghost);

        if (isGhost) {
          if (counts.ghosts >= capacity) continue;
          position.set(entity.x, h / 2, entity.y);
          scale.set(w, h, d);
          place(ghosts, counts.ghosts++, hex);
          continue;
        }
        if (type.category === "unit") {
          if (counts.units >= capacity) continue;
          position.set(entity.x, h / 2, entity.y);
          scale.set(w, h, d);
          place(units, counts.units++, hex);
        } else {
          if (counts.buildings >= capacity) continue;
          const f = hasFlag(entity, ENTITY_FLAGS.underConstruction)
            ? 0.2 + (0.8 * entity.progress) / PROGRESS_FULL
            : 1;
          position.set(entity.x, (h * f) / 2, entity.y);
          scale.set(w, h * f, d);
          place(buildings, counts.buildings++, hex);
        }

        if (
          type.category !== "depot" &&
          (isSelected || entity.hp < type.hp) &&
          counts.bars < capacity
        ) {
          const ratio = type.hp > 0 ? entity.hp / type.hp : 0;
          position.set(entity.x, h + BAR_GAP, entity.y);
          scale.set(Math.max(BAR_MIN_SCALE, ratio), 1, 1);
          place(bars, counts.bars++, healthColor(ratio));
        }

        const target =
          entity.target === null ? undefined : byId.get(entity.target);
        if (
          hasFlag(entity, ENTITY_FLAGS.fired) &&
          target !== undefined &&
          tracerCount < capacity
        ) {
          const base = tracerCount * 2;
          tracerPositions.setXYZ(base, entity.x, TRACER_Y, entity.y);
          tracerPositions.setXYZ(base + 1, target.x, TRACER_Y, target.y);
          color.setHex(ownerColor(entity.owner));
          tracerColors.setXYZ(base, color.r, color.g, color.b);
          tracerColors.setXYZ(base + 1, color.r, color.g, color.b);
          tracerCount++;
        }
      }

      finish(units, counts.units);
      finish(buildings, counts.buildings);
      finish(ghosts, counts.ghosts);
      finish(bars, counts.bars);
      tracerGeometry.setDrawRange(0, tracerCount * 2);
      tracerPositions.needsUpdate = true;
      tracerColors.needsUpdate = true;
    },
  };
}
