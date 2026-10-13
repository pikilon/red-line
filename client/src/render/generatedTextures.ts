import {
  type BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  MeshLambertMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  UnsignedByteType,
} from "three";

/** Spec 12: the images of `client/public/textures/<id>.webp`. */
export const GENERATED_TEXTURE_IDS = [
  "grass",
  "dirt",
  "rock",
  "ua-paint",
  "ru-paint",
  "ua-concrete",
  "ru-concrete",
  "dark-metal",
  "ua-wall",
  "ua-roof",
] as const;
export type GeneratedTextureId = (typeof GENERATED_TEXTURE_IDS)[number];
export type GeneratedTextures = Partial<Record<GeneratedTextureId, Texture>>;

/** The subset of `THREE.TextureLoader` that the loader needs; tests fake it. */
export interface TextureSource {
  loadAsync(url: string): Promise<Texture>;
}

/** The texture repeats every this many model-space units (spec 12 §4). */
export const MODEL_TILE = 1.5;

/** Loads `textures/<id>.webp` for every id; a file that fails is skipped. */
export async function loadGeneratedTextures(
  source: TextureSource = new TextureLoader(),
): Promise<GeneratedTextures> {
  const loaded: GeneratedTextures = {};
  await Promise.all(
    GENERATED_TEXTURE_IDS.map(async (id) => {
      try {
        const texture = await source.loadAsync(`textures/${id}.webp`);
        texture.colorSpace = SRGBColorSpace;
        texture.wrapS = RepeatWrapping;
        texture.wrapT = RepeatWrapping;
        texture.anisotropy = 4;
        loaded[id] = texture;
      } catch {
        // A missing candidate keeps the procedural look for that slot.
      }
    }),
  );
  return loaded;
}

/** Sets the `uv` of `geometry` by box projection (spec 12 §4): the dominant
 *  axis of each vertex normal drops out. Models have no usable UVs. */
export function boxProjectUvs(geometry: BufferGeometry): BufferGeometry {
  if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uvs = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const ax = Math.abs(normal.getX(i));
    const ay = Math.abs(normal.getY(i));
    const az = Math.abs(normal.getZ(i));
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) {
      u = position.getZ(i);
      v = position.getY(i);
    } else if (ay >= az) {
      u = position.getX(i);
      v = position.getZ(i);
    } else {
      u = position.getX(i);
      v = position.getY(i);
    }
    uvs[i * 2] = u / MODEL_TILE;
    uvs[i * 2 + 1] = v / MODEL_TILE;
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  return geometry;
}

/** Texture id of a type's `body` material: `<faction>-paint` for vehicles,
 *  `<faction>-concrete` for buildings and depots (spec 12 §6). */
export function bodyTextureId(
  typeId: string,
  category: string,
): GeneratedTextureId {
  // Type ids start with the faction prefix; neutral types use `ua`.
  const prefix = typeId.startsWith("ru-") ? "ru" : "ua";
  return `${prefix}-${category === "unit" ? "paint" : "concrete"}` as GeneratedTextureId;
}

/** 1x1 white: keeps the vertex colour where a texture is missing. */
function whiteTexture(): DataTexture {
  const texture = new DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const WHITE = whiteTexture();

/** Per-vertex 0 (body) / 1 (dark) attribute name of the merged geometry. */
export const DARK_MASK = "darkMask";

/** The vertex-coloured `body` material. Its map is the paint or concrete
 *  texture, and vertices with `darkMask` = 1 sample the `dark-metal` texture
 *  instead, so the merged `body`+`dark` mesh stays one draw call. */
export function createBodyMaterial(): MeshLambertMaterial {
  const material = new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
  });
  const darkMap = { value: WHITE as Texture };
  const liveryMap = { value: null as Texture | null };
  material.userData.darkMap = darkMap;
  material.userData.liveryMap = liveryMap;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.darkMap = darkMap;
    shader.uniforms.liveryMap = liveryMap;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nattribute float ${DARK_MASK};\nvarying float vDark;\nattribute vec3 livery;\nvarying vec3 vLivery;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvDark = ${DARK_MASK};\nvLivery = livery;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform sampler2D darkMap;\nuniform sampler2D liveryMap;\nvarying float vDark;\nvarying vec3 vLivery;",
      )
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
  vec4 paintColor = texture2D( map, vMapUv );
  vec4 darkColor = texture2D( darkMap, vMapUv );
  diffuseColor *= mix( paintColor, darkColor, vDark );
#endif`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  vec4 liveryColor = texture2D( liveryMap, vLivery.xy );
  float liveryWeight = liveryColor.a * vLivery.z * ( 1.0 - vDark ) * 0.9;
  diffuseColor.rgb = mix( diffuseColor.rgb, liveryColor.rgb, liveryWeight );`,
      );
  };
  material.customProgramCacheKey = () => "body-dark-livery-mask";
  return material;
}

/** Sets the livery texture of a body material; `null` removes the livery. */
export function applyLivery(
  material: MeshLambertMaterial,
  texture: Texture | null,
): void {
  const liveryMap = material.userData.liveryMap as
    | { value: Texture | null }
    | undefined;
  if (liveryMap !== undefined) liveryMap.value = texture;
}

/** Sets the paint/concrete map and the dark-metal map of a body material;
 *  both undefined restores the flat vertex colours. */
export function applyBodyTextures(
  material: MeshLambertMaterial,
  paint: Texture | undefined,
  dark: Texture | undefined,
): void {
  const darkMap = material.userData.darkMap as { value: Texture } | undefined;
  if (darkMap !== undefined) darkMap.value = dark ?? WHITE;
  const map = paint ?? (dark === undefined ? null : WHITE);
  if (material.map !== map) {
    material.map = map;
    material.needsUpdate = true;
  }
}
