import {
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
} from "three";
import { setDeckHeights } from "../../elevation";
import { climateFor } from "../../weather";
import { type Deck, deckLookup, deckOf } from "../bridge/deck";
import { type BridgeBuild, bridgeGeometry } from "../bridge/model";
import type { FeatureContext, FeatureInstance } from "../layers";
import { registerFeatureRenderer } from "../registry";

/** Spec 26 section 17: river bridges (family `bridge`): `road-bridge`,
 *  `wooden-bridge`, `stone-arch`. All bridges of a map are one merged mesh
 *  (one draw call). The decks are also handed to `groundY` so units on a
 *  deck stand at deck height. Models live in `../bridge/` (this folder's
 *  files are all auto-imported, so no helpers here). */

const SNOW_WHEN_SNOWING = 0.8;

function snowFromPage(): number {
  if (typeof window === "undefined") return 0;
  try {
    const params = new URLSearchParams(window.location.search);
    return climateFor(params) === null ? 0 : SNOW_WHEN_SNOWING;
  } catch {
    return 0;
  }
}

const kindOf = (instance: FeatureInstance): string => {
  const written = instance.type.render.kind;
  return typeof written === "string" ? written : instance.type.id;
};

export function createBridges(
  instances: readonly FeatureInstance[],
  ctx: FeatureContext,
): Object3D {
  const group = new Group();
  group.name = "features-bridge";
  const builds: BridgeBuild[] = instances.map((instance) => ({
    deck: deckOf(instance, ctx),
    kind: kindOf(instance),
    variant: instance.variant,
  }));
  const decks: Deck[] = builds.map((b) => b.deck);
  setDeckHeights(decks.length > 0 ? deckLookup(decks) : null);
  const geometry = bridgeGeometry(builds, snowFromPage());
  if (geometry !== null) {
    const mesh = new Mesh(
      geometry,
      // Double sided: the extruded arch walls and thin rails must not vanish
      // from behind or when a cap winds the other way.
      new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = "bridges";
    group.add(mesh);
  }
  return group;
}

registerFeatureRenderer("bridge", createBridges);
