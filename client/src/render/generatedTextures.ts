import {
  type BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  MeshLambertMaterial,
  RepeatWrapping,
  RGBAFormat,
  ShaderChunk,
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
  "ua-skin",
  "ru-skin",
  "ua-skin-bump",
  "ru-skin-bump",
  "ua-wall",
  "ua-roof",
  "ua-camo",
  "ru-camo",
] as const;
export type GeneratedTextureId = (typeof GENERATED_TEXTURE_IDS)[number];
export type GeneratedTextures = Partial<Record<GeneratedTextureId, Texture>>;

/** The subset of `THREE.TextureLoader` that the loader needs; tests fake it. */
export interface TextureSource {
  loadAsync(url: string): Promise<Texture>;
}

/** The texture repeats every this many model-space units (spec 12 §4). */
export const MODEL_TILE = 1.5;

/** Vehicles are small: their skin repeats every this many model units (spec 15 §3). */
export const VEHICLE_TILE = 0.6;

/** Infantry camouflage repeats every this many model units, so its pixels
 *  are a few centimetres on a soldier (spec 17 §2). */
export const INFANTRY_TILE = 0.5;

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
export function boxProjectUvs(
  geometry: BufferGeometry,
  tile = MODEL_TILE,
): BufferGeometry {
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
    uvs[i * 2] = u / tile;
    uvs[i * 2 + 1] = v / tile;
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  return geometry;
}

/** How strongly the bump map perturbs the surface (spec 15 §3). */
export const BUMP_SCALE = 0.4;

const INFANTRY_ARMOR = 0;

/** True for infantry: units with the first armour class (spec 17 §2). */
export function isInfantry(category: string, armor: number): boolean {
  return category === "unit" && armor === INFANTRY_ARMOR;
}

/** Texture id of a type's `body` material: `<faction>-camo` for infantry,
 *  `<faction>-skin` for vehicles, `<faction>-concrete` for buildings and
 *  depots (spec 12 §6, spec 15 §3, spec 17 §2). */
export function bodyTextureId(
  typeId: string,
  category: string,
  armor = INFANTRY_ARMOR,
): GeneratedTextureId {
  // Type ids start with the faction prefix; neutral types use `ua`.
  const prefix = typeId.startsWith("ru-") ? "ru" : "ua";
  if (category !== "unit") return `${prefix}-concrete` as GeneratedTextureId;
  if (isInfantry(category, armor))
    return `${prefix}-camo` as GeneratedTextureId;
  return `${prefix}-skin` as GeneratedTextureId;
}

/** Texture id of the bump map that goes with a `<faction>-skin`, else null. */
export function bumpTextureId(
  id: GeneratedTextureId,
): GeneratedTextureId | null {
  return id.endsWith("-skin") ? (`${id}-bump` as GeneratedTextureId) : null;
}

/** The colour map and bump map of a type's `body` among `textures`: an infantry
 *  or vehicle whose camo/skin is not loaded falls back to `<faction>-paint`. */
export function bodyMapsOf(
  textures: GeneratedTextures,
  typeId: string,
  category: string,
  armor: number,
): { paint: Texture | undefined; bump: Texture | undefined } {
  const id = bodyTextureId(typeId, category, armor);
  const skin = textures[id];
  const bumpId = bumpTextureId(id);
  if (skin !== undefined) {
    return {
      paint: skin,
      bump: bumpId === null ? undefined : textures[bumpId],
    };
  }
  const prefix = typeId.startsWith("ru-") ? "ru" : "ua";
  return { paint: textures[`${prefix}-paint`], bump: undefined };
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

/** `darkMask` of `mark` vertices: painted markings keep their own flat colour,
 *  without the paint or camouflage texture (spec 17 §3). */
export const MARK_MASK = 2;

/** The vertex-coloured `body` material. Its map is the paint or concrete
 *  texture, vertices with `darkMask` = 1 sample the `dark-metal` texture
 *  instead and those with MARK_MASK no texture, so the merged
 *  `body`+`dark`+`mark` mesh stays one draw call. Infantry
 *  passes `flatShading` false to keep its smooth limbs (spec 17 §3). */
export function createBodyMaterial(flatShading = true): MeshLambertMaterial {
  const material = new MeshLambertMaterial({
    vertexColors: true,
    flatShading,
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
        `float liveryDetail = 1.0;
float liveryCover = 0.0;
#ifdef USE_MAP
  vec4 paintColor = texture2D( map, vMapUv );
  vec4 darkColor = texture2D( darkMap, vMapUv );
  vec4 surfaceColor = mix( mix( paintColor, darkColor, min( vDark, 1.0 ) ), vec4( 1.0 ), step( 1.5, vDark ) );
  diffuseColor *= surfaceColor;
  liveryDetail = clamp( dot( surfaceColor.rgb, vec3( 0.3333 ) ) / 0.9, 0.75, 1.05 );
#endif`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  vec4 liveryColor = texture2D( liveryMap, vec2( ( vLivery.x + step( 1.5, vLivery.z ) * ( 1.0 - step( 2.5, vLivery.z ) ) ) * 0.5, vLivery.y ) );
  // Outside the patch the texture is not sampled: its coarse mips are not empty.
  float liveryInside = step( 0.0, vLivery.x ) * step( vLivery.x, 1.0 ) * step( 0.0, vLivery.y ) * step( vLivery.y, 1.0 );
  float liveryWeight = liveryColor.a * liveryInside * min( vLivery.z, 1.0 ) * ( 1.0 - min( vDark, 1.0 ) ) * 0.95;
  // Flags are flat; the painted Z (mask 3) follows the relief of the skin.
  liveryCover = liveryWeight * ( 1.0 - step( 2.5, vLivery.z ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, liveryColor.rgb * liveryDetail, liveryWeight );`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        // The painted patches are flat: the bump fades out under them (spec 15 §3).
        ShaderChunk.normal_fragment_maps.replace(
          "dHdxy_fwd()",
          "dHdxy_fwd() * ( 1.0 - liveryCover )",
        ),
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
  bump?: Texture,
): void {
  const bumpMap = bump ?? null;
  if (material.bumpMap !== bumpMap) {
    material.bumpMap = bumpMap;
    material.bumpScale = BUMP_SCALE;
    material.needsUpdate = true;
  }
  const darkMap = material.userData.darkMap as { value: Texture } | undefined;
  if (darkMap !== undefined) darkMap.value = dark ?? WHITE;
  const map = paint ?? (dark === undefined ? null : WHITE);
  if (material.map !== map) {
    material.map = map;
    material.needsUpdate = true;
  }
}
