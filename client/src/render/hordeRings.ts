/**
 * Horde rings (spec 56 §5.1): a faint ring on the ground under every unit
 * that is in a horde, so the player sees the bonus is active. One instanced
 * mesh, one draw call.
 */
import {
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  RingGeometry,
} from "three";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";
import { groundY } from "./elevation";

const CAPACITY = 512;
const RADIUS = 0.42;
const LIFT = 0.03;

export interface HordeRings {
  readonly group: Group;
  update(
    entities: readonly EntityState[],
    altitudeOf: (entity: EntityState) => number,
  ): void;
  /** Rings drawn last update, for tests. */
  count(): number;
}

export function createHordeRings(): HordeRings {
  const group = new Group();
  const geometry = new RingGeometry(RADIUS * 0.82, RADIUS, 24);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({
    color: 0xffd35a,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new InstancedMesh(geometry, material, CAPACITY);
  mesh.frustumCulled = false;
  mesh.count = 0;
  group.add(mesh);
  const matrix = new Matrix4();
  return {
    group,
    count: () => mesh.count,
    update(entities, altitudeOf) {
      let n = 0;
      for (const entity of entities) {
        if (
          n >= CAPACITY ||
          !hasFlag(entity, ENTITY_FLAGS.horde) ||
          hasFlag(entity, ENTITY_FLAGS.inside) ||
          hasFlag(entity, ENTITY_FLAGS.ghost)
        )
          continue;
        matrix.makeTranslation(
          entity.x,
          groundY(entity.x, entity.y) + altitudeOf(entity) + LIFT,
          entity.y,
        );
        mesh.setMatrixAt(n++, matrix);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
