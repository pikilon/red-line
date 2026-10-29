import {
  AmbientLight,
  Box3,
  DirectionalLight,
  type Material,
  type Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Side of a rendered cameo in pixels (spec 41 §3.5). */
export const CAMEO_SIZE = 96;
const CAMEO_FOV_DEGREES = 28;
/** Three-quarter view: from the front-right, 35 degrees above the ground. */
const VIEW_DIRECTION = new Vector3(1, 0.85, 1).normalize();

/** Up to two capital letters naming a type, for the tile with no picture
 *  ("ua-power-plant" -> "PP", "ua-hq" -> "HQ", "ru-t-72b3" -> "T7"). */
export function cameoInitials(typeId: string): string {
  const words = typeId.split("-").filter((word) => word.length > 0);
  // The first word is the faction prefix ("ua", "ru") when there is more.
  const parts = words.length > 1 ? words.slice(1) : words;
  const letters =
    parts.length === 1
      ? (parts[0] ?? "").slice(0, 2)
      : parts.map((word) => word.charAt(0)).join("");
  return letters.slice(0, 2).toUpperCase();
}

/** Camera distance that keeps a sphere of `radius` inside the frame. */
export function fitDistance(radius: number, fovDegrees: number): number {
  const half = (fovDegrees * Math.PI) / 360;
  return (radius / Math.sin(half)) * 1.08;
}

/** Draws type `typeId` and resolves to an image URL, or null when it cannot. */
export type Rasterizer = (typeId: string) => Promise<string | null>;

export interface CameoStore {
  /** The cached image URL; null when the type has no picture; undefined while
   *  it has not been rendered yet. */
  peek(typeId: string): string | null | undefined;
  /** Renders the type once (later calls share the result) and resolves to its
   *  image URL, or null on failure. Renders run one at a time. */
  request(typeId: string): Promise<string | null>;
}

/** Lazy, serial, caching cameo store over `rasterize`. */
export function createCameoStore(rasterize: Rasterizer): CameoStore {
  const done = new Map<string, string | null>();
  const pending = new Map<string, Promise<string | null>>();
  let chain: Promise<unknown> = Promise.resolve();
  return {
    peek: (typeId) => done.get(typeId),
    request(typeId) {
      const known = pending.get(typeId);
      if (known !== undefined) return known;
      const job = chain.then(async () => {
        let url: string | null = null;
        try {
          url = await rasterize(typeId);
        } catch {
          url = null;
        }
        done.set(typeId, url);
        return url;
      });
      chain = job;
      pending.set(typeId, job);
      return job;
    },
  };
}

function disposeTree(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) for (const entry of material) entry.dispose();
    else material?.dispose();
  });
}

/** The browser rasterizer: one offscreen renderer, created on first use,
 *  draws each `models/<id>.glb` in a three-quarter view on a transparent
 *  background. */
export function createGlbRasterizer(): Rasterizer {
  let renderer: WebGLRenderer | null = null;
  const loader = new GLTFLoader();
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.4));
  const sun = new DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(2, 3, 1.5);
  scene.add(sun);
  const camera = new PerspectiveCamera(CAMEO_FOV_DEGREES, 1, 0.01, 1000);

  return async (typeId) => {
    const gltf = await loader.loadAsync(`models/${typeId}.glb`);
    renderer ??= new WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    const gl = renderer;
    gl.setPixelRatio(1);
    gl.setSize(CAMEO_SIZE, CAMEO_SIZE, false);
    gl.setClearColor(0x000000, 0);
    const model = gltf.scene;
    scene.add(model);
    try {
      model.updateMatrixWorld(true);
      const sphere = new Sphere();
      new Box3().setFromObject(model).getBoundingSphere(sphere);
      if (!(sphere.radius > 0)) return null;
      camera.position
        .copy(VIEW_DIRECTION)
        .multiplyScalar(fitDistance(sphere.radius, CAMEO_FOV_DEGREES))
        .add(sphere.center);
      camera.lookAt(sphere.center);
      camera.updateMatrixWorld();
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    } finally {
      scene.remove(model);
      disposeTree(model);
    }
  };
}

let shared: CameoStore | null = null;

/** The game-wide cameo store (renders with the browser's WebGL). */
export function gameCameos(): CameoStore {
  shared ??= createCameoStore(createGlbRasterizer());
  return shared;
}
