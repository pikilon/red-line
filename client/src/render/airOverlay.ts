/**
 * Selection overlays of the air war (spec 43), in the style of the health bars
 * of the unified HUD (spec 42): the radius of a selected jammer drawn on the
 * ground, a row of ammo pips over a selected sortie unit, and a warning mark
 * over any unit a jammer holds. Everything is instanced and billboarded, so
 * the cost is three draw calls however many units show.
 */
import {
  CircleGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  RingGeometry,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
} from "three";
import { typeDef } from "../rules";
import {
  type AirState,
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
} from "../sim/matchSnapshot";
import { groundY } from "./elevation";
import { ownerColor } from "./entities";

/** Pips filled with a round left and empty after a shot. */
export const PIP_FULL = 0xfacc15;
export const PIP_EMPTY = 0x6b7280;
export const PIP_SIZE = 0.15;
const PIP_GAP = 0.06;
/** Heights over the unit's top, tiles: the health bar sits at `BAR_GAP`. */
const PIPS_ABOVE = 0.48;
const JAM_ABOVE = 0.78;
const JAM_SIZE = 0.42;
/** Jam mark pulse, Hz. */
const JAM_PULSE_HZ = 1.6;
const RING_LIFT = 0.07;
const DISC_OPACITY = 0.1;
const CAPACITY = 256;
const RING_CAPACITY = 16;

export interface AirOverlay {
  readonly group: Group;
  readonly rings: InstancedMesh;
  readonly pips: InstancedMesh;
  readonly jams: InstancedMesh;
  /** Draws the overlays of `entities`; `altitudeOf` is each one's drawn
   *  height and `facing` the camera orientation (bars are billboards). */
  update(
    entities: readonly EntityState[],
    selected: ReadonlySet<number>,
    air: readonly AirState[],
    altitudeOf: (entity: EntityState) => number,
    nowMs: number,
    facing: Quaternion,
    player: number,
  ): void;
  /** Counts drawn last update, for tests and the perf panel. */
  counts(): { rings: number; pips: number; jams: number };
}

/** The pip colours of a clip of `clip` rounds with `ammo` left, in order. */
export function pipColors(ammo: number, clip: number): number[] {
  const full = Math.max(0, Math.min(clip, ammo));
  return Array.from({ length: clip }, (_, index) =>
    index < full ? PIP_FULL : PIP_EMPTY,
  );
}

/** The lightning bolt of the jam mark, in a 64 px frame. */
const BOLT: readonly (readonly [number, number])[] = [
  [36, 10],
  [20, 35],
  [31, 35],
  [27, 54],
  [44, 27],
  [33, 27],
];

function insidePolygon(
  x: number,
  y: number,
  polygon: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i] ?? [0, 0];
    const [xj, yj] = polygon[j] ?? [0, 0];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** A "signal lost" glyph: a dark disc with an amber ring and bolt, struck
 *  through in red. Built pixel by pixel so it needs no canvas. */
function createJamTexture(): DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = i + 0.5;
      const y = j + 0.5;
      const radius = Math.hypot(x - 32, y - 32);
      // The frame is drawn y-down; the texture's rows run y-up.
      const row = size - 1 - j;
      const k = (row * size + i) * 4;
      // Distance from the strike line (12, 52) to (52, 12).
      const slash = Math.abs(x + y - 64) / Math.SQRT2;
      let color: [number, number, number, number] = [0, 0, 0, 0];
      if (radius <= 29) color = [20, 22, 28, 217];
      if (radius <= 31 && radius >= 26.5) color = [255, 176, 32, 255];
      if (radius < 26.5 && insidePolygon(x, y, BOLT))
        color = [255, 176, 32, 255];
      if (radius <= 27 && slash <= 3) color = [255, 59, 48, 255];
      data.set(color, k);
    }
  }
  const texture = new DataTexture(
    data,
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function overlayMesh(
  geometry: PlaneGeometry | RingGeometry | CircleGeometry,
  material: MeshBasicMaterial,
  capacity: number,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export function createAirOverlay(): AirOverlay {
  const group = new Group();
  group.name = "air-overlay";
  const flat = (geometry: RingGeometry | CircleGeometry) =>
    geometry.rotateX(-Math.PI / 2);
  const ringMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  const rings = overlayMesh(
    flat(new RingGeometry(0.985, 1, 96)),
    ringMaterial,
    RING_CAPACITY,
  );
  rings.renderOrder = 9;
  const discs = overlayMesh(
    flat(new CircleGeometry(1, 64)),
    new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: DISC_OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    }),
    RING_CAPACITY,
  );
  discs.renderOrder = 8;
  const pips = overlayMesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      color: 0xffffff,
      side: DoubleSide,
      depthTest: false,
      toneMapped: false,
    }),
    CAPACITY,
  );
  pips.renderOrder = 10;
  const jams = overlayMesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      map: createJamTexture(),
      transparent: true,
      side: DoubleSide,
      depthTest: false,
      toneMapped: false,
    }),
    CAPACITY,
  );
  jams.renderOrder = 11;
  group.add(discs, rings, pips, jams);

  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const identity = new Quaternion();
  const right = new Vector3();
  const color = new Color();
  const clipOf = new Map<number, AirState>();
  let drawn = { rings: 0, pips: 0, jams: 0 };

  function finish(mesh: InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }

  return {
    group,
    rings,
    pips,
    jams,
    counts: () => ({ ...drawn }),
    update(entities, selected, air, altitudeOf, nowMs, facing, player) {
      clipOf.clear();
      for (const state of air) clipOf.set(state.id, state);
      right.set(1, 0, 0).applyQuaternion(facing);
      let ringCount = 0;
      let pipCount = 0;
      let jamCount = 0;
      for (const entity of entities) {
        if (hasFlag(entity, ENTITY_FLAGS.inside)) continue;
        const type = typeDef(entity.kind);
        const height = type.render.size[1] / 100;
        const base = groundY(entity.x, entity.y) + altitudeOf(entity) + height;
        const isSelected = selected.has(entity.id);

        if (
          isSelected &&
          type.jammer !== undefined &&
          ringCount < RING_CAPACITY
        ) {
          const radius = type.jammer.radiusCenti / 100;
          position.set(
            entity.x,
            groundY(entity.x, entity.y) + RING_LIFT,
            entity.y,
          );
          scale.set(radius, 1, radius);
          matrix.compose(position, identity, scale);
          rings.setMatrixAt(ringCount, matrix);
          discs.setMatrixAt(ringCount, matrix);
          rings.setColorAt(ringCount, color.setHex(ownerColor(entity.owner)));
          discs.setColorAt(ringCount, color);
          ringCount++;
        }

        const state = clipOf.get(entity.id);
        if (
          isSelected &&
          entity.owner === player &&
          state !== undefined &&
          state.clip > 0
        ) {
          const colors = pipColors(state.ammo, state.clip);
          const span = colors.length * PIP_SIZE + (colors.length - 1) * PIP_GAP;
          colors.forEach((hex, index) => {
            if (pipCount >= CAPACITY) return;
            const offset =
              -span / 2 + PIP_SIZE / 2 + index * (PIP_SIZE + PIP_GAP);
            position
              .set(entity.x, base + PIPS_ABOVE, entity.y)
              .addScaledVector(right, offset);
            scale.set(PIP_SIZE, PIP_SIZE, 1);
            matrix.compose(position, facing, scale);
            pips.setMatrixAt(pipCount, matrix);
            pips.setColorAt(pipCount, color.setHex(hex));
            pipCount++;
          });
        }

        if (hasFlag(entity, ENTITY_FLAGS.jammed) && jamCount < CAPACITY) {
          const pulse =
            1 + 0.15 * Math.sin((nowMs / 1000) * JAM_PULSE_HZ * Math.PI * 2);
          position.set(entity.x, base + JAM_ABOVE, entity.y);
          scale.set(JAM_SIZE * pulse, JAM_SIZE * pulse, 1);
          matrix.compose(position, facing, scale);
          jams.setMatrixAt(jamCount, matrix);
          jamCount++;
        }
      }
      finish(rings, ringCount);
      finish(discs, ringCount);
      finish(pips, pipCount);
      finish(jams, jamCount);
      drawn = { rings: ringCount, pips: pipCount, jams: jamCount };
    },
  };
}
