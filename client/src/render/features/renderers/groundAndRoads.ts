import { Group, type Object3D } from "three";
import {
  createGroundMaterialTexture,
  GROUND_MATERIALS,
} from "../ground/materialTextures";
import {
  cellsNear,
  GROUND_LIFT,
  groundMesh,
  overlayGeometry,
  ROAD_LIFT,
  roadMesh,
} from "../ground/overlay";
import { bakeRoads } from "../ground/roadBake";
import { bakeSplat } from "../ground/splat";
import type { FeatureContext, TerrainLayers } from "../layers";
import { registerGroundLayerRenderer } from "../registry";

/** Spec 26 Phase 3: ground materials with blended borders, and roads. */

const SEED = 11;

/** Ground bytes in the layer's own order -> index of the material texture
 *  (`names.ground` decides; an unknown name reads as grass). */
function materialIndices(names: readonly string[]): Uint8Array {
  const known: readonly string[] = GROUND_MATERIALS;
  const map = new Uint8Array(256);
  names.forEach((name, byte) => {
    const index = known.indexOf(name);
    map[byte] = index < 0 ? 0 : index;
  });
  // Without names (tests, old maps) the bytes are the shipped order.
  if (names.length === 0) for (let i = 0; i < 256; i++) map[i] = Math.min(i, 8);
  return map;
}

export function groundAndRoads(
  layers: TerrainLayers,
  ctx: FeatureContext,
): Object3D | null {
  const { width, height } = layers;
  const group = new Group();
  group.name = "ground-and-roads";

  // Ground materials. Grass is what the terrain already draws, so only the
  // cells near some other material need the overlay.
  const toMaterial = materialIndices(layers.names.ground);
  const materials = new Uint8Array(layers.ground.length);
  for (let i = 0; i < materials.length; i++) {
    materials[i] = toMaterial[layers.ground[i] ?? 0] ?? 0;
  }
  const groundCells = cellsNear(
    width,
    height,
    (x, y) => materials[y * width + x] !== 0,
  );
  if (groundCells.length > 0) {
    const mesh = groundMesh(
      overlayGeometry(
        groundCells,
        width,
        height,
        ctx.elevation,
        GROUND_LIFT,
        true,
      ),
      createGroundMaterialTexture(SEED),
      bakeSplat(materials, width, height, SEED),
      width,
      height,
    );
    group.add(mesh);
  }

  // Roads.
  const image = bakeRoads(layers.roads, width, height, SEED + 2);
  if (image !== null) {
    const roadCells = cellsNear(
      width,
      height,
      (x, y) => (layers.roads[y * width + x] ?? 0) !== 0,
    );
    group.add(
      roadMesh(
        overlayGeometry(
          roadCells,
          width,
          height,
          ctx.elevation,
          ROAD_LIFT,
          false,
        ),
        image,
      ),
    );
  }
  return group.children.length > 0 ? group : null;
}

registerGroundLayerRenderer(groundAndRoads);
