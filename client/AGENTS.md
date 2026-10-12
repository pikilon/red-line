# client/ rules

* The simulation runs as WASM in a Web Worker; the client only sends commands
  and renders state.
* Camera is a fixed orthographic isometric camera (2.5D).
* DOM overlays (command panel, HUD) update on events, never re-render every
  frame: per-frame re-renders made buttons unclickable with a real mouse.
* Unit tests (Vitest) live next to the module as `*.test.ts`; E2E tests
  (Playwright) live in `tests/e2e/` and are titled `AC-NN-NN: ...`.
* Layer checks: `node --run check`, `typecheck`, `test:unit`, `build`, `test:e2e`.
