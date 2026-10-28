import { Group, type Object3D } from "three";
import type { FeatureRow } from "../../sim/featureSnapshot";
import type { Elevation } from "../elevation";
import {
  FEATURE_FAMILIES,
  type FeatureContext,
  type FeatureMap,
  type FeatureRules,
  featureInstancesOf,
  terrainLayersOf,
} from "./layers";
import { LiveFeatures } from "./live";
import {
  featureRendererFor,
  groundLayerRenderer,
  waterLayerRenderer,
} from "./registry";

export * from "./layers";
export * from "./registry";

// Renderer modules register themselves when imported (see `registry.ts`).
import.meta.glob(["./renderers/*.ts", "!./renderers/*.test.ts"], {
  eager: true,
});

/** The scene object of a map's terrain layers and features: ground, water,
 *  then one object per family that has instances. */
export function createMapFeatures(
  rules: FeatureRules,
  map: FeatureMap,
  elevation: Elevation,
): Group {
  const layers = terrainLayersOf(map, rules.layerNames);
  const ctx: FeatureContext = {
    elevation,
    layers,
    mapWidth: map.width,
    mapHeight: map.height,
  };
  const group = new Group();
  group.name = "map-features";
  const add = (object: Object3D | null): void => {
    if (object !== null) group.add(object);
  };
  if (layers.present) {
    add(groundLayerRenderer()(layers, ctx));
    add(waterLayerRenderer()(layers, ctx));
  }
  const instances = featureInstancesOf(map, rules.featureTypes ?? []);
  for (const family of FEATURE_FAMILIES) {
    const ofFamily = instances.filter((i) => i.type.family === family);
    if (ofFamily.length === 0) continue;
    add(featureRendererFor(family)(ofFamily, ctx));
  }
  return group;
}

/** The map's ground and water, and its features as a live object that follows
 *  the snapshot's feature table (spec 31). */
export interface LiveMapFeatures {
  readonly object: Group;
  /** Feeds the feature table of a snapshot. */
  apply(rows: readonly FeatureRow[], nowMs: number): void;
  /** Call every frame: rebuilds what changed and animates the flames. */
  update(nowMs: number): void;
}

export function createLiveMapFeatures(
  rules: FeatureRules,
  map: FeatureMap,
  elevation: Elevation,
): LiveMapFeatures {
  const layers = terrainLayersOf(map, rules.layerNames);
  const ctx: FeatureContext = {
    elevation,
    layers,
    mapWidth: map.width,
    mapHeight: map.height,
  };
  const group = new Group();
  group.name = "map-features";
  if (layers.present) {
    const ground = groundLayerRenderer()(layers, ctx);
    if (ground !== null) group.add(ground);
    const water = waterLayerRenderer()(layers, ctx);
    if (water !== null) group.add(water);
  }
  const live = new LiveFeatures(
    featureInstancesOf(map, rules.featureTypes ?? []),
    rules.featureTypes ?? [],
    ctx,
    (family, instances) => featureRendererFor(family)(instances, ctx),
  );
  group.add(live.object);
  return {
    object: group,
    apply: (rows, nowMs) => live.apply(rows, nowMs),
    update: (nowMs) => live.update(nowMs),
  };
}
