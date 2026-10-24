import {
  type InstancedBufferAttribute,
  MeshDepthMaterial,
  type MeshLambertMaterial,
  RGBADepthPacking,
} from "three";

/** Per-instance attributes of the limb meshes (spec 22 §5): `instanceFade`
 *  (1 opaque .. 0 gone, drawn as a dither so shadows fade too) and
 *  `instanceBlood` (0 clean .. 1 soaked, blood stains on the clothes). */
export const FADE_ATTRIBUTE = "instanceFade";
export const BLOOD_ATTRIBUTE = "instanceBlood";

export interface LimbFx {
  readonly fade: InstancedBufferAttribute;
  readonly blood: InstancedBufferAttribute;
}

const NOISE = `
float stainHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float stainNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( stainHash( i ), stainHash( i + vec3( 1, 0, 0 ) ), f.x ),
         mix( stainHash( i + vec3( 0, 1, 0 ) ), stainHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( stainHash( i + vec3( 0, 0, 1 ) ), stainHash( i + vec3( 1, 0, 1 ) ), f.x ),
         mix( stainHash( i + vec3( 0, 1, 1 ) ), stainHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}`;

/** Dried blood colour of a stain, linear-ish. */
const STAIN = "vec3( 0.16, 0.012, 0.012 )";

/** Makes `material` dissolve with `instanceFade` and, with `stains`, darken
 *  patchily to blood red with `instanceBlood`. It wraps the existing
 *  `onBeforeCompile`, so the camouflage and dark-metal mix stay. */
export function enableLimbFx(
  material: MeshLambertMaterial,
  stains: boolean,
): void {
  material.alphaHash = true;
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nattribute float ${FADE_ATTRIBUTE};\nattribute float ${BLOOD_ATTRIBUTE};\nvarying float vFade;\nvarying float vBlood;\nvarying vec3 vStainAt;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvFade = ${FADE_ATTRIBUTE};\nvBlood = ${BLOOD_ATTRIBUTE};\nvStainAt = position * 11.0 + vec3( float( gl_InstanceID ) * 3.713 );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying float vFade;\nvarying float vBlood;\nvarying vec3 vStainAt;${NOISE}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  ${
    stains
      ? `{
    // Patches of blood that spread and darken as the soldier is hurt.
    float cloth = stainNoise( vStainAt ) * 0.65 + stainNoise( vStainAt * 2.7 ) * 0.35;
    float level = clamp( vBlood, 0.0, 1.0 );
    float edge = 0.8 - level * 0.3;
    float spot = smoothstep( edge, edge + 0.07, cloth ) * step( 0.02, level );
    diffuseColor.rgb = mix( diffuseColor.rgb, ${STAIN}, spot * 0.85 );
  }`
      : ""
  }
  diffuseColor.a *= vFade;`,
      );
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () =>
    `${key()}-limbfx${stains ? "-stains" : ""}`;
}

/** The depth material that makes the shadow of a limb dissolve with it. */
export function limbDepthMaterial(): MeshDepthMaterial {
  const material = new MeshDepthMaterial({
    depthPacking: RGBADepthPacking,
    alphaHash: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nattribute float ${FADE_ATTRIBUTE};\nvarying float vFade;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvFade = ${FADE_ATTRIBUTE};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFade;")
      .replace(
        "#include <alphahash_fragment>",
        "diffuseColor.a *= vFade;\n#include <alphahash_fragment>",
      );
  };
  material.customProgramCacheKey = () => "limb-depth-fade";
  return material;
}
