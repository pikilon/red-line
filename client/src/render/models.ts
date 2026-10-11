import {
  BoxGeometry,
  type BufferGeometry,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TypeDef } from "../rules";

export const MATERIAL_NAMES = ["body", "team", "dark"] as const;
export type MaterialName = (typeof MATERIAL_NAMES)[number];

/** One geometry of a model, split per material (spec 06 §5). */
export interface ModelPart {
  readonly material: MaterialName;
  readonly geometry: BufferGeometry;
  /** Source material colour as 0xRRGGBB; `team` is always white. */
  readonly color: number;
}

/** The parts of one type: hull and (optionally) turret, keyed by material. */
export interface TypeModel {
  readonly parts: ReadonlyMap<MaterialName, ModelPart>;
  readonly turret: ReadonlyMap<MaterialName, ModelPart>;
  /** Turret ring in the hull frame; zero when the type has no turret. */
  readonly pivot: Vector3;
  /** True when the `.glb` is missing and the renderer uses the box. */
  readonly fallback: boolean;
}

export interface ModelRegistry {
  get(typeId: string): TypeModel | undefined;
}

/** The subset of `THREE.GLTFLoader` that `loadModels` needs; tests fake it. */
export interface ModelLoader {
  loadAsync(url: string): Promise<{ scene: Object3D }>;
}

interface BucketEntry {
  readonly geometries: BufferGeometry[];
  readonly color: number;
}

type Bucket = Map<MaterialName, BucketEntry>;

function isMaterialName(name: string | undefined): name is MaterialName {
  return (
    name !== undefined && (MATERIAL_NAMES as readonly string[]).includes(name)
  );
}

function isMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true;
}

function isDescendant(node: Object3D, ancestor: Object3D): boolean {
  for (
    let current: Object3D | null = node.parent;
    current !== null;
    current = current.parent
  ) {
    if (current === ancestor) return true;
  }
  return false;
}

function addToBucket(
  bucket: Bucket,
  material: MaterialName,
  geometry: BufferGeometry,
  color: number,
): void {
  const entry = bucket.get(material);
  if (entry === undefined) {
    bucket.set(material, { geometries: [geometry], color });
    return;
  }
  entry.geometries.push(geometry);
}

function mergeBucket(bucket: Bucket): ReadonlyMap<MaterialName, ModelPart> {
  const parts = new Map<MaterialName, ModelPart>();
  for (const [material, entry] of bucket) {
    const first = entry.geometries[0];
    if (first === undefined) continue;
    const geometry =
      entry.geometries.length === 1
        ? first
        : (mergeGeometries(entry.geometries, false) ?? first);
    parts.set(material, { material, geometry, color: entry.color });
  }
  return parts;
}

/** Hull and turret parts of a loaded glTF scene, in model-local frames. */
function extractModel(scene: Object3D): TypeModel | null {
  scene.updateMatrixWorld(true);
  const turretNode = scene.getObjectByName("turret") ?? null;
  const pivot = new Vector3();
  if (turretNode !== null) pivot.setFromMatrixPosition(turretNode.matrixWorld);
  const sceneInverse = scene.matrixWorld.clone().invert();
  const turretInverse =
    turretNode === null ? null : turretNode.matrixWorld.clone().invert();
  const hull: Bucket = new Map();
  const turret: Bucket = new Map();
  let found = false;

  scene.traverse((object) => {
    if (!isMesh(object)) return;
    const material = Array.isArray(object.material)
      ? object.material[0]
      : object.material;
    const name = material?.name;
    if (!isMaterialName(name)) return;
    found = true;
    const geometry = object.geometry.clone();
    const standard = material as MeshStandardMaterial;
    const color = standard.color?.getHex() ?? 0xffffff;
    if (
      turretNode !== null &&
      turretInverse !== null &&
      isDescendant(object, turretNode)
    ) {
      geometry.applyMatrix4(turretInverse.clone().multiply(object.matrixWorld));
      addToBucket(turret, name, geometry, color);
    } else {
      geometry.applyMatrix4(sceneInverse.clone().multiply(object.matrixWorld));
      addToBucket(hull, name, geometry, color);
    }
  });

  if (!found) return null;
  return {
    parts: mergeBucket(hull),
    turret: mergeBucket(turret),
    pivot,
    fallback: false,
  };
}

/** The Phase 2 box of `type`, centred on its footprint and resting on y = 0. */
export function boxModel(type: TypeDef): TypeModel {
  const [width, height, depth] = type.render.size.map(
    (value) => value / 100,
  ) as [number, number, number];
  const geometry = new BoxGeometry(width, height, depth).translate(
    0,
    height / 2,
    0,
  );
  const parts = new Map<MaterialName, ModelPart>([
    ["team", { material: "team", geometry, color: 0xffffff }],
  ]);
  return { parts, turret: new Map(), pivot: new Vector3(), fallback: true };
}

async function loadType(
  type: TypeDef,
  loader: ModelLoader,
): Promise<TypeModel> {
  try {
    const gltf = await loader.loadAsync(`models/${type.id}.glb`);
    const model = extractModel(gltf.scene);
    if (model === null) throw new Error("no named materials");
    return model;
  } catch (error) {
    console.warn(
      `models: falling back to the box for ${type.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return boxModel(type);
  }
}

/** Loads `models/<id>.glb` for every type; a failure falls back to the box. */
export async function loadModels(
  types: readonly TypeDef[],
  loader: ModelLoader = new GLTFLoader(),
): Promise<ModelRegistry> {
  const models = new Map<string, TypeModel>();
  await Promise.all(
    types.map(async (type) => {
      models.set(type.id, await loadType(type, loader));
    }),
  );
  return { get: (typeId) => models.get(typeId) };
}
