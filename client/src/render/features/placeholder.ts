import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";
import {
  type FeatureContext,
  type FeatureFamily,
  type FeatureInstance,
  type TerrainLayers,
  WATER_DEEP,
  WATER_DEPTH_MASK,
} from "./layers";

/** Placeholder look of each family until its own renderer registers: a plain
 *  coloured box per instance, sized to the footprint. `render.color` and
 *  `render.height` of the feature type override these. */
const FAMILY_LOOK: Record<FeatureFamily, { color: string; height: number }> = {
  vegetation: { color: "#3f7a3a", height: 2 },
  building: { color: "#b9a58b", height: 1.5 },
  prop: { color: "#8a6a3c", height: 0.7 },
  port: { color: "#6b7078", height: 0.8 },
  wall: { color: "#9a9a92", height: 0.8 },
  bridge: { color: "#8a8478", height: 0.3 },
  earthwork: { color: "#5a4330", height: 0.1 },
};

/** Boxes leave a gap to their neighbours so footprints read apart. */
const FOOTPRINT_FILL = 0.9;

const numberOf = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** One InstancedMesh (one draw call) with a box per instance, standing on the
 *  lowest ground corner under its footprint. */
export function placeholderFeatures(
  instances: readonly FeatureInstance[],
  ctx: FeatureContext,
): Object3D {
  const box = new BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const mesh = new InstancedMesh(
    box,
    new MeshStandardMaterial({ roughness: 0.9 }),
    Math.max(1, instances.length),
  );
  mesh.count = instances.length;
  const matrix = new Matrix4();
  const colour = new Color();
  instances.forEach((instance, index) => {
    const look = FAMILY_LOOK[instance.type.family];
    const height = numberOf(instance.type.render.height, look.height);
    let ground = Number.POSITIVE_INFINITY;
    for (let cy = instance.y; cy <= instance.y + instance.height; cy++) {
      for (let cx = instance.x; cx <= instance.x + instance.width; cx++) {
        ground = Math.min(ground, ctx.elevation.corner(cx, cy));
      }
    }
    matrix.compose(
      new Vector3(
        instance.x + instance.width / 2,
        ground,
        instance.y + instance.height / 2,
      ),
      new Quaternion(),
      new Vector3(
        instance.width * FOOTPRINT_FILL,
        height,
        instance.height * FOOTPRINT_FILL,
      ),
    );
    mesh.setMatrixAt(index, matrix);
    const written = instance.type.render.color;
    mesh.setColorAt(
      index,
      colour.set(typeof written === "string" ? written : look.color),
    );
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `features-${instances[0]?.type.family ?? "empty"}`;
  return mesh;
}

/** Water above the ground, so the surface never z-fights the terrain. */
const WATER_LIFT = 0.06;
const SHALLOW_COLOUR = new Color("#4f9fc4");
const DEEP_COLOUR = new Color("#1f5f94");

/** One merged mesh (one draw call): a flat translucent quad per water cell,
 *  lighter in the shallows, draped on the ground corners. */
export function placeholderWater(
  layers: TerrainLayers,
  ctx: FeatureContext,
): Object3D | null {
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y < layers.height; y++) {
    for (let x = 0; x < layers.width; x++) {
      const byte = layers.water[y * layers.width + x] ?? 0;
      if ((byte & WATER_DEPTH_MASK) === 0) continue;
      const colour =
        (byte & WATER_DEPTH_MASK) === WATER_DEEP ? DEEP_COLOUR : SHALLOW_COLOUR;
      const base = positions.length / 3;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        positions.push(
          x + dx,
          ctx.elevation.corner(x + dx, y + dy) + WATER_LIFT,
          y + dy,
        );
        colours.push(colour.r, colour.g, colour.b);
      }
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  if (indices.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  mesh.name = "water";
  mesh.renderOrder = 1;
  return mesh;
}

/** Ground colouring is a later task: nothing is drawn on top of the terrain. */
export function placeholderGround(): Object3D | null {
  return null;
}
