import {
  Box3,
  BoxGeometry,
  type BufferGeometry,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TypeDef } from "../rules";

export const MATERIAL_NAMES = ["body", "team", "dark", "cage", "mark"] as const;
export type MaterialName = (typeof MATERIAL_NAMES)[number];

/** One geometry of a model, split per material (spec 06 §5). */
export interface ModelPart {
  readonly material: MaterialName;
  readonly geometry: BufferGeometry;
  /** Source material colour as 0xRRGGBB; `team` is always white. */
  readonly color: number;
  /** Embedded UV-mapped baseColor texture from a realistic GLB (Meshy). */
  readonly map?: Texture | null;
}

/** Name prefix of the glTF nodes that are rigid limbs (spec 20). */
export const LIMB_PREFIX = "limb_";

/** One rigid limb of an articulated model (infantry, spec 20): its geometry
 *  is relative to its own joint, which hangs from `parent`'s joint. */
export interface LimbModel {
  /** Node name without `LIMB_PREFIX`, e.g. `g_thigh_l`. */
  readonly name: string;
  /** Name of the limb it hangs from, null for the hull. */
  readonly parent: string | null;
  /** Joint in the parent's frame (the hull frame without a parent). */
  readonly local: Vector3;
  /** Joint in the hull frame. */
  readonly world: Vector3;
  readonly parts: ReadonlyMap<MaterialName, ModelPart>;
}

/** Name of the glTF node of a single rotor or propeller (spec 43); a model
 *  with several names them `prop_0`, `prop_1`... Each has its origin on the hub. */
export const PROP_PREFIX = "prop";

/** One rotor of a flyer: its geometry is relative to its hub, which sits at
 *  `hub` in the hull frame, and it spins about `axis`. */
export interface PropModel {
  /** Node name, `prop` or `prop_<n>`. */
  readonly name: string;
  readonly hub: Vector3;
  /** Axis the blades turn about: the thinnest extent of the rotor, so a
   *  helicopter rotor turns about Y and a pusher propeller about its nose. */
  readonly axis: "x" | "y" | "z";
  readonly parts: ReadonlyMap<MaterialName, ModelPart>;
}

/** True for the glTF node name of a rotor: `prop` or `prop_<n>`. */
export function isPropName(name: string): boolean {
  return name === PROP_PREFIX || /^prop_\d+$/.test(name);
}

/** The parts of one type: hull and (optionally) turret, keyed by material. */
export interface TypeModel {
  readonly parts: ReadonlyMap<MaterialName, ModelPart>;
  readonly turret: ReadonlyMap<MaterialName, ModelPart>;
  /** Rigid limbs, parents before children; absent or empty without any. */
  readonly limbs?: readonly LimbModel[];
  /** Rotors and propellers, kept apart from the hull so they can spin. */
  readonly props?: readonly PropModel[];
  /** Marker nodes (`anchor_*`) in the hull frame, by name. */
  readonly anchors?: ReadonlyMap<string, Vector3>;
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
  map: Texture | null;
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

function extractMap(material: MeshStandardMaterial): Texture | null {
  const map = material.map ?? null;
  if (map !== null) {
    map.colorSpace = SRGBColorSpace;
  }
  return map;
}

function addToBucket(
  bucket: Bucket,
  material: MaterialName,
  geometry: BufferGeometry,
  color: number,
  map: Texture | null = null,
): void {
  const entry = bucket.get(material);
  if (entry === undefined) {
    bucket.set(material, { geometries: [geometry], color, map });
    return;
  }
  if (entry.map === null && map !== null) entry.map = map;
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
    parts.set(material, {
      material,
      geometry,
      color: entry.color,
      ...(entry.map === null ? {} : { map: entry.map }),
    });
  }
  return parts;
}

function isLimbNode(object: Object3D | null): boolean {
  return object?.name.startsWith(LIMB_PREFIX) === true;
}

/** The nearest limb node at or above `object`, null when it is not in one. */
function limbOf(object: Object3D): Object3D | null {
  for (
    let current: Object3D | null = object;
    current !== null;
    current = current.parent
  ) {
    if (isLimbNode(current)) return current;
  }
  return null;
}

/** The nearest rotor node at or above `object`, null when it is not in one. */
function propOf(object: Object3D): Object3D | null {
  for (
    let current: Object3D | null = object;
    current !== null;
    current = current.parent
  ) {
    if (isPropName(current.name)) return current;
  }
  return null;
}

/** Axis along which `parts` are thinnest. */
function thinnestAxis(
  parts: ReadonlyMap<MaterialName, ModelPart>,
): "x" | "y" | "z" {
  const box = new Box3();
  for (const part of parts.values()) {
    part.geometry.computeBoundingBox();
    if (part.geometry.boundingBox !== null)
      box.union(part.geometry.boundingBox);
  }
  const size = box.getSize(new Vector3());
  // A tie goes to Z: a rotor as thick as it is wide is a nose-mounted one.
  if (size.z <= size.x && size.z <= size.y) return "z";
  return size.y <= size.x ? "y" : "x";
}

/** Rotors of `scene` with their geometry relative to their hubs. */
function extractProps(scene: Object3D): PropModel[] {
  const nodes: Object3D[] = [];
  scene.traverse((object) => {
    if (isPropName(object.name)) nodes.push(object);
  });
  const sceneInverse = scene.matrixWorld.clone().invert();
  const props: PropModel[] = [];
  for (const node of nodes) {
    const bucket: Bucket = new Map();
    const inverse = node.matrixWorld.clone().invert();
    node.traverse((object) => {
      if (!isMesh(object) || propOf(object) !== node) return;
      const material = Array.isArray(object.material)
        ? object.material[0]
        : object.material;
      const name = material?.name;
      if (!isMaterialName(name)) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
      const standard = material as MeshStandardMaterial;
      const color = standard.color?.getHex();
      addToBucket(
        bucket,
        name,
        geometry,
        color ?? 0xffffff,
        extractMap(standard),
      );
    });
    const parts = mergeBucket(bucket);
    if (parts.size === 0) continue;
    props.push({
      name: node.name,
      hub: new Vector3().setFromMatrixPosition(
        sceneInverse.clone().multiply(node.matrixWorld),
      ),
      axis: thinnestAxis(parts),
      parts,
    });
  }
  return props;
}

/** Limbs of `scene` with their geometry, parents before children. */
function extractLimbs(scene: Object3D): LimbModel[] {
  const nodes: Object3D[] = [];
  scene.traverse((object) => {
    if (isLimbNode(object)) nodes.push(object);
  });
  const sceneInverse = scene.matrixWorld.clone().invert();
  const limbs: LimbModel[] = [];
  for (const node of nodes) {
    const bucket: Bucket = new Map();
    const inverse = node.matrixWorld.clone().invert();
    node.traverse((object) => {
      if (!isMesh(object) || limbOf(object) !== node) return;
      const material = Array.isArray(object.material)
        ? object.material[0]
        : object.material;
      const name = material?.name;
      if (!isMaterialName(name)) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
      const standard = material as MeshStandardMaterial;
      const color = standard.color?.getHex();
      addToBucket(
        bucket,
        name,
        geometry,
        color ?? 0xffffff,
        extractMap(standard),
      );
    });
    const parentNode = limbOf(node.parent ?? node);
    const world = new Vector3().setFromMatrixPosition(
      sceneInverse.clone().multiply(node.matrixWorld),
    );
    const parentWorld = new Vector3();
    if (parentNode !== null) {
      parentWorld.setFromMatrixPosition(
        sceneInverse.clone().multiply(parentNode.matrixWorld),
      );
    }
    limbs.push({
      name: node.name.slice(LIMB_PREFIX.length),
      parent:
        parentNode === null ? null : parentNode.name.slice(LIMB_PREFIX.length),
      local: world.clone().sub(parentWorld),
      world,
      parts: mergeBucket(bucket),
    });
  }
  // Depth-first traversal already lists a parent before its children.
  return limbs;
}

/** Hull and turret parts of a loaded glTF scene, in model-local frames. */
function extractModel(scene: Object3D): TypeModel | null {
  scene.updateMatrixWorld(true);
  const limbs = extractLimbs(scene);
  const props = extractProps(scene);
  const anchors = new Map<string, Vector3>();
  const sceneFromWorld = scene.matrixWorld.clone().invert();
  scene.traverse((object) => {
    if (object.name.startsWith("anchor_")) {
      anchors.set(
        object.name,
        new Vector3().setFromMatrixPosition(
          sceneFromWorld.clone().multiply(object.matrixWorld),
        ),
      );
    }
  });
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
    if (limbOf(object) !== null || propOf(object) !== null) return;
    const geometry = object.geometry.clone();
    const standard = material as MeshStandardMaterial;
    const color = standard.color?.getHex() ?? 0xffffff;
    const map = extractMap(standard);
    if (
      turretNode !== null &&
      turretInverse !== null &&
      isDescendant(object, turretNode)
    ) {
      geometry.applyMatrix4(turretInverse.clone().multiply(object.matrixWorld));
      addToBucket(turret, name, geometry, color, map);
    } else {
      geometry.applyMatrix4(sceneInverse.clone().multiply(object.matrixWorld));
      addToBucket(hull, name, geometry, color, map);
    }
  });

  if (!found) return null;
  return {
    parts: mergeBucket(hull),
    turret: mergeBucket(turret),
    limbs,
    props,
    anchors,
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
