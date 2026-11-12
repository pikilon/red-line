import { BUILDERS } from "../civil/buildings";
import { PROP_BUILDERS } from "../civil/props";
import { renderCivil } from "../civil/render";
import { registerFeatureRenderer } from "../registry";
import { attachMeshyCivilInstances } from "../terrainModels";

// Spec 26 section 5.1-5.2: civilian buildings, walls and props.
registerFeatureRenderer("building", (instances, ctx) => {
  const group = renderCivil("features-building", instances, ctx, BUILDERS);
  attachMeshyCivilInstances(
    group,
    "terrain-house",
    instances,
    ctx,
    (inst) => inst.state === 0 && inst.type.id.includes("house"),
  );
  return group;
});
registerFeatureRenderer("prop", (instances, ctx) => {
  const group = renderCivil("features-prop", instances, ctx, PROP_BUILDERS);
  attachMeshyCivilInstances(
    group,
    "terrain-rock",
    instances,
    ctx,
    (inst) => inst.type.id.includes("boulder") || inst.type.id.includes("rock"),
  );
  return group;
});
registerFeatureRenderer("wall", (instances, ctx) =>
  renderCivil("features-wall", instances, ctx, PROP_BUILDERS),
);
