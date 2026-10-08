# 01 — Architecture

Status: approved for Phase 1. Elaborates D-05 (architecture), D-08 (agent
workflow) and the code rules in `AGENTS.md`, `crates/AGENTS.md` and
`client/AGENTS.md`. Feature specs (`02-*` onwards) define concrete interfaces
inside the boundaries set here.

## 1. Scope

In:

* Layer boundaries and the only allowed communication paths.
* Determinism rules and how they are enforced automatically.
* Numeric format (fixed-point), time model (ticks), coordinate system.
* WASM API versioning and the Web Worker message model.
* State hash definition (used for native vs WASM parity, replays, desync
  detection).
* Test locations and naming.

Out:

* Concrete gameplay systems (in feature specs).
* Networking/lockstep protocol (Phase 5 spec).
* Asset pipeline details (Phase 4 spec).

## 2. Layers

```
                 +-------------------- browser ----------------------+
 data/*.yaml --> | client/ (TypeScript, Three.js)                    |
 (Phase 2+)      |  main thread: render, input, UI, i18n, audio      |
                 |      |  postMessage (MainToWorker)  ^             |
                 |      v                              | WorkerToMain|
                 |  Web Worker: sim.worker.ts --> crates/sim (WASM)  |
                 +---------------------------------------------------+
                 native:  crates/headless --> crates/sim (rlib)
```

| Layer | Path | Owns | Must never |
|---|---|---|---|
| Simulation | `crates/sim` | All game state and outcomes; deterministic stepping; state hash | Render, read time, do I/O, touch the browser, use floats in logic |
| Headless | `crates/headless` | Native driver: scripts, hashes, (later) tournaments and replays | Contain game rules |
| Client | `client/` | Rendering, input, UI, i18n, audio, worker orchestration | Decide game outcomes or mutate sim state except through commands |
| Data | `data/` | Factions, units, weapons, AI scripts, maps in YAML + JSON Schema | Contain code |

Rules:

1. The client talks to the simulation **only** through the `wasm_bindgen` API
   exported by `crates/sim` (section 6), and only from inside the Web Worker.
   The main thread never instantiates the WASM module.
2. The main thread talks to the worker **only** through the typed messages in
   `client/src/sim/protocol.ts`.
3. `crates/headless` uses the same public Rust API of `crates/sim` that the
   WASM wrapper uses; it never reaches into private modules.
4. Selection, camera and UI state are client-side presentation state. They never
   affect the simulation except by producing commands.
5. Phase 1 has no `data/` directory: the single placeholder unit type and the
   test map are constants in `crates/sim` (see spec 02). From Phase 2 on, unit,
   weapon and map definitions move to `data/` and reach the sim as validated
   structures; balance changes then touch data only.

## 3. Determinism rules (`crates/sim`)

| Rule | Enforcement |
|---|---|
| No `f32`/`f64` in game logic | clippy `float_arithmetic = "deny"` (workspace) + `scripts/check-rules.mjs` rule `sim-float` |
| No hash-order iteration (`HashMap`, `HashSet`) | `clippy.toml` `disallowed-types` + rule `sim-hash-collection`; use `BTreeMap` or sorted `Vec` |
| No wall-clock time (`std::time`, `Instant`, `SystemTime`) | `clippy.toml` `disallowed-types` + rule `sim-wall-clock` |
| No unseeded randomness (`thread_rng`, `rand::random`) | rule `sim-unseeded-random`; the only RNG is the seeded `SplitMix64` in `crates/sim/src/rng.rs` |
| Iteration over units in ascending `UnitId` | spec + tests (state hash parity) |
| Integer overflow is a bug | arithmetic uses plain operators; debug builds panic on overflow, tests run in debug |

## 4. Numbers, time and space

* **Fixed-point:** `Fx` is Q16.16 stored in `i32` (`crates/sim/src/fixed.rs`).
  1.0 = raw `65536`. Multiplication uses an `i64` intermediate and an
  arithmetic right shift by 16 (rounds toward negative infinity). Division
  shifts the dividend left by 16 in `i64` and uses Rust integer division
  (truncates toward zero). Square roots use integer `isqrt` on `u64`.
* **Ticks:** the simulation advances in discrete ticks at `TICK_RATE_HZ = 15`.
  The sim has no notion of seconds; speeds are expressed per tick. The client
  converts wall-clock time into ticks inside the worker and interpolates
  between snapshots for rendering at the display refresh rate.
* **Coordinates:** the map is a grid of square cells, 1 cell = 1 tile = `Fx::ONE`.
  Sim position `(x, y)`: `x` grows east (column), `y` grows south (row). Cell
  `(cx, cy)` covers `[cx, cx+1) x [cy, cy+1)`; its centre is
  `(cx + 0.5, cy + 0.5)`. In Three.js, sim `(x, y)` maps to world
  `(x, 0, y)` (ground plane `y = 0`), one world unit per tile.
* The client may use JavaScript numbers (floats) for rendering, interpolation
  and input, and converts to raw fixed-point integers with
  `toRaw(tiles) = Math.round(tiles * 65536)` before sending a command.

## 5. State hash

`state_hash(world) -> u64` is FNV-1a 64-bit (offset basis
`0xcbf29ce484222325`, prime `0x100000001b3`) over a canonical little-endian
byte serialisation of the full simulation state, units in ascending id order.
The exact field order for Phase 1 is defined in spec 02 §4.8. Every phase that
adds state extends the serialisation and bumps `API_VERSION`. The hash is
exposed to JavaScript as a 16-character lowercase hex string (avoids `BigInt`).

Parity requirement: for the same seed and the same command script, the native
build (`crates/headless`) and the WASM build (run under Node in Vitest) produce
the same hash after the same number of ticks.

## 6. WASM API contract

* Exported from `crates/sim/src/wasm_api.rs`, built with
  `wasm-pack build crates/sim --target web` into `crates/sim/pkg/` (git-ignored
  build output).
* `pub const API_VERSION: u32` in `crates/sim/src/lib.rs` and
  `#[wasm_bindgen] pub fn api_version() -> u32`. Every breaking change to the
  exported API or to the hash serialisation increments it. Phase 1 sets it to
  `1`.
* The client declares `EXPECTED_API_VERSION` in `client/src/sim/protocol.ts`;
  the worker reports `api_version()` in its `ready` message and the main thread
  refuses to start on mismatch.
* Only primitive types, `Vec<u8>`/`Vec<i32>`/`&[u32]` and `String` cross the
  boundary. Fixed-point values cross as raw `i32`.
* Client code imports the generated package through the Vite/TypeScript alias
  `@sim` → `crates/sim/pkg` (configured in `client/vite.config.ts`,
  `client/vitest.config.ts` and `client/tsconfig.json`).

## 7. Worker model

* `client/src/sim/sim.worker.ts` is the only module that imports `@sim`
  (besides the Node parity test). It owns the `Sim` instance and the tick
  pacing loop.
* All logic of the worker lives in a pure, unit-testable
  `createWorkerHandler` (`client/src/sim/workerHandler.ts`) that receives a sim
  factory and a `post` function; `sim.worker.ts` only binds it to `self`.
* Messages are plain objects discriminated by a `type` string. Dispatch uses a
  constant handler dictionary keyed by `type`, never `switch`.
* Snapshots are transferred (`Transferable`) as `Int32Array` buffers.

## 8. Client code rules (recap, enforced)

* No `switch` and no `enum` in `client/src` (Biome + `scripts/check-rules.mjs`
  rules `ts-switch`, `ts-enum`); use `as const` objects and dictionaries.
* Player-facing strings come from `client/src/i18n/en.json` through `t()`.
* No module under `client/src` decides outcomes (damage, movement, pathing).

## 9. Tests and naming

| Layer | Location | Naming |
|---|---|---|
| Sim (Rust) | `crates/sim/tests/<topic>.rs` (integration, public API only) | `fn ac_NN_MM_<snake_summary>()` |
| Headless (Rust) | `crates/headless/tests/<topic>.rs` | `fn ac_NN_MM_<snake_summary>()` |
| Client unit (Vitest) | next to the module, `*.test.ts` | `it("AC-NN-MM: <summary>")` |
| Client E2E (Playwright) | `client/tests/e2e/*.spec.ts` | `test("AC-NN-MM: <summary>")` |
| Scripts (node:test) | `scripts/*.test.mjs` | `test("AC-NN-MM: <summary>")` |

`NN` is the spec number, `MM` the criterion number. One criterion may have
several tests; each test name starts with exactly one criterion ID. Tests
written in the spec phase are never modified by implementation PRs (D-08).

## 10. Acceptance criteria

### AC-01-01 — Float types are rejected in the simulation

Given a Rust source file under `crates/sim/src/` containing the token `f32` or
`f64` outside a `//` line comment,
When `findViolations` from `scripts/check-rules.mjs` scans it,
Then it returns a violation with rule `sim-float` and the 1-based line number.

### AC-01-02 — Non-deterministic APIs are rejected in the simulation

Given a Rust source file under `crates/sim/src/` containing `HashMap` or
`HashSet` (rule `sim-hash-collection`), `std::time`, `SystemTime` or `Instant`
(rule `sim-wall-clock`), or `thread_rng` or `rand::random` (rule
`sim-unseeded-random`) outside a `//` line comment,
When `findViolations` scans it,
Then it returns one violation per offending line with the matching rule.

### AC-01-03 — `switch` and `enum` are rejected in the client

Given a TypeScript file under `client/src/` containing `switch (` (rule
`ts-switch`) or `enum <Identifier>` (rule `ts-enum`) outside a `//` line
comment,
When `findViolations` scans it,
Then it returns a violation with that rule and line.

### AC-01-04 — Rules checker passes on clean input and ignores other paths

Given files that contain no forbidden tokens, or forbidden tokens only in `//`
line comments, or `f64` in a file outside `crates/sim/src/` (e.g.
`client/src/a.ts`, `crates/headless/src/main.rs`),
When `findViolations` scans them,
Then it returns an empty array; and `node scripts/check-rules.mjs` run on the
repository exits with code 0 (it exits 1 and prints `file:line rule` per
violation otherwise).

### AC-01-05 — API version is 1 and mismatches are refused

Given the Phase 1 simulation,
When `sim::api_version()` is called natively,
Then it returns `1`; and given a worker `ready` message whose `apiVersion` is
not `EXPECTED_API_VERSION`, when `createSimClient` receives it, then its
`ready` promise rejects with an `Error` whose message contains
`api version mismatch`.

## 11. Interfaces

### `scripts/check-rules.mjs`

```js
/** @typedef {"sim-float"|"sim-hash-collection"|"sim-wall-clock"|"sim-unseeded-random"|"ts-switch"|"ts-enum"} RuleId */
/** @typedef {{ file: string, line: number, rule: RuleId }} Violation */

/** Repository-relative POSIX paths. Rules by path prefix:
 *  "crates/sim/src/" + ".rs": sim-float /\bf(32|64)\b/,
 *     sim-hash-collection /\bHash(Map|Set)\b/,
 *     sim-wall-clock /std::time|\bSystemTime\b|\bInstant\b/,
 *     sim-unseeded-random /\bthread_rng\b|rand::random/
 *  "client/src/" + ".ts": ts-switch /\bswitch\s*\(/, ts-enum /\benum\s+[A-Za-z_]\w*/
 *  Before matching, everything from the first "//" on a line is removed.
 *  Results are sorted by file, then line, then rule. */
export function findViolations(files /* {path: string, content: string}[] */) /* : Violation[] */;

/** CLI (when run directly): walks crates/sim/src and client/src from the
 *  repository root, prints "<file>:<line> <rule>" per violation, exit 1 if any. */
```

Root `package.json` gains:

* `"check:rules": "node scripts/check-rules.mjs"`
* `"test:scripts": "node --test scripts/"`
* both inserted in `verify` right after `check:rust`.

### `clippy.toml` (repository root)

```toml
disallowed-types = [
  { path = "std::collections::HashMap", reason = "hash-order iteration breaks determinism; use BTreeMap" },
  { path = "std::collections::HashSet", reason = "hash-order iteration breaks determinism; use BTreeSet" },
  { path = "std::time::Instant", reason = "no wall-clock time in the simulation" },
  { path = "std::time::SystemTime", reason = "no wall-clock time in the simulation" },
]
```

### API version

* `crates/sim/src/lib.rs`: `pub const API_VERSION: u32 = 1;` (the skeleton test
  `api_version_is_zero_in_the_skeleton` and the headless banner test predate the
  specs and are updated to `1` by the implementing issue).
* `client/src/sim/protocol.ts`: `export const EXPECTED_API_VERSION = 1;`

## 12. Traceability

| Criterion | Test file | Test name |
|---|---|---|
| AC-01-01 | `scripts/check-rules.test.mjs` | `AC-01-01: rejects f32 and f64 in the simulation` |
| AC-01-02 | `scripts/check-rules.test.mjs` | `AC-01-02: rejects hash collections, wall-clock time and unseeded randomness in the simulation` |
| AC-01-03 | `scripts/check-rules.test.mjs` | `AC-01-03: rejects switch and enum in client TypeScript` |
| AC-01-04 | `scripts/check-rules.test.mjs` | `AC-01-04: accepts clean files, comments and other paths` |
| AC-01-05 | `crates/sim/tests/wasm_api.rs` | `ac_01_05_api_version_is_one` |
| AC-01-05 | `client/src/sim/simClient.test.ts` | `AC-01-05: rejects a worker with a mismatched api version` |

## 13. Issue breakdown

Issues for this spec are part of the Phase 1 queue in
`specs/02-phase1-tech-slice.md` §7 (issue P1-01 covers AC-01-01..04; AC-01-05
is covered by P1-08 and P1-12).
