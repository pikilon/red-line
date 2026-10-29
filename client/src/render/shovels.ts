import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Spec 35: the shovel a soldier digs a trench with, and the clod of earth it
 *  lifts. Client only: the soldier's rig bends over it (`RigState.dig`), this
 *  draws the tool between his hands and the ground. */

const WOOD = new MeshLambertMaterial({ color: 0x7a5634 });
const EARTH = new MeshLambertMaterial({ color: 0x5b4029 });

/** A shovel of unit length hanging from its grip at the origin down -Y: the
 *  handle, then the blade at the far end. */
function shovelGeometry() {
  const handle = new CylinderGeometry(0.03, 0.03, 0.78, 5);
  handle.translate(0, -0.39, 0);
  const blade = new BoxGeometry(0.22, 0.24, 0.025);
  blade.translate(0, -0.9, 0);
  const merged = mergeGeometries([handle.toNonIndexed(), blade.toNonIndexed()]);
  return merged ?? handle;
}

/** Shovel length in tiles. */
const LENGTH = 0.34;
/** Clod radius in tiles. */
const CLOD = 0.035;

export interface Shovels {
  readonly group: Group;
  /** Forgets last frame's shovels. */
  begin(): void;
  /** A soldier at (x, ground, z) facing `yaw` (model +Z forward), `height`
   *  tiles tall, `dig` 0..1 into the work, `stroke` -1 blade in the ground ..
   *  1 earth thrown. */
  add(
    x: number,
    ground: number,
    z: number,
    yaw: number,
    height: number,
    dig: number,
    stroke: number,
    /** Digging from the trench floor: the earth is thrown up over the edge. */
    deep?: boolean,
  ): void;
  /** A load of earth (`size` tiles) at a point: a dozer's blade full. */
  addLoad(x: number, y: number, z: number, size: number): void;
  finish(): void;
}

export function createShovels(capacity: number): Shovels {
  const shovels = new InstancedMesh(shovelGeometry(), WOOD, capacity);
  const clods = new InstancedMesh(new SphereGeometry(1, 6, 4), EARTH, capacity);
  for (const mesh of [shovels, clods]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
  }
  const group = new Group();
  group.name = "shovels";
  group.add(shovels, clods);

  const grip = new Vector3();
  const tip = new Vector3();
  const along = new Vector3();
  const down = new Vector3(0, -1, 0);
  const turn = new Quaternion();
  const matrix = new Matrix4();
  const scale = new Vector3();
  let count = 0;
  let clodCount = 0;

  return {
    group,
    begin() {
      count = 0;
      clodCount = 0;
    },
    add(x, ground, z, yaw, height, dig, stroke, deep = false) {
      if (count >= capacity || dig <= 0.05) return;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      // 0 with the blade in the ground, 1 at the top of the throw.
      const up = (stroke + 1) / 2;
      grip.set(
        x + fx * 0.07,
        ground + height * (0.42 + 0.08 * up),
        z + fz * 0.07,
      );
      tip.set(
        x + fx * (0.24 - 0.06 * up),
        ground + 0.01 + (deep ? 0.34 : 0.16) * up * dig,
        z + fz * (0.24 - 0.06 * up),
      );
      along.subVectors(tip, grip).normalize();
      turn.setFromUnitVectors(down, along);
      scale.setScalar(LENGTH * dig);
      matrix.compose(grip, turn, scale);
      shovels.setMatrixAt(count++, matrix);
      if (up > 0.35 && clodCount < capacity) {
        // A clod of earth rides the blade on the way up.
        tip.y += CLOD * 0.6;
        scale.set(CLOD * 1.3, CLOD, CLOD * 1.1);
        matrix.compose(tip, turn.identity(), scale);
        clods.setMatrixAt(clodCount++, matrix);
      }
    },
    addLoad(x, y, z, size) {
      if (clodCount >= capacity || size <= 0) return;
      tip.set(x, y, z);
      scale.set(size * 1.4, size * 0.7, size);
      matrix.compose(tip, turn.identity(), scale);
      clods.setMatrixAt(clodCount++, matrix);
    },
    finish() {
      shovels.count = count;
      clods.count = clodCount;
      shovels.instanceMatrix.needsUpdate = true;
      clods.instanceMatrix.needsUpdate = true;
    },
  };
}
