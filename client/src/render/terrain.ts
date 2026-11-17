import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  type Texture,
  Uint32BufferAttribute,
  Vector3,
} from "three";
import { type Elevation, flatElevation, SHADING_RELIEF } from "./elevation";
import { attachTerrainDeformer, type TerrainDeformer } from "./terrainDeform";
import {
  createTerrainTextures,
  TERRAIN_KINDS,
  type TerrainKind,
  valueNoise,
} from "./terrainTexture";

export const PASSABLE_COLOR = 0x4a6b3a;
export const BLOCKED_COLOR = 0x5a5a5a;

const VERTICES_PER_TILE = 4;
const INDICES_PER_TILE = 6;
const VERTICES_PER_ROCK = 8;
const INDICES_PER_ROCK = 36;
/** The ground texture repeats every 4 tiles (spec §4). */
const TILE_UV_SCALE = 0.25;
/** Period of the dirt overlay noise and its alpha ramp, in tiles (spec §4). */
const DIRT_NOISE_PERIOD = 12;
const DIRT_ALPHA_LOW = 0.55;
const DIRT_ALPHA_HIGH = 0.7;
/** Period of the rock height noise, in tiles (spec §4). */
const ROCK_NOISE_PERIOD = 3;
const ROCK_HEIGHT_BASE = 0.4;
const ROCK_HEIGHT_RANGE = 0.75;
/** Rock top vertices jitter by up to this many tiles (spec §4). */
const ROCK_JITTER = 0.22;

/** Deterministic hash of a lattice corner in [0, 1). */
function cornerHash(x: number, z: number, seed: number): number {
  let h =
    (Math.imul(x | 0, 374761393) +
      Math.imul(z | 0, 668265263) +
      Math.imul(seed, 2246822519)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The map definition the rock cells are derived from (`ruleset.maps[i]`). */
export interface RockMap {
  readonly width: number;
  readonly height: number;
  readonly blocked: readonly (readonly number[])[];
}

/** Ground layers of the elevated terrain (spec 30 §4). `cliff` is a rock
 *  overlay whose alpha follows the steepness. */
export type GroundLayer = "grass" | "dirt" | "cliff";

/** Slopes (tiles of rise per tile) where bare earth starts and covers fully. */
const EARTH_SLOPE_LOW = 0.3;
const EARTH_SLOPE_HIGH = 0.75;
/** Slopes where the rock face starts and covers fully; the sim's cliff is a
 *  spread of one tile over a cell (slope about 1). */
const CLIFF_SLOPE_LOW = 0.55;
const CLIFF_SLOPE_HIGH = 1;
/** Rock faces are a touch darker and cooler than the flat rock. */
const CLIFF_TINT = [0.82, 0.8, 0.78] as const;

/** Alpha of `layer` at a corner of `slope`, over the flat default `base`. */
export function layerAlpha(
  layer: GroundLayer,
  slope: number,
  base: number,
): number {
  if (layer === "dirt") {
    return Math.max(base, smoothstep(EARTH_SLOPE_LOW, EARTH_SLOPE_HIGH, slope));
  }
  if (layer === "cliff") {
    return smoothstep(CLIFF_SLOPE_LOW, CLIFF_SLOPE_HIGH, slope);
  }
  return 1;
}

/** Shading normal of the elevation at a corner (central differences, slope
 *  scaled by `SHADING_RELIEF`). */
export function cornerNormal(
  heightOf: (cx: number, cz: number) => number,
  cx: number,
  cz: number,
): [number, number, number] {
  const slopeX =
    ((heightOf(cx + 1, cz) - heightOf(cx - 1, cz)) / 2) * SHADING_RELIEF;
  const slopeZ =
    ((heightOf(cx, cz + 1) - heightOf(cx, cz - 1)) / 2) * SHADING_RELIEF;
  const inverse = 1 / Math.hypot(slopeX, 1, slopeZ);
  return [-slopeX * inverse, inverse, -slopeZ * inverse];
}

/** One box per rock tile: bottom face first, then the jittered top face. */
const ROCK_FACES = [
  4,
  6,
  5,
  4,
  7,
  6, // top
  0,
  1,
  2,
  0,
  2,
  3, // bottom
  0,
  4,
  5,
  0,
  5,
  1, // south
  3,
  2,
  6,
  3,
  6,
  7, // north
  0,
  3,
  7,
  0,
  7,
  4, // west
  1,
  6,
  2,
  1,
  5,
  6, // east
];

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Opacity of the dirt overlay at a tile corner; also the mud softness. */
export function dirtAlphaAt(cx: number, cz: number, seed: number): number {
  return smoothstep(
    DIRT_ALPHA_LOW,
    DIRT_ALPHA_HIGH,
    valueNoise(cx, cz, DIRT_NOISE_PERIOD, seed),
  );
}

/** Marks the cells of every `[x0, y0, x1, y1]` blocked rectangle of `map`. */
export function rockCellsOf(map: RockMap): Uint8Array {
  const cells = new Uint8Array(map.width * map.height);
  for (const rectangle of map.blocked) {
    const x0 = rectangle[0] ?? 0;
    const y0 = rectangle[1] ?? 0;
    const x1 = rectangle[2] ?? -1;
    const y1 = rectangle[3] ?? -1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        cells[y * map.width + x] = 1;
      }
    }
  }
  return cells;
}

/** One indexed plane per passable tile; `withAlpha` adds the dirt RGBA. */
function groundGeometry(
  width: number,
  height: number,
  rockCells: Uint8Array,
  layer: GroundLayer,
  seed: number,
  elevation: Elevation,
): BufferGeometry {
  const withAlpha = layer !== "grass";
  // The rock faces ride on the grass mesh as extra attributes (a shader mix),
  // so the hills cost no extra draw call (spec 10 §3).
  const withCliff = layer === "grass" && elevation.raised;
  const passable: number[] = [];
  for (let tile = 0; tile < width * height; tile++) {
    if ((rockCells[tile] ?? 0) === 0) passable.push(tile);
  }
  const vertexCount = passable.length * VERTICES_PER_TILE;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const cliffUvs = new Float32Array(withCliff ? vertexCount * 2 : 0);
  const cliffs = new Float32Array(withCliff ? vertexCount : 0);
  const colors = new Float32Array(vertexCount * (withAlpha ? 4 : 3));
  const indices = new Uint32Array(passable.length * INDICES_PER_TILE);

  passable.forEach((tile, slot) => {
    const x = tile % width;
    const y = Math.floor(tile / width);
    const corners = [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
    ] as const;
    // Rock faces take their texture from the side they face, so it runs up
    // the cliff instead of stretching (spec 30 §4).
    const corner = elevation.corner;
    const faceX =
      Math.abs(corner(x + 1, y) - corner(x, y)) +
        Math.abs(corner(x + 1, y + 1) - corner(x, y + 1)) >
      Math.abs(corner(x, y + 1) - corner(x, y)) +
        Math.abs(corner(x + 1, y + 1) - corner(x + 1, y));
    corners.forEach(([cx, cz], index) => {
      const vertex = slot * VERTICES_PER_TILE + index;
      const cy = corner(cx, cz);
      positions.set([cx, cy, cz], vertex * 3);
      normals.set(cornerNormal(corner, cx, cz), vertex * 3);
      uvs.set([cx * TILE_UV_SCALE, cz * TILE_UV_SCALE], vertex * 2);
      if (withCliff) {
        const across = faceX ? cz : cx;
        cliffUvs.set(
          [across * TILE_UV_SCALE, -cy * TILE_UV_SCALE * 2],
          vertex * 2,
        );
        cliffs[vertex] = layerAlpha("cliff", elevation.slope(cx, cz), 0);
      }
      if (withAlpha) {
        // Bare earth gives way to the rock face the grass mesh now shows.
        const slope = elevation.slope(cx, cz);
        const alpha =
          layerAlpha(layer, slope, dirtAlphaAt(cx, cz, seed)) *
          (1 - layerAlpha("cliff", slope, 0));
        colors.set([1, 1, 1, alpha], vertex * 4);
      } else {
        colors.set([1, 1, 1], vertex * 3);
      }
    });
    const base = slot * VERTICES_PER_TILE;
    indices.set(
      [base, base + 2, base + 1, base, base + 3, base + 2],
      slot * INDICES_PER_TILE,
    );
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute(
    "color",
    new Float32BufferAttribute(colors, withAlpha ? 4 : 3),
  );
  if (withCliff) {
    geometry.setAttribute("aCliffUv", new Float32BufferAttribute(cliffUvs, 2));
    geometry.setAttribute("aCliff", new Float32BufferAttribute(cliffs, 1));
  }
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  return geometry;
}

/** Mixes the rock faces (`aCliff`, mapped by `aCliffUv`) over the grass of
 *  `material`; `material.userData.cliffMap` holds the rock texture. */
function attachCliffMix(
  material: MeshLambertMaterial,
  rock: Texture | undefined,
): void {
  const cliffMap = { value: rock };
  material.userData.cliffMap = cliffMap;
  const tint = new Vector3(...CLIFF_TINT);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCliffMap = cliffMap;
    shader.uniforms.uCliffTint = { value: tint };
    shader.vertexShader = shader.vertexShader.replace(
      "void main() {",
      "attribute vec2 aCliffUv;\nattribute float aCliff;\nvarying vec2 vCliffUv;\nvarying float vCliff;\nvoid main() {\n  vCliffUv = aCliffUv;\n  vCliff = aCliff;",
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        "uniform sampler2D uCliffMap;\nuniform vec3 uCliffTint;\nvarying vec2 vCliffUv;\nvarying float vCliff;\nvoid main() {",
      )
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uCliffMap, vCliffUv).rgb * uCliffTint, clamp(vCliff, 0.0, 1.0));",
      );
  };
}

/** Hides the repetition of a ground texture (issue 495): the map is sampled a
 *  second time at another scale and rotation and the two are blended by a
 *  slow noise, with a faint low-frequency brightness drift. Chains after any
 *  existing `onBeforeCompile`. */
function attachAntiTile(material: MeshLambertMaterial): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `vec3 atBase = diffuseColor.rgb;
#include <map_fragment>
#ifdef USE_MAP
  {
    vec2 atUvB = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.37 + vec2(0.31, 0.17);
    vec4 atAlt = texture2D(map, atUvB);
    float atMask = 0.5 + 0.5 * sin(vMapUv.x * 0.48 + sin(vMapUv.y * 0.39) * 2.0);
    float atDrift = 1.0 + 0.06 * sin(vMapUv.x * 0.19 + 0.8) * sin(vMapUv.y * 0.23 + 2.1);
    diffuseColor.rgb = atBase * mix(sampledDiffuseColor.rgb, atAlt.rgb, clamp(atMask, 0.0, 1.0)) * atDrift;
  }
#endif`,
    );
  };
  const cliff = material.userData.cliffMap !== undefined;
  material.customProgramCacheKey = () =>
    cliff ? "ground-anti-tile-cliff" : "ground-anti-tile";
}

/** One merged box per rock tile, with a jittered top and a noise height. */
function rockGeometry(
  width: number,
  height: number,
  rockCells: Uint8Array,
  seed: number,
  elevation: Elevation,
): BufferGeometry {
  const cells: { x: number; z: number }[] = [];
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if ((rockCells[z * width + x] ?? 0) === 1) cells.push({ x, z });
    }
  }
  if (cells.length === 0) {
    const empty = new BufferGeometry();
    empty.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array(0), 3),
    );
    empty.setAttribute(
      "uv",
      new Float32BufferAttribute(new Float32Array(0), 2),
    );
    empty.setIndex(new Uint32BufferAttribute(new Uint32Array(0), 1));
    return empty;
  }

  const positions = new Float32Array(cells.length * VERTICES_PER_ROCK * 3);
  const uvs = new Float32Array(cells.length * VERTICES_PER_ROCK * 2);
  const indices = new Uint32Array(cells.length * INDICES_PER_ROCK);

  cells.forEach((cell, slot) => {
    // Rocks stand on the ground they cover (spec 30 §4). Every top vertex
    // takes its height and jitter from its world position, so neighbouring
    // rock tiles share them and merge into one craggy mass (issue 507).
    const ground = (dx: number, dz: number): number =>
      elevation.corner(cell.x + dx, cell.z + dz);
    const crag = (dx: number, dz: number): [number, number, number] => {
      const x = cell.x + dx;
      const z = cell.z + dz;
      const broad = valueNoise(x, z, ROCK_NOISE_PERIOD, seed + 1);
      const ridge = 1 - Math.abs(2 * valueNoise(x, z, 1.5, seed + 3) - 1);
      const grain = valueNoise(x, z, 0.75, seed + 5);
      const height =
        ROCK_HEIGHT_BASE +
        ROCK_HEIGHT_RANGE * (0.55 * broad + 0.35 * ridge + 0.1 * grain);
      return [
        x + (cornerHash(x, z, seed) - 0.5) * 2 * ROCK_JITTER,
        ground(dx, dz) + height,
        z + (cornerHash(x, z, seed + 7) - 0.5) * 2 * ROCK_JITTER,
      ];
    };
    const corners: [number, number, number][] = [
      [cell.x, ground(0, 0), cell.z],
      [cell.x + 1, ground(1, 0), cell.z],
      [cell.x + 1, ground(1, 1), cell.z + 1],
      [cell.x, ground(0, 1), cell.z + 1],
      crag(0, 0),
      crag(1, 0),
      crag(1, 1),
      crag(0, 1),
    ];
    corners.forEach(([cx, cy, cz], corner) => {
      const vertex = slot * VERTICES_PER_ROCK + corner;
      positions.set([cx, cy, cz], vertex * 3);
      uvs.set([cx * TILE_UV_SCALE, cz * TILE_UV_SCALE], vertex * 2);
    });
    const base = slot * VERTICES_PER_ROCK;
    ROCK_FACES.forEach((corner, index) => {
      indices[slot * INDICES_PER_ROCK + index] = base + corner;
    });
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** Textured grass, a noise-masked dirt overlay and raised rock tiles, built
 *  once (spec 10 §4): at most three draw calls, all casting/receiving shadows. */
export function createTerrain(
  width: number,
  height: number,
  rockCells: Uint8Array,
  seed = 1,
  generated?: Partial<Record<TerrainKind, Texture>>,
  elevation: Elevation = flatElevation(width, height),
): Group {
  const procedural = createTerrainTextures(seed);
  const textures = { ...procedural, ...definedOnly(generated) };
  const grass = new Mesh(
    groundGeometry(width, height, rockCells, "grass", seed, elevation),
    new MeshLambertMaterial({ map: textures.grass, vertexColors: true }),
  );
  grass.name = "grass";
  grass.receiveShadow = true;
  // Hills and cliffs shade the ground behind them (spec 30 §4).
  grass.castShadow = elevation.raised;
  if (elevation.raised) {
    attachCliffMix(grass.material as MeshLambertMaterial, textures.rock);
  }

  attachAntiTile(grass.material as MeshLambertMaterial);

  const dirt = new Mesh(
    groundGeometry(width, height, rockCells, "dirt", seed, elevation),
    new MeshLambertMaterial({
      map: textures.dirt,
      transparent: true,
      vertexColors: true,
      depthWrite: false,
    }),
  );
  dirt.name = "dirt";
  dirt.receiveShadow = true;

  const rock = new Mesh(
    rockGeometry(width, height, rockCells, seed, elevation),
    new MeshLambertMaterial({ map: textures.rock, flatShading: true }),
  );
  attachAntiTile(rock.material as MeshLambertMaterial);
  rock.name = "rock";
  rock.castShadow = true;
  rock.receiveShadow = true;

  const group = new Group();
  group.userData.procedural = procedural;
  group.add(grass, dirt, rock);
  // Visual relief (spec 24) on top of the elevation (spec 30).
  group.userData.deformer = attachTerrainDeformer(
    group,
    width,
    height,
    rockCells,
    (cx, cz) => dirtAlphaAt(cx, cz, seed),
    elevation,
  );
  return group;
}

/** Swaps the maps of the grass, dirt and rock meshes live (spec 12 §5); null
 *  or a missing kind restores the procedural texture. */
export function setTerrainTextures(
  group: Group,
  textures: Partial<Record<TerrainKind, Texture>> | null,
): void {
  const procedural = group.userData.procedural as
    | Record<TerrainKind, Texture>
    | undefined;
  if (procedural === undefined) return;
  const grassMaterial = (group.getObjectByName("grass") as Mesh | null)
    ?.material as MeshLambertMaterial | undefined;
  const cliffMap = grassMaterial?.userData.cliffMap as
    | { value: Texture | undefined }
    | undefined;
  if (cliffMap !== undefined) {
    cliffMap.value = textures?.rock ?? procedural.rock;
  }
  for (const kind of TERRAIN_KINDS) {
    const name: string = kind;
    const mesh = group.getObjectByName(name);
    if (!(mesh instanceof Mesh)) continue;
    const material = mesh.material as MeshLambertMaterial;
    const next = textures?.[kind] ?? procedural[kind];
    if (material.map === next) continue;
    material.map = next;
    material.needsUpdate = true;
  }
}

/** `textures` without its undefined entries. */
function definedOnly(
  textures: Partial<Record<TerrainKind, Texture>> | undefined,
): Partial<Record<TerrainKind, Texture>> {
  const result: Partial<Record<TerrainKind, Texture>> = {};
  for (const kind of TERRAIN_KINDS) {
    const texture = textures?.[kind];
    if (texture !== undefined) result[kind] = texture;
  }
  return result;
}

/** The relief controller of a terrain made by `createTerrain` (spec 24). */
export function terrainDeformerOf(group: Group): TerrainDeformer | null {
  return (group.userData.deformer as TerrainDeformer | undefined) ?? null;
}
