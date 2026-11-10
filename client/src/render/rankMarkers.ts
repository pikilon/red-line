/**
 * Rank chevrons (spec 50 §4): one, two or three gold chevrons over every
 * promoted unit on show, by its health bar, as Zero Hour draws them. A
 * unit that has just been promoted flashes its new chevrons for a moment.
 * Instanced billboards: one draw call per rank.
 */
import {
  DataTexture,
  DoubleSide,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  type Quaternion,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
} from "three";
import { typeDef } from "../rules";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";
import { MAX_RANK, rankOf } from "../sim/veterancy";
import { groundY } from "./elevation";

/** Height over the unit's top, tiles: just over the health bar (at 0.3). */
const ABOVE = 0.52;
/** How far left of the unit's centre the marker sits, tiles: clear of the
 *  ammo pips and the jam mark of the air overlay. */
const ASIDE = 0.36;
export const RANK_MARK_SIZE = 0.34;
/** A fresh promotion pulses for this long. */
export const PROMOTION_FLASH_MS = 1500;
const CAPACITY = 256;
const SIZE = 64;

export interface RankMarkers {
  readonly group: Group;
  /** Draws the chevrons of `entities`; `altitudeOf` is each one's drawn
   *  height and `facing` the camera orientation. */
  update(
    entities: readonly EntityState[],
    altitudeOf: (entity: EntityState) => number,
    nowMs: number,
    facing: Quaternion,
  ): void;
  /** Markers drawn last update per rank (index 0 is veteran). */
  counts(): number[];
  /** Units mid-flash after a promotion, for tests. */
  flashing(nowMs: number): number;
}

/** Marker scale at `elapsedMs` after a promotion: a decaying pulse, 1 after it. */
export function promotionScale(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= PROMOTION_FLASH_MS) return 1;
  const left = 1 - elapsedMs / PROMOTION_FLASH_MS;
  return 1 + 1.2 * left * Math.abs(Math.cos((elapsedMs / 1000) * Math.PI * 4));
}

/** `count` stacked gold chevrons with a dark outline, drawn pixel by pixel. */
function createChevronTexture(count: number): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const step = 15;
  const top = (SIZE - (count - 1) * step - 22) / 2;
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const x = i + 0.5;
      const y = j + 0.5;
      let best = Number.POSITIVE_INFINITY;
      for (let n = 0; n < count; n++) {
        // A "^" with its apex at (32, top + n * step).
        const line = top + n * step + Math.abs(x - 32) * 0.7;
        if (Math.abs(x - 32) <= 24)
          best = Math.min(best, Math.abs(y - line - 4));
      }
      let color: [number, number, number, number] = [0, 0, 0, 0];
      if (best <= 6.5) color = [24, 18, 4, 235];
      if (best <= 4) color = [255, 204, 51, 255];
      // The frame is drawn y-down; the texture's rows run y-up.
      data.set(color, ((SIZE - 1 - j) * SIZE + i) * 4);
    }
  }
  const texture = new DataTexture(
    data,
    SIZE,
    SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createRankMarkers(): RankMarkers {
  const group = new Group();
  group.name = "rank-markers";
  const meshes: InstancedMesh[] = [];
  for (let rank = 1; rank <= MAX_RANK; rank++) {
    const mesh = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: createChevronTexture(rank),
        transparent: true,
        side: DoubleSide,
        depthTest: false,
        toneMapped: false,
      }),
      CAPACITY,
    );
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 11;
    meshes.push(mesh);
    group.add(mesh);
  }

  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const right = new Vector3();
  /** Last rank seen per entity id, and when it last rose. */
  const ranks = new Map<number, number>();
  const promotedAt = new Map<number, number>();
  let drawn = [0, 0, 0];
  let primed = false;

  return {
    group,
    counts: () => [...drawn],
    flashing: (nowMs) =>
      [...promotedAt.values()].filter((at) => nowMs - at < PROMOTION_FLASH_MS)
        .length,
    update(entities, altitudeOf, nowMs, facing) {
      right.set(1, 0, 0).applyQuaternion(facing);
      const counts = [0, 0, 0];
      const seen = new Set<number>();
      for (const entity of entities) {
        const rank = rankOf(entity);
        seen.add(entity.id);
        const before = ranks.get(entity.id);
        // A unit first seen already promoted (a loaded game) does not flash.
        if (primed && before !== undefined && rank > before)
          promotedAt.set(entity.id, nowMs);
        ranks.set(entity.id, rank);
        if (
          rank === 0 ||
          hasFlag(entity, ENTITY_FLAGS.inside) ||
          hasFlag(entity, ENTITY_FLAGS.ghost)
        )
          continue;
        const slot = rank - 1;
        const mesh = meshes[slot];
        const index = counts[slot] ?? 0;
        if (mesh === undefined || index >= CAPACITY) continue;
        const height = typeDef(entity.kind).render.size[1] / 100;
        const size =
          RANK_MARK_SIZE *
          promotionScale(nowMs - (promotedAt.get(entity.id) ?? -Infinity));
        position
          .set(
            entity.x,
            groundY(entity.x, entity.y) + altitudeOf(entity) + height + ABOVE,
            entity.y,
          )
          .addScaledVector(right, -ASIDE);
        scale.set(size, size, 1);
        matrix.compose(position, facing, scale);
        mesh.setMatrixAt(index, matrix);
        counts[slot] = index + 1;
      }
      for (const id of [...ranks.keys()]) {
        if (!seen.has(id)) {
          ranks.delete(id);
          promotedAt.delete(id);
        }
      }
      primed = true;
      meshes.forEach((mesh, slot) => {
        mesh.count = counts[slot] ?? 0;
        mesh.visible = mesh.count > 0;
        mesh.instanceMatrix.needsUpdate = true;
      });
      drawn = counts;
    },
  };
}
