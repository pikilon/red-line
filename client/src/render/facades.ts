import { Color, type MeshLambertMaterial, type Texture, Vector3 } from "three";
import type { GeneratedTextureId } from "./generatedTextures";

/** A vertex whose object-space normal has at least this `y` is roof (spec 16
 *  §3): the 45° gable of the Russian HQ (0.707) counts, walls (0) do not. */
export const ROOF_NORMAL_Y = 0.6;

/** The wall and roof textures of a building (spec 16 §3), or `null` for units,
 *  depots and types without a faction prefix. */
export function facadeTextureIds(
  typeId: string,
  category: string,
): { wall: GeneratedTextureId; roof: GeneratedTextureId } | null {
  if (category !== "building") return null;
  const prefix = typeId.startsWith("ru-")
    ? "ru"
    : typeId.startsWith("ua-")
      ? "ua"
      : null;
  if (prefix === null) return null;
  return {
    wall: `${prefix}-wall` as GeneratedTextureId,
    roof: `${prefix}-roof` as GeneratedTextureId,
  };
}

/** Per-channel 1 / colour of the linear body colour: multiplied with the
 *  vertex colour it leaves only the baked ambient occlusion. */
export function untintOf(bodyColor: number): [number, number, number] {
  const linear = new Color(bodyColor);
  return [linear.r, linear.g, linear.b].map((c) => 1 / Math.max(c, 1e-3)) as [
    number,
    number,
    number,
  ];
}

interface FacadeUniforms {
  roofMap: { value: Texture | null };
  facadeUntint: { value: Vector3 };
  untint: [number, number, number];
}

function uniformsOf(material: MeshLambertMaterial): FacadeUniforms | null {
  const data = material.userData;
  return data.roofMap === undefined ? null : (data as FacadeUniforms);
}

/** Adds the roof map and the untint to a body material (spec 16 §3). It wraps
 *  the existing `onBeforeCompile`, so the paint/dark mix and the livery stay. */
export function enableFacades(
  material: MeshLambertMaterial,
  bodyColor: number,
): void {
  if (uniformsOf(material) !== null) return;
  const roofMap = { value: null as Texture | null };
  const facadeUntint = { value: new Vector3(1, 1, 1) };
  material.userData.roofMap = roofMap;
  material.userData.facadeUntint = facadeUntint;
  material.userData.untint = untintOf(bodyColor);
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.roofMap = roofMap;
    shader.uniforms.facadeUntint = facadeUntint;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vRoof;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvRoof = step( ${ROOF_NORMAL_Y.toFixed(2)}, normal.y );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform sampler2D roofMap;\nuniform vec3 facadeUntint;\nvarying float vRoof;",
      )
      .replace(
        "vec4 paintColor = texture2D( map, vMapUv );",
        `vec4 paintColor = mix( texture2D( map, vMapUv ), texture2D( roofMap, vMapUv ), vRoof );
  paintColor.rgb *= facadeUntint;`,
      );
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}-facade`;
  material.needsUpdate = true;
}

/** Sets the roof texture and divides the body colour out; `null` restores the
 *  plain body (spec 12 §6): roofs sample the same map as walls. The wall is the
 *  material's `map`, so call this after `applyBodyTextures`. */
export function applyFacade(
  material: MeshLambertMaterial,
  roof: Texture | null,
): void {
  const uniforms = uniformsOf(material);
  if (uniforms === null) return;
  uniforms.roofMap.value = roof ?? material.map;
  if (roof === null) uniforms.facadeUntint.value.set(1, 1, 1);
  else uniforms.facadeUntint.value.fromArray(uniforms.untint);
}
