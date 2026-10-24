import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  type Texture,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RULES, type TypeDef, typeDef } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  NEUTRAL,
} from "../sim/matchSnapshot";
import type { Animator } from "./animation";
import { createCageMaterial, createCageTexture } from "./cage";
import { applyFacade, enableFacades, facadeTextureIds } from "./facades";
import {
  addBandAttribute,
  bandsOf,
  createFlagRenderer,
  enableBands,
} from "./flags";
import {
  applyBodyTextures,
  applyLivery,
  bodyMapsOf,
  boxProjectUvs,
  createBodyMaterial,
  DARK_MASK,
  type GeneratedTextures,
  isInfantry,
  MARK_MASK,
  VEHICLE_TILE,
} from "./generatedTextures";
import { angleToYaw } from "./heading";
import {
  addLiveryAttribute,
  createLiveryTexture,
  FLAG_ON_TURRET,
  type Footprint,
  type Livery,
  liveryOf,
  SPLIT_ROOF,
  turretFootprint,
  Z_ON_BOW,
  Z_ON_TURRET,
} from "./liveries";
import type {
  MaterialName,
  ModelPart,
  ModelRegistry,
  TypeModel,
} from "./models";
import { createSuspension, LEVEL_POSE } from "./suspension";

export const OWNER_COLORS = [0x1d5fe0, 0xe01b1b] as const;
export const NEUTRAL_COLOR = 0x8b5a2b;
export const SELECTED_COLOR = 0xfacc15;
export const SCAFFOLD_COLOR = 0xc8a165;
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
const SCAFFOLD_BEAM = 0.03;
const UP = new Vector3(0, 1, 0);

/** Folded launcher pod, radians about the hinge (negative lowers the front). */
const LAUNCHER_STOWED = -1.05;
/** Dozer blade raised from its modelled ground pose (negative lifts the front). */
const BLADE_RAISED = -0.5;
/** Blade raise-and-lower cycle while the dozer builds, in Hz. */
const BLADE_WORK_HZ = 0.8;

/** Pitch of the articulated model part: a launcher folds flat while its
 *  vehicle drives; a dozer blade rests raised, drops to the ground when
 *  driving and cycles up and down while the dozer works in place. */
function articulationOf(
  articulation: TypeDef["articulation"],
  moving: number,
  working: boolean,
  nowMs: number,
): number {
  if (articulation === "launcher") return LAUNCHER_STOWED * moving;
  if (articulation !== "blade") return 0;
  if (working) {
    const cycle =
      0.5 + 0.5 * Math.sin((nowMs / 1000) * BLADE_WORK_HZ * 2 * Math.PI);
    return BLADE_RAISED * (1 - cycle);
  }
  return BLADE_RAISED * (1 - moving);
}

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
  readonly group: Group; // children: units, buildings, models, ghosts, bars
  readonly units: InstancedMesh;
  readonly buildings: InstancedMesh;
  readonly ghosts: InstancedMesh;
  readonly bars: InstancedMesh;
  /** Shot segments of the frame, kept off the scene: projectiles replace the
   *  one-frame lines (spec 17 §7.6); AC-03-54 still reads the segments. */
  readonly tracers: LineSegments;
  /** Lazily created instanced meshes of the types with a loaded `.glb`. */
  readonly models: readonly ModelInstance[];
  /** Scaffolding around buildings under construction (spec 09 §5). */
  readonly scaffolds: InstancedMesh;
  /** Applies (or, with null, removes) the generated model textures. */
  setGeneratedTextures(textures: GeneratedTextures | null): void;
  update(
    entities: readonly EntityState[],
    selected: ReadonlySet<number>,
    nowMs?: number,
  ): void;
}

interface MeshSlot extends ModelInstance {
  count: number;
  /** Per-instance `bandOn` of a `team` slot with flag bands (spec 16 §5). */
  bandOn?: InstancedBufferAttribute;
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

/** `geometry` as non-indexed with a constant `color` attribute, multiplied by
 *  the baked ambient occlusion of its `COLOR_0` when present (spec 10 §5). */
function withColor(
  geometry: BufferGeometry,
  hex: number,
  dark: number,
): BufferGeometry {
  const source =
    geometry.index !== null ? geometry.toNonIndexed() : geometry.clone();
  const position = source.getAttribute("position");
  const occlusion = source.hasAttribute("color")
    ? source.getAttribute("color")
    : null;
  const colors = new Float32Array(position.count * 3);
  const color = new Color(hex);
  for (let i = 0; i < position.count; i++) {
    colors[i * 3] = color.r * (occlusion?.getX(i) ?? 1);
    colors[i * 3 + 1] = color.g * (occlusion?.getY(i) ?? 1);
    colors[i * 3 + 2] = color.b * (occlusion?.getZ(i) ?? 1);
  }
  source.setAttribute("color", new Float32BufferAttribute(colors, 3));
  source.setAttribute(
    DARK_MASK,
    new Float32BufferAttribute(new Float32Array(position.count).fill(dark), 1),
  );
  return source;
}

/** `darkMask` of each opaque part: paint texture, dark metal or flat mark. */
const SURFACE_MASK = { body: 0, team: 0, dark: 1, mark: MARK_MASK } as const;

/** `body`, `dark` and `mark` merged into one vertex-coloured opaque geometry. */
function opaqueGeometry(
  parts: ReadonlyMap<MaterialName, ModelPart>,
  teamAsBody = false,
): BufferGeometry | null {
  const sources: BufferGeometry[] = [];
  const bodyColor = parts.get("body")?.color;
  for (const material of ["body", "team", "dark", "mark"] as const) {
    if (material === "team" && !teamAsBody) continue;
    const part = parts.get(material);
    if (part === undefined) continue;
    // Vehicles paint their `team` parts (skirts, ERA) in the body colour.
    const color = material === "team" ? (bodyColor ?? part.color) : part.color;
    sources.push(withColor(part.geometry, color, SURFACE_MASK[material]));
  }
  const first = sources[0];
  if (first === undefined) return null;
  const merged =
    sources.length === 1 ? first : (mergeGeometries(sources, false) ?? first);
  return boxProjectUvs(merged);
}

/** `team` is shaded by its `COLOR_0` occlusion when the geometry has one;
 *  `flatShading` is false for the smooth limbs of infantry (spec 18 §3). */
function modelMaterial(
  material: MaterialName,
  geometry: BufferGeometry,
  flatShading: boolean,
): MeshLambertMaterial {
  return material === "team"
    ? new MeshLambertMaterial({
        color: 0xffffff,
        vertexColors: geometry.hasAttribute("color"),
        flatShading,
      })
    : createBodyMaterial(flatShading);
}

/** Unit box scaffolding frame (spec 09 §5): the 12 edges of a unit box plus 4
 *  horizontal beams around the middle (y = 0.5), 16 beams of cross-section
 *  `SCAFFOLD_BEAM` merged into one geometry, centred on the origin with its
 *  base at y = 0. */
export function scaffoldGeometry(): BufferGeometry {
  const b = SCAFFOLD_BEAM;
  const beams: BoxGeometry[] = [];
  // 4 vertical edges at the corners, from the base (y = 0) to the top (y = 1).
  for (const px of [-0.5, 0.5]) {
    for (const pz of [-0.5, 0.5]) {
      const edge = new BoxGeometry(b, 1, b);
      edge.translate(px, 0.5, pz);
      beams.push(edge);
    }
  }
  // 4 bottom (y = 0) and 4 top (y = 1) edges: two along x, two along z.
  for (const y of [0, 1]) {
    for (const pz of [-0.5, 0.5]) {
      const edge = new BoxGeometry(1, b, b);
      edge.translate(0, y, pz);
      beams.push(edge);
    }
    for (const px of [-0.5, 0.5]) {
      const edge = new BoxGeometry(b, b, 1);
      edge.translate(px, y, 0);
      beams.push(edge);
    }
  }
  // 4 horizontal beams around the middle (y = 0.5).
  for (const pz of [-0.5, 0.5]) {
    const beam = new BoxGeometry(1, b, b);
    beam.translate(0, 0.5, pz);
    beams.push(beam);
  }
  for (const px of [-0.5, 0.5]) {
    const beam = new BoxGeometry(b, b, 1);
    beam.translate(px, 0.5, 0);
    beams.push(beam);
  }
  return (
    mergeGeometries(
      beams.map((beam) => beam.toNonIndexed()),
      false,
    ) ?? new BufferGeometry()
  );
}

/** Default animator: no recoil, no lift. Keeps the renderer output unchanged
 *  when no animator is supplied (spec 09 §4). */
const NO_ANIMATOR: Animator = {
  recordShots() {},
  pose(): { recoil: number; lift: number } {
    return { recoil: 0, lift: 0 };
  },
};

export function createEntityRenderer(
  capacity: number,
  models?: ModelRegistry,
  animator: Animator = NO_ANIMATOR,
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
  const scaffolds = instanced(
    scaffoldGeometry(),
    new MeshBasicMaterial({ color: SCAFFOLD_COLOR }),
    capacity,
  );
  scaffolds.visible = false;
  // Fallback boxes cast and receive shadows while scaffolding only receives
  // them (spec 10 AC-10-08): the building under construction keeps casting its
  // growing shadow, but its scaffolding frame does not. The ghosts and bars
  // stay out of the shadow pass.
  units.castShadow = true;
  units.receiveShadow = true;
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  scaffolds.castShadow = false;
  scaffolds.receiveShadow = true;
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
  tracers.visible = false;

  const flags = createFlagRenderer(capacity);
  const group = new Group();
  group.add(units, buildings, ghosts, bars, scaffolds, flags.group);

  const matrix = new Matrix4();
  const turretMatrix = new Matrix4();
  const recoilTranslation = new Matrix4();
  const pivotMatrix = new Matrix4();
  const rotationMatrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const color = new Color();
  const byId = new Map<number, EntityState>();
  const suspension = createSuspension();
  const tilt = new Euler();
  const slots: MeshSlot[] = [];
  const byType = new Map<string, TypeSlots>();
  let generated: GeneratedTextures | null = null;

  /** The roof area the turret of `model` covers, for the Z (spec 13 §3). */
  function turretOccluders(model: TypeModel): Footprint[] {
    // Only the body of the turret hides the roof; the gun barrel does not.
    const body = model.turret.get("body");
    const geometries = body === undefined ? [] : [body.geometry];
    if (geometries.length === 0) return [];
    const box = new Box3();
    for (const geometry of geometries) {
      geometry.computeBoundingBox();
      if (geometry.boundingBox !== null) box.union(geometry.boundingBox);
    }
    return [turretFootprint(box, model.pivot)];
  }

  let cageMap: Texture | null = null;
  function cageTexture(): Texture {
    cageMap ??= createCageTexture();
    return cageMap;
  }

  const liveryTextures = new Map<Livery, Texture>();
  function liveryTexture(livery: Livery): Texture {
    let texture = liveryTextures.get(livery);
    if (texture === undefined) {
      texture = createLiveryTexture(livery);
      liveryTextures.set(livery, texture);
    }
    return texture;
  }

  /** Applies the current generated textures to one `body` slot (spec 12 §6). */
  function texturize(slot: MeshSlot): void {
    if (slot.material !== "body") return;
    const material = slot.mesh.material as MeshLambertMaterial;
    const type = RULES.types.find((entry) => entry.id === slot.typeId);
    if (generated === null || type === undefined) {
      applyBodyTextures(material, undefined, undefined);
      applyFacade(material, null);
      return;
    }
    const facade = facadeTextureIds(type.id, type.category);
    const wall = facade === null ? undefined : generated[facade.wall];
    if (facade !== null && wall !== undefined) {
      applyBodyTextures(material, wall, generated["dark-metal"]);
      applyFacade(material, generated[facade.roof] ?? wall);
      return;
    }
    const { paint, bump } = bodyMapsOf(
      generated,
      type.id,
      type.category,
      type.armor,
    );
    applyBodyTextures(material, paint, generated["dark-metal"], bump);
    applyFacade(material, null);
  }

  function createSlots(
    typeId: string,
    model: TypeModel,
    kind: ModelGroup,
  ): MeshSlot[] {
    const parts = kind === "turret" ? model.turret : model.parts;
    const created: MeshSlot[] = [];
    const type = RULES.types.find((entry) => entry.id === typeId);
    const livery =
      type === undefined ? null : liveryOf(type.id, type.category, type.armor);
    const opaque = opaqueGeometry(parts, livery !== null);
    const infantry =
      type !== undefined && isInfantry(type.category, type.armor);
    if (opaque !== null && livery !== null) {
      boxProjectUvs(opaque, VEHICLE_TILE);
      addLiveryAttribute(
        opaque,
        livery,
        kind === "hull" ? turretOccluders(model) : [],
        {
          turret: kind === "turret",
          turretFlag: FLAG_ON_TURRET.has(typeId),
          hasTurret: model.turret.size > 0,
          zOnTurret: Z_ON_TURRET.has(typeId),
          splitRoof: SPLIT_ROOF.has(typeId),
          zOnBow: Z_ON_BOW.has(typeId),
        },
      );
    }
    const bands = type === undefined ? null : bandsOf(type.id, type.category);
    const teamSource = parts.get("team")?.geometry;
    const team =
      teamSource !== undefined && bands !== null
        ? addBandAttribute(teamSource.clone())
        : teamSource;
    let bandOn: InstancedBufferAttribute | undefined;
    if (team !== undefined && bands !== null) {
      bandOn = new InstancedBufferAttribute(
        new Float32Array(capacity).fill(1),
        1,
      );
      team.setAttribute("bandOn", bandOn);
    }
    const definitions: readonly [MaterialName, BufferGeometry | undefined][] = [
      ["body", opaque ?? undefined],
      // Vehicles carry their flag instead of a team stripe (spec 13 §5).
      ["team", livery === null ? team : undefined],
      ["cage", parts.get("cage")?.geometry],
    ];
    for (const [material, geometry] of definitions) {
      if (geometry === undefined) continue;
      const mesh = new InstancedMesh(
        geometry,
        material === "cage"
          ? createCageMaterial(cageTexture())
          : modelMaterial(material, geometry, !infantry),
        capacity,
      );
      mesh.count = 0;
      mesh.frustumCulled = true;
      mesh.castShadow = material !== "cage";
      mesh.receiveShadow = true;
      const slot: MeshSlot = { typeId, group: kind, material, mesh, count: 0 };
      if (material === "team" && bands !== null && bandOn !== undefined) {
        slot.bandOn = bandOn;
        enableBands(mesh.material as MeshLambertMaterial, bands);
      }
      const bodyColor = parts.get("body")?.color;
      if (
        material === "body" &&
        bodyColor !== undefined &&
        type !== undefined &&
        facadeTextureIds(type.id, type.category) !== null
      ) {
        enableFacades(mesh.material as MeshLambertMaterial, bodyColor);
      }
      if (material === "body" && livery !== null) {
        applyLivery(
          mesh.material as MeshLambertMaterial,
          liveryTexture(livery),
        );
      }
      texturize(slot);
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
    if (slot.bandOn !== undefined) {
      // Flag bands show unless selected (spec 16 §5).
      const selected = hex === SELECTED_COLOR;
      slot.mesh.setColorAt(index, color.setHex(selected ? hex : 0xffffff));
      slot.bandOn.setX(index, selected ? 0 : 1);
      slot.bandOn.needsUpdate = true;
    } else if (slot.material === "team") {
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
    scaffolds,
    get models() {
      return slots;
    },
    setGeneratedTextures(textures) {
      generated = textures;
      for (const slot of slots) texturize(slot);
    },
    update(entities, selected, nowMs = 0) {
      const counts = { units: 0, buildings: 0, ghosts: 0, bars: 0 };
      byId.clear();
      for (const entity of entities) byId.set(entity.id, entity);
      suspension.prune(new Set(byId.keys()));
      for (const slot of slots) slot.count = 0;
      let tracerCount = 0;
      let scaffoldCount = 0;

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
        const heading = {
          yaw: angleToYaw(entity.heading),
          turretYaw: angleToYaw(entity.turretAngle),
        };

        const pose = animator.pose(entity, nowMs);
        const recoil = pose.recoil;
        const body =
          type.category === "unit" && type.armor !== 0
            ? suspension.update(
                entity.id,
                entity.x,
                entity.y,
                heading.yaw,
                nowMs,
              )
            : LEVEL_POSE;
        const lift = pose.lift + body.shake;
        const working =
          hasFlag(entity, ENTITY_FLAGS.moving) && body.moving < 0.05;
        const articulationPitch = articulationOf(
          type.articulation,
          body.moving,
          working,
          nowMs,
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
            position.set(entity.x, lift, entity.y);
            rotation.setFromEuler(
              tilt.set(body.pitch, hullYaw, body.roll, "YXZ"),
            );
            scale.set(1, f, 1);
            matrix.compose(position, rotation, scale);
            place(slot, slot.count, hex);
          }
          for (const slot of typeSlots.turret) {
            if (slot.count >= capacity) continue;
            const composeTurret = (): Matrix4 => {
              position.set(entity.x, lift, entity.y);
              rotation.setFromEuler(
                tilt.set(body.pitch, hullYaw, body.roll, "YXZ"),
              );
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
              rotationMatrix.makeRotationX(articulationPitch);
              turretMatrix.multiply(rotationMatrix);
              recoilTranslation.makeTranslation(0, 0, -recoil);
              turretMatrix.multiply(recoilTranslation);
              return turretMatrix;
            };
            place(slot, slot.count, hex, composeTurret);
          }
        }

        if (
          !isGhost &&
          type.category !== "unit" &&
          hasFlag(entity, ENTITY_FLAGS.underConstruction) &&
          scaffoldCount < capacity
        ) {
          position.set(entity.x, 0, entity.y);
          scale.set(w, h, d);
          matrix.compose(position, rotation.identity(), scale);
          scaffolds.setMatrixAt(scaffoldCount, matrix);
          scaffoldCount++;
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
      finish(scaffolds, scaffoldCount);
      for (const slot of slots) {
        finish(slot.mesh, slot.count);
        slot.mesh.computeBoundingSphere();
      }
      scaffolds.visible = scaffoldCount > 0;
      tracerGeometry.setDrawRange(0, tracerCount * 2);
      tracerPositions.needsUpdate = true;
      tracerColors.needsUpdate = true;
      flags.update(entities, nowMs);
    },
  };
}
