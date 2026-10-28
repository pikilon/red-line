import type { Object3D } from "three";
import type {
  FeatureContext,
  FeatureFamily,
  FeatureInstance,
  TerrainLayers,
} from "./layers";
import {
  placeholderFeatures,
  placeholderGround,
  placeholderWater,
} from "./placeholder";

/** Spec 26 Phase 1 contract: how a follow-up plugs a renderer in.
 *
 *  - A family renderer draws every instance of one family in one object
 *    (instance or merge: keep the draw calls low).
 *  - The ground renderer draws on top of the terrain mesh: ground materials
 *    and roads (`layers.ground`, `layers.roads`).
 *  - The water renderer draws `layers.water`.
 *
 *  Register from a file in `./renderers/` (`index.ts` imports every `*.ts`
 *  there, so parallel features never edit the same file) and import the
 *  register functions from `../registry`. A later registration replaces an
 *  earlier one; none registered means the placeholders. */
export type FeatureRenderer = (
  instances: readonly FeatureInstance[],
  ctx: FeatureContext,
) => Object3D;
export type LayerRenderer = (
  layers: TerrainLayers,
  ctx: FeatureContext,
) => Object3D | null;

const familyRenderers = new Map<FeatureFamily, FeatureRenderer>();
let groundRenderer: LayerRenderer = placeholderGround;
let waterRenderer: LayerRenderer = placeholderWater;

export function registerFeatureRenderer(
  family: FeatureFamily,
  renderer: FeatureRenderer,
): void {
  familyRenderers.set(family, renderer);
}

export function registerGroundLayerRenderer(renderer: LayerRenderer): void {
  groundRenderer = renderer;
}

export function registerWaterRenderer(renderer: LayerRenderer): void {
  waterRenderer = renderer;
}

/** Back to the placeholders (tests). */
export function resetFeatureRenderers(): void {
  familyRenderers.clear();
  groundRenderer = placeholderGround;
  waterRenderer = placeholderWater;
}

export const featureRendererFor = (family: FeatureFamily): FeatureRenderer =>
  familyRenderers.get(family) ?? placeholderFeatures;
export const groundLayerRenderer = (): LayerRenderer => groundRenderer;
export const waterLayerRenderer = (): LayerRenderer => waterRenderer;
