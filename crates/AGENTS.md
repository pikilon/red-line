# crates/ rules

* `crates/sim` is the deterministic simulation. It knows nothing about
  rendering, time, I/O or the browser; the only browser-facing surface is the
  documented `wasm_bindgen` API.
* Fixed-point only in game logic: no `f32`/`f64` (clippy denies float
  arithmetic), no wall-clock time, no unseeded randomness, no hash-order
  iteration (use `BTreeMap` or sorted `Vec`).
* `crates/headless` is a native binary that drives `sim` without a client.
* Shared dependency versions live in the root `[workspace.dependencies]`.
* Tests are named after the spec criterion, e.g. `fn ac_02_03_units_route_around_walls()`.
* Verify with `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo nextest run`
  and `wasm-pack build crates/sim --target web`.
