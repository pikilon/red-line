# client/ rules

* TypeScript (strict) + Three.js + Vite. The client never decides game outcomes:
  it sends commands to the simulation (WASM, Web Worker) and renders state.
* Camera is a fixed orthographic isometric camera (2.5D).
* Never use `switch` (use a constant object dictionary) or `enum` (use `as const`
  objects with derived types).
* Player-facing strings go through i18n files, never hardcoded.
* Unit tests (Vitest) live next to the module as `*.test.ts`; E2E tests
  (Playwright) live in `tests/e2e/` and are titled `AC-NN-NN: ...`.
* Run scripts with `node --run <script>`, never `npm run`.
* Verify with `node --run check && node --run typecheck && node --run test:unit && node --run build && node --run test:e2e`.
