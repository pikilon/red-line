# crates/ rules

* `crates/sim` exposes the browser only through the documented `wasm_bindgen`
  API. Use `BTreeMap` or a sorted `Vec` instead of hash collections.
* `crates/headless` is a native binary that drives `sim` without a client.
* Tests are named after the spec criterion, e.g. `fn ac_02_03_units_route_around_walls()`.
* Layer checks: `node --run check:rust` and `node --run build:wasm`.
