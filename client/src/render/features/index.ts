import { Group, type Object3D } from "three";
import type { Elevation } from "../elevation";
import {
  FEATURE_FAMILIES,
  type FeatureContext,
  type FeatureMap,
  type FeatureRules,
  featureInstancesOf,
  terrainLayersOf,
} from "./layers";
import {
  featureRendererFor,
  groundLayerRenderer,
  waterLayerRenderer,
} from "./registry";

export * from "./layers";
export * from "./registry";

// Renderer modules register themselves when imported (see `registry.ts`).
import.meta.glob("./renderers/*.ts", { eager: true });

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
