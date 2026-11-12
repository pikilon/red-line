import {
  type BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FeatureContext, FeatureInstance } from "./layers";

export type TerrainAssetId =
  | "terrain-tree"
  | "terrain-house"
  | "terrain-bridge"
  | "terrain-rock";

export interface LoadedTerrainModel {
  readonly geometry: BufferGeometry;
  readonly map: Texture | null;
  readonly height: number;
}

const cache = new Map<TerrainAssetId, Promise<LoadedTerrainModel | null>>();

function canFetchInBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    typeof fetch === "function"
  );
}

function extractTerrainGlb(
  root: Object3D,
  wind = 0,
): LoadedTerrainModel | null {
  let found: Mesh | null = null;
  root.traverse((obj) => {
    if (found === null && (obj as Mesh).isMesh) {
      found = obj as Mesh;
    }
  });
  if (found === null) return null;
  const mesh = found as Mesh;
  const geometry = mesh.geometry.clone();
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox?.min.y ?? 0;
  const maxY = geometry.boundingBox?.max.y ?? 1;
  if (Math.abs(minY) > 1e-4) {
    geometry.translate(0, -minY, 0);
    geometry.computeBoundingBox();
  }
  const height = Math.max(0.05, maxY - minY);
  const pos = geometry.getAttribute("position");
  if (pos !== undefined) {
    const sway = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, pos.getY(i) / height));
      sway[i] = t * t * wind;
    }
    geometry.setAttribute("aSway", new Float32BufferAttribute(sway, 1));
    // Ensure white vertex colors so embedded texture renders in full color
    if (!geometry.hasAttribute("color")) {
      const colors = new Float32Array(pos.count * 3);
      colors.fill(1);
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    }
  }
  const rawMat = Array.isArray(mesh.material)
    ? mesh.material[0]
    : mesh.material;
  const stdMat = rawMat as MeshStandardMaterial | undefined;
  const map = stdMat?.map ?? null;
  if (map !== null) {
    map.colorSpace = SRGBColorSpace;
  }
  return { geometry, map, height };
}

export function loadTerrainModel(
  id: TerrainAssetId,
  wind = 0,
): Promise<LoadedTerrainModel | null> {
  if (!canFetchInBrowser()) return Promise.resolve(null);
  const existing = cache.get(id);
  if (existing !== undefined) return existing;
  const baseUrl = import.meta.env?.BASE_URL ?? "/";
  const url = `${baseUrl}models/terrain/${id}.glb`;
  const loader = new GLTFLoader();
  const promise = new Promise<LoadedTerrainModel | null>((resolve) => {
    loader.load(
      url,
      (gltf) => resolve(extractTerrainGlb(gltf.scene, wind)),
      undefined,
      () => resolve(null),
    );
  });
  cache.set(id, promise);
  return promise;
}

const Y_AXIS = new Vector3(0, 1, 0);

/** Attaches an InstancedMesh of realistic Meshy 3D terrain props (`terrain-house`
 *  or `terrain-rock`) onto a civil feature group once loaded in the browser. */
export function attachMeshyCivilInstances(
  group: Object3D,
  assetId: "terrain-house" | "terrain-rock",
  instances: readonly FeatureInstance[],
  ctx: FeatureContext,
  filterPred: (inst: FeatureInstance) => boolean,
): void {
  const matching = instances.filter(filterPred);
  if (matching.length === 0 || !canFetchInBrowser()) return;
  void loadTerrainModel(assetId, 0).then((loaded) => {
    if (loaded === null) return;
    const mat = new MeshStandardMaterial({
      map: loaded.map,
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.05,
    });
    const mesh = new InstancedMesh(loaded.geometry, mat, matching.length);
    const m = new Matrix4();
    const q = new Quaternion();
    const tint = new Color(1, 1, 1);
    matching.forEach((inst, idx) => {
      let ground = Number.POSITIVE_INFINITY;
      for (let cy = inst.y; cy <= inst.y + inst.height; cy++) {
        for (let cx = inst.x; cx <= inst.x + inst.width; cx++) {
          ground = Math.min(ground, ctx.elevation.corner(cx, cy));
        }
      }
      const cx = inst.x + inst.width / 2;
      const cz = inst.y + inst.height / 2;
      const sx = Math.max(0.7, inst.width * 0.88);
      const sz = Math.max(0.7, inst.height * 0.88);
      const sy =
        assetId === "terrain-house"
          ? Math.max(0.85, Math.min(sx, sz) * 0.75)
          : Math.max(0.45, Math.min(sx, sz) * 0.65);
      q.setFromAxisAngle(Y_AXIS, (inst.rot * Math.PI) / 2);
      m.compose(
        new Vector3(cx, ground, cz),
        q,
        new Vector3(sx, sy / loaded.height, sz),
      );
      mesh.setMatrixAt(idx, m);
      mesh.setColorAt(idx, tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${group.name}-meshy-${assetId}`;
    group.add(mesh);
  });
}
