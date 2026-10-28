import type { Elevation } from "../elevation";

/** Map features and terrain layers as the client reads them (spec 26, Phase 1
 *  contract). The data compiler writes the bytes; the sim blocks cells from
 *  the same data; the renderers only draw. */

export type FeatureFamily =
  | "vegetation"
  | "building"
  | "prop"
  | "port"
  | "wall"
  | "bridge"
  /** Spec 35: trenches dug during a match. */
  | "earthwork";

/** Draw order of the families when a renderer pass runs over all of them. */
export const FEATURE_FAMILIES: readonly FeatureFamily[] = [
  "vegetation",
  "building",
  "prop",
  "port",
  "wall",
  "bridge",
  "earthwork",
];

export type FeatureBlocks = "all" | "vehicles" | "none";

/** One `data/features` type as the ruleset lists it (`featureTypes`). */
export interface FeatureTypeInfo {
  readonly id: string;
  readonly family: FeatureFamily;
  /** [width, height] in cells at rot 0. */
  readonly footprint: readonly [number, number];
  readonly blocks: FeatureBlocks;
  readonly variants: number;
  /** Free-form hints for the family renderer: model id, colours, scale... */
  readonly render: Readonly<Record<string, unknown>>;
}

/** Names of the byte values of the layers, in index order (`layerNames`). */
export interface LayerNames {
  readonly ground: readonly string[];
  readonly roads: readonly string[];
  readonly waterDepths: readonly string[];
  readonly waterKinds: readonly string[];
  readonly featureStates: readonly string[];
}

/** The parts of the ruleset the feature layer reads. */
export interface FeatureRules {
  readonly featureTypes?: readonly FeatureTypeInfo[];
  readonly layerNames?: LayerNames;
}

/** The parts of a ruleset map the feature layer reads. */
export interface FeatureMap {
  readonly width: number;
  readonly height: number;
  /** Hex, two digits per cell, row-major; missing without `terrain:`. */
  readonly ground?: string;
  readonly roads?: string;
  readonly water?: string;
  readonly features?: readonly {
    readonly type: number;
    readonly x: number;
    readonly y: number;
    readonly rot: number;
    readonly variant: number;
    readonly state: number;
    /** Bridges only: the last (bottom-right) deck cell, inclusive. */
    readonly to?: readonly [number, number];
  }[];
}

/** Water byte: depth in the low two bits, kind in bits 2-3. */
export const WATER_DEPTH_MASK = 3;
export const WATER_SHALLOW = 1;
export const WATER_DEEP = 2;
export const WATER_KIND_SHIFT = 2;

/** The per-cell layers of a map, one byte per cell, row-major (`y * width + x`).
 *  Every array is zero-filled when the map has no `terrain:` section. */
export interface TerrainLayers {
  readonly width: number;
  readonly height: number;
  /** Index into `names.ground`. */
  readonly ground: Uint8Array;
  /** Index into `names.roads`; 0 = no road. */
  readonly roads: Uint8Array;
  /** `depth | kind << 2`; see `WATER_*`. */
  readonly water: Uint8Array;
  readonly names: LayerNames;
  /** False when the map declares no `terrain:` section. */
  readonly present: boolean;
}

/** A placed feature, footprint already rotated. */
export interface FeatureInstance {
  readonly type: FeatureTypeInfo;
  /** Index into the ruleset `featureTypes`. */
  readonly typeIndex: number;
  /** Top-left cell of the footprint. */
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly variant: number;
  /** Index into `names.featureStates`: 0 intact, 1 damaged, 2 wrecked, 3 abandoned. */
  readonly state: number;
  /** Footprint in cells after rotation (odd `rot` swaps width and height); a
   *  bridge's is its whole deck rectangle. */
  readonly width: number;
  readonly height: number;
}

/** What every feature and layer renderer gets. */
export interface FeatureContext {
  readonly elevation: Elevation;
  readonly layers: TerrainLayers;
  readonly mapWidth: number;
  readonly mapHeight: number;
}

const EMPTY_NAMES: LayerNames = {
  ground: [],
  roads: [],
  waterDepths: [],
  waterKinds: [],
  featureStates: [],
};

function decodeLayer(hex: string | undefined, cells: number): Uint8Array {
  const bytes = new Uint8Array(cells);
  if (hex === undefined || hex.length !== cells * 2) return bytes;
  for (let i = 0; i < cells; i++) {
    const value = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    bytes[i] = Number.isNaN(value) ? 0 : value;
  }
  return bytes;
}

/** Decodes the hex layers of a ruleset map. */
export function terrainLayersOf(
  map: FeatureMap,
  names: LayerNames = EMPTY_NAMES,
): TerrainLayers {
  const cells = map.width * map.height;
  return {
    width: map.width,
    height: map.height,
    ground: decodeLayer(map.ground, cells),
    roads: decodeLayer(map.roads, cells),
    water: decodeLayer(map.water, cells),
    names,
    present: map.ground !== undefined,
  };
}

/** The feature instances of a ruleset map, in the compiler's row order. */
export function featureInstancesOf(
  map: FeatureMap,
  types: readonly FeatureTypeInfo[],
): FeatureInstance[] {
  const instances: FeatureInstance[] = [];
  for (const f of map.features ?? []) {
    const type = types[f.type];
    if (type === undefined) continue;
    const swap = f.rot % 2 === 1;
    instances.push({
      type,
      typeIndex: f.type,
      x: f.x,
      y: f.y,
      rot: f.rot,
      variant: f.variant,
      state: f.state,
      width:
        f.to !== undefined
          ? f.to[0] - f.x + 1
          : swap
            ? type.footprint[1]
            : type.footprint[0],
      height:
        f.to !== undefined
          ? f.to[1] - f.y + 1
          : swap
            ? type.footprint[0]
            : type.footprint[1],
    });
  }
  return instances;
}
