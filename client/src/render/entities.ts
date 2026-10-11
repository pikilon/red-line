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
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { typeDef } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  NEUTRAL,
} from "../sim/matchSnapshot";
import { createHeadingTracker } from "./heading";
import type {
  MaterialName,
  ModelPart,
  ModelRegistry,
  TypeModel,
} from "./models";

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
const UP = new Vector3(0, 1, 0);

export type ModelGroup = "hull" | "turret";

/** One lazily created `InstancedMesh` of a loaded model (spec 06 §5). */
export interface ModelInstance {
  readonly typeId: string;
  readonly group: ModelGroup;
  /** `body` also carries the merged `dark` geometry with vertex colours. */
  readonly material: MaterialName;
  readonly mesh: InstancedMesh;
}

export interface EntityRenderer {
  readonly group: Group; // children: units, buildings, models, ghosts, bars, tracers
  readonly units: InstancedMesh;
  readonly buildings: InstancedMesh;
  readonly ghosts: InstancedMesh;
  readonly bars: InstancedMesh;
  readonly tracers: LineSegments;
  /** Lazily created instanced meshes of the types with a loaded `.glb`. */
  readonly models: readonly ModelInstance[];
  update(entities: readonly EntityState[], selected: ReadonlySet<number>): void;
}

interface MeshSlot extends ModelInstance {
  count: number;
}

interface TypeSlots {
  readonly hull: readonly MeshSlot[];
  readonly turret: readonly MeshSlot[];
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

/** `geometry` as non-indexed with a constant `color` attribute. */
function withColor(geometry: BufferGeometry, hex: number): BufferGeometry {
  const source =
    geometry.index !== null ? geometry.toNonIndexed() : geometry.clone();
  const position = source.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const color = new Color(hex);
  for (let i = 0; i < position.count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  source.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return source;
}

/** `body` and `dark` merged into one vertex-coloured opaque geometry. */
function opaqueGeometry(
  parts: ReadonlyMap<MaterialName, ModelPart>,
): BufferGeometry | null {
  const sources: BufferGeometry[] = [];
  for (const material of ["body", "dark"] as const) {
    const part = parts.get(material);
    if (part !== undefined) {
      sources.push(withColor(part.geometry, part.color));
    }
  }
  const first = sources[0];
  if (first === undefined) return null;
  if (sources.length === 1) return first;
  return mergeGeometries(sources, false) ?? first;
}

function modelMaterial(material: MaterialName): MeshLambertMaterial {
  return material === "team"
    ? new MeshLambertMaterial({ color: 0xffffff, flatShading: true })
    : new MeshLambertMaterial({ vertexColors: true, flatShading: true });
}

export function createEntityRenderer(
  capacity: number,
  models?: ModelRegistry,
): EntityRenderer {
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
  const turretMatrix = new Matrix4();
  const pivotMatrix = new Matrix4();
  const rotationMatrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const color = new Color();
  const byId = new Map<number, EntityState>();
  const headings = createHeadingTracker();
  const slots: MeshSlot[] = [];
  const byType = new Map<string, TypeSlots>();

  function createSlots(
    typeId: string,
    model: TypeModel,
    kind: ModelGroup,
  ): MeshSlot[] {
    const parts = kind === "turret" ? model.turret : model.parts;
    const created: MeshSlot[] = [];
    const opaque = opaqueGeometry(parts);
    const definitions: readonly [MaterialName, BufferGeometry | undefined][] = [
      ["body", opaque ?? undefined],
      ["team", parts.get("team")?.geometry],
    ];
    for (const [material, geometry] of definitions) {
      if (geometry === undefined) continue;
      const mesh = new InstancedMesh(
        geometry,
        modelMaterial(material),
        capacity,
      );
      mesh.count = 0;
      mesh.frustumCulled = true;
      const slot: MeshSlot = { typeId, group: kind, material, mesh, count: 0 };
      created.push(slot);
      slots.push(slot);
      group.add(mesh);
    }
    return created;
  }

  function slotsFor(typeId: string, model: TypeModel): TypeSlots {
    const existing = byType.get(typeId);
    if (existing !== undefined) return existing;
    const created: TypeSlots = {
      hull: createSlots(typeId, model, "hull"),
      turret: createSlots(typeId, model, "turret"),
    };
    byType.set(typeId, created);
    return created;
  }

  function place(
    slot: MeshSlot,
    index: number,
    hex: number,
    composeTurret: (() => Matrix4) | null = null,
  ): void {
    if (slot.material === "team") {
      slot.mesh.setColorAt(index, color.setHex(hex));
    } else {
      slot.mesh.setColorAt(index, color.setHex(0xffffff));
    }
    slot.mesh.setMatrixAt(
      index,
      composeTurret === null ? matrix : composeTurret(),
    );
    slot.count = index + 1;
  }

  function placeBox(mesh: InstancedMesh, index: number, hex: number): void {
    matrix.compose(position, rotation.identity(), scale);
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
    get models() {
      return slots;
    },
    update(entities, selected) {
      const counts = { units: 0, buildings: 0, ghosts: 0, bars: 0 };
      byId.clear();
      for (const entity of entities) byId.set(entity.id, entity);
      for (const slot of slots) slot.count = 0;
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
        const model = models?.get(type.id) ?? null;
        const isFallback =
          model === null ||
          model.fallback ||
          (model.parts.size === 0 && model.turret.size === 0);

        if (isGhost) {
          if (counts.ghosts < capacity) {
            position.set(entity.x, h / 2, entity.y);
            scale.set(w, h, d);
            placeBox(ghosts, counts.ghosts++, hex);
          }
          continue;
        }

        const target =
          entity.target === null ? null : (byId.get(entity.target) ?? null);
        const heading = headings.update(
          entity.id,
          entity.x,
          entity.y,
          target === null ? null : { x: target.x, y: target.y },
        );

        if (isFallback || model === null) {
          if (type.category === "unit") {
            if (counts.units < capacity) {
              position.set(entity.x, h / 2, entity.y);
              scale.set(w, h, d);
              placeBox(units, counts.units++, hex);
            }
          } else {
            if (counts.buildings < capacity) {
              const f = hasFlag(entity, ENTITY_FLAGS.underConstruction)
                ? 0.2 + (0.8 * entity.progress) / PROGRESS_FULL
                : 1;
              position.set(entity.x, (h * f) / 2, entity.y);
              scale.set(w, h * f, d);
              placeBox(buildings, counts.buildings++, hex);
            }
          }
        } else {
          const f = hasFlag(entity, ENTITY_FLAGS.underConstruction)
            ? 0.2 + (0.8 * entity.progress) / PROGRESS_FULL
            : 1;
          const typeSlots = slotsFor(type.id, model);
          const hullYaw = type.category === "unit" ? heading.yaw : 0;
          const turretYaw = heading.turretYaw;
          for (const slot of typeSlots.hull) {
            if (slot.count >= capacity) continue;
            position.set(entity.x, 0, entity.y);
            rotation.setFromAxisAngle(UP, hullYaw);
            scale.set(1, f, 1);
            matrix.compose(position, rotation, scale);
            place(slot, slot.count, hex);
          }
          for (const slot of typeSlots.turret) {
            if (slot.count >= capacity) continue;
            const composeTurret = (): Matrix4 => {
              position.set(entity.x, 0, entity.y);
              rotation.setFromAxisAngle(UP, hullYaw);
              scale.set(1, f, 1);
              turretMatrix.compose(position, rotation, scale);
              pivotMatrix.makeTranslation(
                model.pivot.x,
                model.pivot.y,
                model.pivot.z,
              );
              turretMatrix.multiply(pivotMatrix);
              rotationMatrix.makeRotationY(turretYaw - hullYaw);
              turretMatrix.multiply(rotationMatrix);
              return turretMatrix;
            };
            place(slot, slot.count, hex, composeTurret);
          }
        }

        if (
          type.category !== "depot" &&
          (isSelected || entity.hp < type.hp) &&
          counts.bars < capacity
        ) {
          const ratio = type.hp > 0 ? entity.hp / type.hp : 0;
          position.set(entity.x, h + BAR_GAP, entity.y);
          scale.set(Math.max(BAR_MIN_SCALE, ratio), 1, 1);
          placeBox(bars, counts.bars++, healthColor(ratio));
        }

        if (
          hasFlag(entity, ENTITY_FLAGS.fired) &&
          target !== null &&
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
      for (const slot of slots) {
        finish(slot.mesh, slot.count);
        slot.mesh.computeBoundingSphere();
      }
      tracers.visible = tracerCount > 0;
      tracerGeometry.setDrawRange(0, tracerCount * 2);
      tracerPositions.needsUpdate = true;
      tracerColors.needsUpdate = true;
    },
  };
}
