import {
  BufferGeometry,
  ClampToEdgeWrapping,
  type DataArrayTexture,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshLambertMaterial,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
  Uint32BufferAttribute,
  UnsignedByteType,
  Vector2,
} from "three";
import type { Elevation } from "../../elevation";
import { cornerNormal } from "../../terrain";
import { smoothstep } from "./noise";
import type { RoadImage } from "./roadBake";
import type { SplatWeights } from "./splat";
import { splatTexture } from "./splat";

/** Spec 26 Phase 3: meshes laid on top of the terrain mesh. One quad per cell
 *  (same corner heights and diagonal as the terrain, so they follow hills and
 *  cliffs), lifted a hair and drawn with a polygon offset instead of z-fight. */

const GROUND_LIFT = 0.004;
const ROAD_LIFT = 0.009;
/** The terrain textures repeat every 4 cells (`TILE_UV_SCALE`). */
const TILE = 0.25;
/** The rock face of a steep slope shows through the ground layer again. */
const CLIFF_SLOPE_LOW = 0.55;
const CLIFF_SLOPE_HIGH = 1;

/** Cells of the map for which `wanted` holds on the cell or any of its eight
 *  neighbours (blends and rounded corners spill a little into them). */
export function cellsNear(
  cols: number,
  rows: number,
  wanted: (x: number, y: number) => boolean,
): number[] {
  const out: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          hit = wanted(nx, ny);
        }
      }
      if (hit) out.push(y * cols + x);
    }
  }
  return out;
}

/** One quad per listed cell. Positions are world cells (the terrain's own
 *  frame); `uv` is the position over the map size; the colour alpha fades the
 *  layer out on cliff faces when `fadeOnCliffs`. */
export function overlayGeometry(
  cells: readonly number[],
  cols: number,
  rows: number,
  elevation: Elevation,
  lift: number,
  fadeOnCliffs: boolean,
): BufferGeometry {
  const count = cells.length * 4;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const colors = new Float32Array(count * 4);
  const indices = new Uint32Array(cells.length * 6);
  cells.forEach((cell, slot) => {
    const x = cell % cols;
    const y = Math.floor(cell / cols);
    const corners = [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
    ] as const;
    corners.forEach(([cx, cz], k) => {
      const v = slot * 4 + k;
      positions.set([cx, elevation.corner(cx, cz) + lift, cz], v * 3);
      normals.set(cornerNormal(elevation.corner, cx, cz), v * 3);
      uvs.set([cx / cols, cz / rows], v * 2);
      const fade = fadeOnCliffs
        ? 1 -
          smoothstep(CLIFF_SLOPE_LOW, CLIFF_SLOPE_HIGH, elevation.slope(cx, cz))
        : 1;
      colors.set([1, 1, 1, fade], v * 4);
    });
    const base = slot * 4;
    indices.set([base, base + 2, base + 1, base, base + 3, base + 2], slot * 6);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 4));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  return geometry;
}

export { GROUND_LIFT, ROAD_LIFT };

/** The ground-material layer: the terrain's lighting with the colour taken
 *  from the material array texture, weighted by the splat maps. Alpha is one
 *  minus the grass weight, so grass shows the terrain below untouched. */
export function groundMesh(
  geometry: BufferGeometry,
  materials: DataArrayTexture,
  splat: SplatWeights,
  cols: number,
  rows: number,
): Mesh {
  const weightA = splatTexture(splat.a, splat.width, splat.height);
  const weightB = splatTexture(splat.b, splat.width, splat.height);
  const material = new MeshLambertMaterial({
    transparent: true,
    vertexColors: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMaterials = { value: materials };
    shader.uniforms.uWeightA = { value: weightA };
    shader.uniforms.uWeightB = { value: weightB };
    shader.uniforms.uTile = { value: TILE };
    shader.uniforms.uMapSize = { value: new Vector2(cols, rows) };
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec2 vGroundCell;\nvoid main() {")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vGroundCell = position.xz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        `uniform highp sampler2DArray uMaterials;
uniform sampler2D uWeightA;
uniform sampler2D uWeightB;
uniform float uTile;
uniform vec2 uMapSize;
varying vec2 vGroundCell;
void main() {`,
      )
      .replace(
        "#include <map_fragment>",
        `vec2 wUv = vGroundCell / uMapSize;
  vec4 wa = texture2D(uWeightA, wUv);
  vec4 wb = texture2D(uWeightB, wUv);
  float wRest = max(0.0, 1.0 - dot(wa, vec4(1.0)) - dot(wb, vec4(1.0)));
  vec2 tUv = vGroundCell * uTile;
  vec2 dx = dFdx(tUv);
  vec2 dy = dFdy(tUv);
  float weights[9] = float[9](wa.x, wa.y, wa.z, wa.w, wb.x, wb.y, wb.z, wb.w, wRest);
  vec3 groundColour = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 9; i++) {
    float w = weights[i];
    if (w > 0.004) {
      groundColour += textureGrad(uMaterials, vec3(tUv, float(i)), dx, dy).rgb * w;
      total += w;
    }
  }
  diffuseColor.rgb *= groundColour / max(total, 0.001);
  diffuseColor.a *= 1.0 - weights[0];`,
      );
  };
  const mesh = new Mesh(geometry, material);
  mesh.name = "ground-materials";
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.userData.textures = [weightA, weightB];
  return mesh;
}

/** The road layer: the baked image over the whole map, lit like the ground. */
export function roadMesh(geometry: BufferGeometry, image: RoadImage): Mesh {
  const texture: Texture = new DataTexture(
    image.pixels,
    image.width,
    image.height,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const material = new MeshLambertMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "roads";
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  return mesh;
}
