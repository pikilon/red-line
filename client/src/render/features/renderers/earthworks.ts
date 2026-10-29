import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from "three";
import type { FeatureContext, FeatureInstance } from "../layers";
import { registerFeatureRenderer } from "../registry";
import { setFinishedTrenches } from "../trenchDepth";

/** Spec 35: trenches soldiers dig (family `earthwork`). A dark trench floor
 *  between two earth parapets; the parapets rise with the digging (state 2
 *  just started, 1 half dug, 0 finished, which adds a row of sandbags). */

const FLOOR = new MeshLambertMaterial({ color: 0x3b2c1e });
const EARTH = new MeshLambertMaterial({ color: 0x7a5a3a });
const SANDBAG = new MeshLambertMaterial({ color: 0xb9a57a });
const box = new BoxGeometry(1, 1, 1);

/** Parapet height in tiles per damage state (index = state). */
const PARAPET = [0.26, 0.16, 0.06];

function place(
  parent: Group,
  material: MeshLambertMaterial,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  const mesh = new Mesh(box, material);
  mesh.position.set(x, y + sy / 2, z);
  mesh.scale.set(sx, sy, sz);
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function createEarthworks(
  instances: readonly FeatureInstance[],
  ctx: FeatureContext,
): Group {
  const group = new Group();
  group.name = "earthworks";
  setFinishedTrenches(instances.filter((i) => i.state === 0));
  for (const instance of instances) {
    const cx = instance.x + instance.width / 2;
    const cz = instance.y + instance.height / 2;
    const ground = ctx.elevation.at(cx, cz);
    // The long side runs along the wider footprint axis.
    const alongX = instance.width >= instance.height;
    const length = alongX ? instance.width : instance.height;
    const depth = alongX ? instance.height : instance.width;
    const parapet = PARAPET[Math.min(instance.state, 2)] ?? 0.04;
    const trench = new Group();
    trench.position.set(cx, ground, cz);
    if (!alongX) trench.rotation.y = Math.PI / 2;
    place(trench, FLOOR, 0, 0.005, 0, length * 0.92, 0.01, depth * 0.5);
    for (const side of [-1, 1]) {
      const z = side * depth * 0.36;
      place(trench, EARTH, 0, 0, z, length * 0.96, parapet, depth * 0.22);
      if (instance.state === 0) {
        place(trench, SANDBAG, 0, parapet, z, length * 0.9, 0.07, depth * 0.16);
      }
    }
    group.add(trench);
  }
  return group;
}

registerFeatureRenderer("earthwork", createEarthworks);
