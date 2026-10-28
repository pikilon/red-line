import { BUILDERS } from "../civil/buildings";
import { PROP_BUILDERS } from "../civil/props";
import { renderCivil } from "../civil/render";
import { registerFeatureRenderer } from "../registry";

// Spec 26 section 5.1-5.2: civilian buildings, walls and props.
registerFeatureRenderer("building", (instances, ctx) =>
  renderCivil("features-building", instances, ctx, BUILDERS),
);
registerFeatureRenderer("prop", (instances, ctx) =>
  renderCivil("features-prop", instances, ctx, PROP_BUILDERS),
);
registerFeatureRenderer("wall", (instances, ctx) =>
  renderCivil("features-wall", instances, ctx, PROP_BUILDERS),
);
