# 02 — Phase 1 tech slice

Status: approved for implementation. Depends on `00-vision.md` and
`01-architecture.md`. Roadmap: Phase 1.

## 1. Context

Phase 1 proves the technical foundation before any gameplay: an isometric map,
unit selection, right-click movement driven by flow-field pathfinding, a
deterministic fixed-point simulation compiled to WASM and running inside a Web
Worker, 500 placeholder units rendered at 60 fps, and an identical state hash
for the native and WASM builds.

**Exit criterion of Phase 1:** every acceptance criterion below has a passing
test in CI (AC-02-44 runs locally on the reference machine, see §3), and the
owner can open the preview build, box-select units and move them around the
wall through the gap.

## 2. Scope

In:

* `crates/sim`: fixed-point math, seeded RNG, map grid with the built-in
  tech-slice map, flow fields (cost, integration, direction), unit move orders,
  movement, separation, arrival, state hash, snapshot encoding, WASM API.
* `crates/headless`: `hash` subcommand that runs a command script and prints
  the state hash.
* `client/`: worker protocol and handler, sim client, snapshot decoding and
  interpolation, terrain and instanced unit rendering, click and box selection,
  right-click move, keyboard camera pan, HUD with i18n, debug API for tests,
  performance test project, debug-only performance panel (AC-02-46).
* Repository: rules checker (`scripts/check-rules.mjs`) and `clippy.toml`
  from spec 01.

Out (later phases):

* `data/` YAML and JSON Schema (single placeholder unit type and the map are
  constants in the sim in Phase 1).
* Unit types, combat, health, buildings, resources, production, fog of war,
  AI, audio, real models, minimap, mouse edge scrolling, zoom, rotation,
  control groups, shift-add selection, formations, waypoints.
* Unit-vs-unit hard collision and terrain heights (units may overlap briefly;
  only soft separation is in scope).
* Lockstep networking, replays on disk, save games, PWA/offline caching.

## 3. Constants

| Name | Value | Location |
|---|---|---|
| `API_VERSION` / `EXPECTED_API_VERSION` | `1` | `crates/sim/src/lib.rs`, `client/src/sim/protocol.ts` |
| `TICK_RATE_HZ` | `15` | `crates/sim/src/world.rs`, `client/src/sim/protocol.ts` |
| `MAX_UNITS` | `2000` | `crates/sim/src/world.rs` |
| `UNIT_SPEED` | `Fx::from_raw(13107)` (0.2 tile/tick = 3 tiles/s) | `world.rs` |
| `SEPARATION_DISTANCE` | `Fx::from_raw(32768)` (0.5 tile) | `world.rs` |
| `MAX_SEPARATION_PUSH` | `Fx::from_raw(6553)` | `world.rs` |
| `ARRIVAL_CONTACT` | `Fx::from_raw(39321)` (0.6 tile) | `world.rs` |
| `COST_ORTHOGONAL` / `COST_DIAGONAL` | `10` / `14` | `crates/sim/src/flow.rs` |
| `DIAGONAL_COMPONENT` | `46341` (≈ 0.70711) | `flow.rs` |
| `TECH_SLICE_SIZE` | `128` (width = height) | `crates/sim/src/map.rs` |
| `MAX_STEPS_PER_ADVANCE` | `4` | `client/src/sim/protocol.ts` |
| `DEFAULT_SEED` / `DEFAULT_UNIT_COUNT` | `1` / `500` | `client/src/main.ts` |
| `CLICK_PICK_RADIUS_TILES` | `0.5` | `client/src/input/selection.ts` |
| `DRAG_THRESHOLD_PX` | `4` | `client/src/input/selection.ts` |
| `PAN_SPEED_TILES_PER_SECOND` | `20` | `client/src/input/cameraPan.ts` |
| `PERF_WINDOW_FRAMES` | `120` | `client/src/perfPanel.ts` |
| `PERF_BAD_P95_MS` | `19` (same threshold as AC-02-44) | `client/src/perfPanel.ts` |
| `PERF_PANEL_UPDATE_MS` | `250` | `client/src/perfPanel.ts` |

Performance target (AC-02-44) is measured only on the reference machine
(Apple M2 Max, D-09) by `node --run test:perf`; CI runs on GPU-less runners, so
CI enforces the hardware-independent proxy AC-02-42 (draw calls) instead.

## 4. Simulation design (`crates/sim`)

### 4.1 Module layout

`crates/sim/src/lib.rs`:

```rust
pub mod fixed;
pub mod flow;
pub mod hash;
pub mod map;
pub mod rng;
pub mod snapshot;
pub mod world;
mod wasm_api;

pub use wasm_api::Sim;

pub const API_VERSION: u32 = 1;

#[wasm_bindgen::prelude::wasm_bindgen]
pub fn api_version() -> u32 { API_VERSION }
```

### 4.2 Fixed point (`fixed.rs`)

```rust
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Fx(i32);

impl Fx {
    pub const FRAC_BITS: u32 = 16;
    pub const ZERO: Fx = Fx(0);
    pub const ONE: Fx = Fx(65536);
    pub const HALF: Fx = Fx(32768);
    pub const fn from_raw(raw: i32) -> Fx;
    pub const fn raw(self) -> i32;
    pub const fn from_int(n: i32) -> Fx;          // n << 16
    pub const fn floor_to_int(self) -> i32;       // raw >> 16 (arithmetic)
    pub fn mul(self, rhs: Fx) -> Fx;              // ((a as i64 * b as i64) >> 16) as i32
    pub fn div(self, rhs: Fx) -> Fx;              // (((a as i64) << 16) / (b as i64)) as i32; panics if rhs == 0
    pub fn sqrt(self) -> Fx;                      // negative -> ZERO; else isqrt_u64((raw as u64) << 16)
}
impl core::ops::Add for Fx;   // raw + raw
impl core::ops::Sub for Fx;   // raw - raw
impl core::ops::Neg for Fx;   // -raw

/// floor(sqrt(n)), exact for all u64 (integer Newton or bitwise method, no floats).
pub fn isqrt_u64(n: u64) -> u64;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FxVec2 { pub x: Fx, pub y: Fx }

impl FxVec2 {
    pub const ZERO: FxVec2;
    pub const fn new(x: Fx, y: Fx) -> FxVec2;
    /// Fx::from_raw(isqrt_u64(x.raw² + y.raw² computed in i64, as u64) as i32)
    pub fn length(self) -> Fx;
    /// ZERO if length is ZERO; else (x.div(len), y.div(len)).
    pub fn normalize(self) -> FxVec2;
    /// (x.mul(s), y.mul(s))
    pub fn scale(self, s: Fx) -> FxVec2;
}
impl core::ops::Add for FxVec2;
impl core::ops::Sub for FxVec2;
```

### 4.3 RNG (`rng.rs`)

SplitMix64, the only randomness source.

```rust
pub struct SplitMix64 { state: u64 }
impl SplitMix64 {
    pub const fn new(seed: u64) -> SplitMix64;
    /// state = state.wrapping_add(0x9E3779B97F4A7C15); z = state;
    /// z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    /// z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    /// return z ^ (z >> 31)
    pub fn next_u64(&mut self) -> u64;
    pub fn next_u32(&mut self) -> u32;   // (next_u64() >> 32) as u32
}
```

### 4.4 Map (`map.rs`)

```rust
pub type CellIndex = u32;   // y * width + x

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Cell { pub x: i32, pub y: i32 }

pub const TECH_SLICE_SIZE: u16 = 128;
/// Inclusive spawn rectangle of the tech-slice map: x 4..=56, y 4..=123.
pub const SPAWN_MIN: Cell = Cell { x: 4, y: 4 };
pub const SPAWN_MAX: Cell = Cell { x: 56, y: 123 };

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapGrid { width: u16, height: u16, blocked: Vec<bool> }

impl MapGrid {
    pub fn open(width: u16, height: u16) -> MapGrid;     // all passable
    pub fn tech_slice() -> MapGrid;                       // see layout below
    pub fn width(&self) -> u16;
    pub fn height(&self) -> u16;
    pub fn in_bounds(&self, cell: Cell) -> bool;
    pub fn set_blocked(&mut self, cell: Cell, blocked: bool);  // panics out of bounds
    pub fn is_passable(&self, cell: Cell) -> bool;        // out of bounds -> false
    pub fn index(&self, cell: Cell) -> CellIndex;
    pub fn cell(&self, index: CellIndex) -> Cell;
    pub fn tiles(&self) -> Vec<u8>;                       // row-major, 0 passable, 1 blocked
    /// r = 0, 1, 2, ... up to max(width, height): scan the cells at Chebyshev
    /// distance exactly r from `cell` in row-major order (y ascending, then x
    /// ascending), skipping out-of-bounds cells; return the first passable one.
    pub fn nearest_passable(&self, cell: Cell) -> Option<Cell>;
}

pub fn cell_of(pos: FxVec2) -> Cell;        // (x.floor_to_int(), y.floor_to_int())
pub fn cell_center(cell: Cell) -> FxVec2;   // (x << 16) + 32768, (y << 16) + 32768
```

Tech-slice layout (128 x 128). A cell `(x, y)` is blocked iff any holds
(ranges inclusive):

1. Border: `x == 0 || y == 0 || x == 127 || y == 127`.
2. Wall: `60 <= x <= 63 && !(60 <= y <= 67)` (the only gap is at y 60..=67).
3. Block A: `30 <= x <= 37 && 30 <= y <= 37`.
4. Block B: `90 <= x <= 97 && 80 <= y <= 95`.

### 4.5 Flow fields (`flow.rs`)

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Dir8 { N, NE, E, SE, S, SW, W, NW }

pub const COST_ORTHOGONAL: u32 = 10;
pub const COST_DIAGONAL: u32 = 14;
pub const UNREACHABLE: u32 = u32::MAX;
pub const DIAGONAL_COMPONENT: i32 = 46341;

impl Dir8 {
    pub const ALL: [Dir8; 8] = [N, NE, E, SE, S, SW, W, NW];
    pub const fn offset(self) -> (i32, i32);   // N=(0,-1) NE=(1,-1) E=(1,0) SE=(1,1) S=(0,1) SW=(-1,1) W=(-1,0) NW=(-1,-1)
    pub const fn is_diagonal(self) -> bool;
    pub const fn cost(self) -> u32;            // 10 or 14
    /// Orthogonal: components 0 / ±65536. Diagonal: components ±46341.
    pub fn unit_vector(self) -> FxVec2;
}

#[derive(Clone, Debug)]
pub struct FlowField { goal: Cell, width: u16, height: u16, integration: Vec<u32>, directions: Vec<Option<Dir8>> }

impl FlowField {
    pub fn compute(map: &MapGrid, goal: Cell) -> FlowField;
    pub fn goal(&self) -> Cell;
    pub fn integration(&self, cell: Cell) -> u32;            // UNREACHABLE if out of bounds/blocked/unreachable
    pub fn direction(&self, cell: Cell) -> Option<Dir8>;     // None at goal, blocked or unreachable
}

/// True iff a unit may move from `from` one step in `dir`: the target cell is
/// passable and, for diagonals, both orthogonally adjacent cells are passable
/// (no corner cutting).
pub fn can_step(map: &MapGrid, from: Cell, dir: Dir8) -> bool;
```

Algorithm (normative):

1. `integration[goal] = 0` if the goal is passable, every other cell
   `UNREACHABLE`. If the goal is blocked, every cell stays `UNREACHABLE`.
2. Dijkstra from the goal using `std::collections::BinaryHeap<Reverse<(u32, CellIndex)>>`.
   Expanding cell `c`, for each `d` in `Dir8::ALL` with `can_step(map, c, d)`,
   relax neighbour `n` with `integration[c] + d.cost()`. (Moves are symmetric,
   so this equals the cost from `n` to the goal.)
3. For each reachable non-goal cell `c`: `direction[c]` is the `d` in
   `Dir8::ALL` with `can_step(map, c, d)` that minimises
   `integration[neighbour] + d.cost()`; ties resolve to the earliest `d` in
   `Dir8::ALL`.

### 4.6 World (`world.rs`)

```rust
pub type UnitId = u32;

pub const TICK_RATE_HZ: u32 = 15;
pub const MAX_UNITS: u32 = 2000;
pub const UNIT_SPEED: Fx = Fx::from_raw(13107);
pub const SEPARATION_DISTANCE: Fx = Fx::from_raw(32768);
pub const MAX_SEPARATION_PUSH: Fx = Fx::from_raw(6553);
pub const ARRIVAL_CONTACT: Fx = Fx::from_raw(39321);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Order {
    /// `last_order_id` is the order this unit completed (0 = none).
    Idle { last_order_id: u32 },
    Move { order_id: u32, target: FxVec2, goal: Cell },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Unit { pub id: UnitId, pub pos: FxVec2, pub order: Order }

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command { Move { units: Vec<UnitId>, target: FxVec2 } }

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SimError { TooManyUnits { requested: u32, max: u32 } }

pub struct World {
    tick: u32,
    map: MapGrid,
    units: Vec<Unit>,                          // index == id, ascending
    next_order_id: u32,                        // starts at 1
    pending: Vec<Command>,
    fields: std::collections::BTreeMap<CellIndex, FlowField>,  // keyed by goal cell
}

impl World {
    pub fn new(map: MapGrid) -> World;                                   // tick 0, no units
    pub fn tech_slice(seed: u64, unit_count: u32) -> Result<World, SimError>;
    /// Appends a unit with id = current unit count, order Idle { last_order_id: 0 }.
    /// Panics if `pos` is not in a passable cell.
    pub fn spawn_unit_at(&mut self, pos: FxVec2) -> UnitId;
    pub fn enqueue(&mut self, command: Command);                         // applied at the start of the next step
    pub fn step(&mut self);
    pub fn tick(&self) -> u32;
    pub fn map(&self) -> &MapGrid;
    pub fn units(&self) -> &[Unit];
    pub fn unit(&self, id: UnitId) -> Option<&Unit>;
    pub fn next_order_id(&self) -> u32;
    pub fn flow_field_count(&self) -> usize;
}
```

`World::tech_slice(seed, unit_count)`:

1. `unit_count > MAX_UNITS` → `Err(SimError::TooManyUnits { requested, max: MAX_UNITS })`.
2. `map = MapGrid::tech_slice()`, `rng = SplitMix64::new(seed)`.
3. Iterate cells of the spawn rectangle in row-major order (y outer ascending, x
   inner ascending), skipping blocked cells. Unit `i` (for `i` in
   `0..unit_count`) goes to the `i`-th such cell:
   `pos.x = cell_center.x + ((rng.next_u32() % 32768) as i32 - 16384)`, then
   `pos.y = cell_center.y + ((rng.next_u32() % 32768) as i32 - 16384)` (raw
   values; two RNG draws per unit, x first).

`World::step()` runs these phases in order, then `tick += 1`:

1. **Commands.** For each pending command in enqueue order, then clear the
   queue. `Command::Move { units, target }`:
   1. Clamp `target.x` to `[0, width * 65536 - 1]` and `target.y` to
      `[0, height * 65536 - 1]` (raw).
   2. If `cell_of(target)` is blocked: `nearest_passable` of that cell; if
      `None` ignore the command; otherwise `target = cell_center(found)`.
   3. `goal = cell_of(target)`; compute and insert the flow field for `goal`
      if absent.
   4. `order_id = next_order_id; next_order_id += 1`.
   5. For each id in `units` (in list order; unknown ids and duplicates are
      ignored): `order = Move { order_id, target, goal }`.
2. **Movement.** For each unit with a `Move` order, `c = cell_of(pos)`:
   * If `c == goal`: `delta = target - pos`; if `delta.length() <= UNIT_SPEED`,
     `pos = target` and `order = Idle { last_order_id: order_id }`; otherwise
     `pos = pos + delta.normalize().scale(UNIT_SPEED)`.
   * Else if `field.direction(c)` is `Some(d)`:
     `pos = pos + d.unit_vector().scale(UNIT_SPEED)`.
   * Else (unreachable): `order = Idle { last_order_id: order_id }`.
3. **Separation.** Using a copy `before` of all positions taken at the start of
   this phase, for each unit `a`, sum over every other unit `b` whose
   `before` position lies in one of the 3 x 3 cells around `cell_of(before[a])`
   and with `d = (before[a] - before[b]).length() < SEPARATION_DISTANCE`:
   * if `d == 0`: term = `(-HALF_PUSH, 0)` if `a.id < b.id` else
     `(+HALF_PUSH, 0)`, where `HALF_PUSH = SEPARATION_DISTANCE.raw() / 2`;
   * else: term = `(before[a] - before[b]).normalize().scale(Fx::from_raw((SEPARATION_DISTANCE - d).raw() / 2))`.

   If `push.length() > MAX_SEPARATION_PUSH`,
   `push = push.normalize().scale(MAX_SEPARATION_PUSH)`. Apply per axis:
   `x' = pos.x + push.x` if `cell_of((x', pos.y))` is passable; then
   `y' = pos.y + push.y` if `cell_of((current x, y'))` is passable.
   (Summation is exact integer arithmetic, so iteration order inside a unit
   does not change the result; units are still visited in ascending id.)
4. **Contact arrival.** Using the order states at the start of this phase: a
   unit with `Move { order_id, .. }` becomes `Idle { last_order_id: order_id }`
   if some unit that was `Idle { last_order_id: order_id }` is within
   `ARRIVAL_CONTACT` (length `<=`) of it.
5. **Cleanup.** Remove every flow field whose goal is not the `goal` of any
   unit's `Move` order.

Invariant: a unit's cell is always passable (`UNIT_SPEED` < 1 tile, diagonal
steps only where `can_step` allows, separation rejects blocked axes).

### 4.7 Snapshot (`snapshot.rs`)

```rust
pub const SNAPSHOT_HEADER_LEN: usize = 2;
pub const UNIT_STRIDE: usize = 4;
pub const FLAG_MOVING: i32 = 1;
/// [tick, unit_count, then per unit ascending id: id, x_raw, y_raw, flags]
/// flags bit 0 = FLAG_MOVING when the order is Move.
pub fn encode_snapshot(world: &World) -> Vec<i32>;
```

### 4.8 State hash (`hash.rs`)

```rust
pub const FNV_OFFSET: u64 = 0xcbf29ce484222325;
pub const FNV_PRIME: u64 = 0x100000001b3;
pub fn fnv1a64(bytes: &[u8]) -> u64;
pub fn state_hash(world: &World) -> u64;
```

`state_hash` is FNV-1a 64 over this little-endian byte stream:
`tick: u32`, `next_order_id: u32`, `unit_count: u32`, then per unit in
ascending id: `id: u32`, `pos.x raw: i32`, `pos.y raw: i32`, then for `Idle`:
`0u8`, `last_order_id: u32`; for `Move`: `1u8`, `order_id: u32`,
`target.x raw: i32`, `target.y raw: i32`. (Flow fields are derived data and are
not hashed. Pending commands are empty between steps.)

### 4.9 WASM API (`wasm_api.rs`)

```rust
#[wasm_bindgen]
pub struct Sim { world: World }

#[wasm_bindgen]
impl Sim {
    /// Tech-slice scenario. Err(String) contains "too many units".
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32, unit_count: u32) -> Result<Sim, String>;
    pub fn map_width(&self) -> u32;
    pub fn map_height(&self) -> u32;
    pub fn map_tiles(&self) -> Vec<u8>;                  // MapGrid::tiles
    pub fn tick(&self) -> u32;
    pub fn unit_count(&self) -> u32;
    /// Enqueues Command::Move { units: unit_ids.to_vec(), target: (raw x, raw y) }.
    pub fn command_move(&mut self, unit_ids: &[u32], target_x_raw: i32, target_y_raw: i32);
    pub fn step(&mut self);
    pub fn step_n(&mut self, n: u32);
    pub fn snapshot(&self) -> Vec<i32>;                  // encode_snapshot
    pub fn state_hash_hex(&self) -> String;              // format!("{:016x}", state_hash)
}
```

`seed` is widened with `u64::from(seed)`.

### 4.10 Headless (`crates/headless`)

* `crates/headless/src/script.rs` (module of the binary crate; `serde` and
  `serde_json` are added as `[workspace.dependencies]` and used only by
  `headless`):

```rust
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Script { pub seed: u32, pub units: u32, pub ticks: u32, pub commands: Vec<ScriptCommand> }

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScriptCommand { pub tick: u32, pub unit_range: [u32; 2], pub target: [i32; 2] }

/// Builds World::tech_slice(seed, units); for t in 0..ticks: enqueue (in file
/// order) every command with tick == t as Move { units: unit_range[0]..unit_range[1], target },
/// then step(). Returns state_hash.
pub fn run_script(script: &Script) -> Result<u64, sim::world::SimError>;
```

* CLI: `headless` (no args) prints the existing banner. `headless hash <path>`
  prints `format!("{:016x}\n", hash)` to stdout and exits 0. Unreadable or
  invalid file, or unknown subcommand: message on stderr, exit code 2.
* Fixture `crates/sim/tests/fixtures/tech-slice-script.json` (exact content):

```json
{
  "seed": 42,
  "units": 500,
  "ticks": 600,
  "commands": [
    { "tick": 0, "unitRange": [0, 250], "target": [6586368, 1343488] },
    { "tick": 0, "unitRange": [250, 500], "target": [6586368, 6586368] },
    { "tick": 300, "unitRange": [0, 100], "target": [1343488, 6586368] }
  ]
}
```

(Targets in tiles: (100.5, 20.5), (100.5, 100.5), (20.5, 100.5).)

## 5. Client design (`client/`)

### 5.1 Build wiring

* Alias `@sim` → `../crates/sim/pkg` in `client/vite.config.ts` and
  `client/vitest.config.ts` (`resolve.alias`), and
  `"paths": { "@sim/*": ["../crates/sim/pkg/*"] }` plus
  `"resolveJsonModule": true` in `client/tsconfig.json`.
* `vite.config.ts` adds `worker: { format: "es" }` and
  `server.fs.allow: [".."]`.
* The worker is created with
  `new Worker(new URL("./sim/sim.worker.ts", import.meta.url), { type: "module" })`.
* `node --run verify` already builds WASM before client checks; no order change.

### 5.2 Protocol (`client/src/sim/protocol.ts`)

```ts
export const EXPECTED_API_VERSION = 1;
export const TICK_RATE_HZ = 15;
export const TICK_MS = 1000 / TICK_RATE_HZ;
export const MAX_STEPS_PER_ADVANCE = 4;
export const SNAPSHOT_HEADER_LEN = 2;
export const UNIT_STRIDE = 4;
export const FLAG_MOVING = 1;

export type InitMessage = { type: "init"; seed: number; unitCount: number };
export type MoveMessage = { type: "move"; unitIds: number[]; targetXRaw: number; targetYRaw: number };
export type HashRequestMessage = { type: "hashRequest"; requestId: number };
export type MainToWorker = InitMessage | MoveMessage | HashRequestMessage;

export type ReadyMessage = { type: "ready"; apiVersion: number; mapWidth: number; mapHeight: number; tiles: Uint8Array };
export type SnapshotMessage = { type: "snapshot"; data: Int32Array };
export type HashMessage = { type: "hash"; requestId: number; hash: string };
export type ErrorMessage = { type: "error"; detail: string };
export type WorkerToMain = ReadyMessage | SnapshotMessage | HashMessage | ErrorMessage;
```

### 5.3 Fixed conversion (`client/src/sim/fixed.ts`)

```ts
export const FX_ONE = 65536;
export function toRaw(tiles: number): number;    // Math.round(tiles * FX_ONE)
export function fromRaw(raw: number): number;    // raw / FX_ONE
```

### 5.4 Snapshot (`client/src/sim/snapshot.ts`)

```ts
export interface UnitState { id: number; x: number; y: number; moving: boolean }  // x, y in tiles
export interface Snapshot { tick: number; units: UnitState[] }
export function decodeSnapshot(data: Int32Array): Snapshot;
/** alpha clamped to [0, 1]; for each unit of `next` with the same id at the
 *  same index in `prev`: x = prev.x + (next.x - prev.x) * alpha (same for y);
 *  otherwise the `next` values. `moving` always from `next`. */
export function interpolateUnits(prev: Snapshot, next: Snapshot, alpha: number): UnitState[];
```

### 5.5 Worker handler (`client/src/sim/workerHandler.ts`) and entry

```ts
export interface SimLike {
  map_width(): number; map_height(): number; map_tiles(): Uint8Array;
  tick(): number; command_move(unitIds: Uint32Array, targetXRaw: number, targetYRaw: number): void;
  step(): void; snapshot(): Int32Array; state_hash_hex(): string;
}
export type SimFactory = (seed: number, unitCount: number) => SimLike;
export type Post = (message: WorkerToMain, transfer?: Transferable[]) => void;
export interface WorkerHandler { handle(message: MainToWorker): void; advance(nowMs: number): void }
export function createWorkerHandler(factory: SimFactory, apiVersion: number, post: Post): WorkerHandler;
```

Behaviour (dispatch through a `const handlers = { init, move, hashRequest }`
dictionary):

* `init`: create the sim with `factory(seed, unitCount)`; on throw post
  `{ type: "error", detail: String(error) }`; otherwise post `ready` with
  `apiVersion`, map size and `map_tiles()`, then post one `snapshot`.
* `move`: `command_move(Uint32Array.from(unitIds), targetXRaw, targetYRaw)`.
  Ignored before `init`.
* `hashRequest`: post `{ type: "hash", requestId, hash: state_hash_hex() }`.
* `advance(nowMs)`: no-op before `init`. The first call after `init` only
  records `nowMs`. Later calls add `max(0, nowMs - last)` to an accumulator;
  `steps = min(floor(acc / TICK_MS), MAX_STEPS_PER_ADVANCE)`; call `step()`
  `steps` times; `acc -= steps * TICK_MS`, but if `steps ==
  MAX_STEPS_PER_ADVANCE` set `acc = 0`. If `steps > 0` post exactly one
  `snapshot` (the `Int32Array` buffer in the transfer list).

`client/src/sim/sim.worker.ts` (not unit-tested; covered by E2E): imports
`init, { Sim, api_version }` from `@sim/sim.js`. Before awaiting `init()` it
sets `onmessage` to push `event.data` into an `early` queue, so messages posted
while the WASM module loads are not dropped. After `init()` resolves it builds
the handler with `(seed, n) => new Sim(seed, n)`, sets `onmessage` to
`handler.handle(event.data)`, replays the queued messages in arrival order
through `handler.handle` (emptying the queue), and calls
`handler.advance(performance.now())` every `1000 / 60` ms with `setInterval`. It types `self` through a local
`interface WorkerScope { postMessage(m: WorkerToMain, t?: Transferable[]): void; onmessage: ((e: MessageEvent<MainToWorker>) => void) | null }`.

### 5.6 Sim client (`client/src/sim/simClient.ts`)

```ts
export interface WorkerLike {
  postMessage(message: MainToWorker): void;
  onmessage: ((event: MessageEvent<WorkerToMain>) => void) | null;
}
export interface SimClient {
  readonly ready: Promise<ReadyMessage>;
  move(unitIds: readonly number[], targetXRaw: number, targetYRaw: number): void;
  requestHash(): Promise<string>;
  /** Returns an unsubscribe function. */
  onSnapshot(listener: (snapshot: Snapshot, receivedAtMs: number) => void): () => void;
}
export function createSimClient(
  worker: WorkerLike,
  options: { seed: number; unitCount: number },
  now?: () => number,   // default () => performance.now()
): SimClient;
```

Posts `init` immediately. `ready` resolves on a `ready` message with
`apiVersion === EXPECTED_API_VERSION`, rejects with
`Error("api version mismatch: expected 1, got <n>")` otherwise, and rejects with
`Error(detail)` on an `error` message. `requestHash` uses increasing
`requestId`s starting at 1.

### 5.7 Rendering

`client/src/render/terrain.ts`:

```ts
export const PASSABLE_COLOR = 0x4a6b3a;
export const BLOCKED_COLOR = 0x5a5a5a;
/** One Mesh, one indexed BufferGeometry: 4 vertices per tile at y = 0
 *  (tile (x, y) spans world x..x+1, z y..y+1), "position" and "color"
 *  attributes, MeshBasicMaterial({ vertexColors: true }). */
export function createTerrain(width: number, height: number, tiles: Uint8Array): Mesh;
```

`client/src/render/units.ts`:

```ts
export const UNIT_COLOR = 0x3b82f6;
export const SELECTED_COLOR = 0xfacc15;
export interface UnitsRenderer {
  readonly mesh: InstancedMesh;
  /** mesh.count = units.length; instance i at world (x, 0.25, y);
   *  instance colour SELECTED_COLOR if selected.has(id) else UNIT_COLOR. */
  update(units: readonly UnitState[], selected: ReadonlySet<number>): void;
}
/** BoxGeometry(0.4, 0.5, 0.4), MeshBasicMaterial; capacity instances. */
export function createUnitsRenderer(capacity: number): UnitsRenderer;
```

`client/src/camera.ts` gains
`export function setCameraTarget(camera: OrthographicCamera, x: number, z: number): void`
(keeps the isometric offset of `createIsometricCamera`, looks at `(x, 0, z)`).

### 5.8 Input

`client/src/input/selection.ts`:

```ts
export interface ScreenPoint { x: number; y: number }
export interface ScreenRect { minX: number; minY: number; maxX: number; maxY: number }
export const CLICK_PICK_RADIUS_TILES = 0.5;
export const DRAG_THRESHOLD_PX = 4;
/** Nearest unit whose distance to (groundX, groundY) is <= CLICK_PICK_RADIUS_TILES; ties -> lowest id; none -> null. */
export function pickUnit(units: readonly UnitState[], groundX: number, groundY: number): number | null;
export function rectFromDrag(a: ScreenPoint, b: ScreenPoint): ScreenRect;
/** Ids (ascending) whose projected point lies inside rect, edges inclusive. */
export function unitsInRect(units: readonly UnitState[], rect: ScreenRect, project: (x: number, y: number) => ScreenPoint): number[];
export function isDrag(a: ScreenPoint, b: ScreenPoint): boolean;  // max(|dx|, |dy|) > DRAG_THRESHOLD_PX
/** Every unit id, ascending (AC-02-45). */
export function selectAll(units: readonly UnitState[]): number[];
/** code === "KeyA" && (ctrlKey || metaKey); physical key, like PAN_KEYS. */
export function isSelectAllShortcut(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey">): boolean;
```

`client/src/input/cameraPan.ts`:

```ts
export const PAN_SPEED_TILES_PER_SECOND = 20;
/** Screen-relative directions mapped to world (x, z) for the fixed camera. */
export const PAN_KEYS = {
  ArrowUp: [-1, -1], KeyW: [-1, -1],
  ArrowDown: [1, 1], KeyS: [1, 1],
  ArrowLeft: [-1, 1], KeyA: [-1, 1],
  ArrowRight: [1, -1], KeyD: [1, -1],
} as const;
/** Sum of PAN_KEYS vectors of pressed codes; if non-zero, normalised and
 *  multiplied by PAN_SPEED_TILES_PER_SECOND * dtSeconds; else {x: 0, y: 0}. */
export function panDelta(pressed: ReadonlySet<string>, dtSeconds: number): { x: number; y: number };
```

`client/src/input/controller.ts` wires pointer events on the canvas and
keyboard events on `window` (covered by E2E): left press + release without
drag → `pickUnit` on the ground point under the cursor (raycast to plane
y = 0), selection = `{id}` or empty; left drag → selection = `unitsInRect`;
`pointermove` and `pointerdown` record the last pointer position (sub-pixel
`clientX`/`clientY`); right click (`contextmenu`, default prevented) with a
non-empty selection raycasts that last pointer position (the `contextmenu`
event's own coordinates only if no pointer event has been seen yet, because
browsers round them to whole pixels, which exceeds AC-02-41's 0.01-tile
tolerance) and, on a ground hit, calls `simClient.move([...selected].sort((a,
b) => a - b), toRaw(groundX), toRaw(groundZ))` (numeric ascending order, not
the default lexicographic `.sort()`); `keydown`/`keyup` on `window` maintain
the pressed set used by `panDelta` each frame, so panning works without
focusing the canvas, and a `window` `blur` clears it; the camera target is
clamped to `[0, mapWidth] x [0, mapHeight]`. The `keydown` handler first
checks `isSelectAllShortcut(event)`: if true it calls `event.preventDefault()`
(no page text selection), sets selection = `selectAll(options.units())`
through the same path as box selection (so `onSelectionChange` updates the
HUD), and returns without adding `event.code` to the pressed set (so the chord
never pans with `KeyA`).

### 5.9 i18n and HUD

* `client/src/i18n/en.json`:
  `{ "hud.selectedCount": "Selected: {count}", "hud.tick": "Tick {tick}", "error.simInit": "The simulation failed to start: {detail}", "perf.fps": "FPS {fps}", "perf.p95": "p95 {ms} ms" }`
* `client/src/i18n/index.ts`:

```ts
import en from "./en.json";
export type MessageKey = keyof typeof en;
/** Replaces each {name} with String(params[name]); unknown placeholders stay verbatim. */
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string;
```

* `client/src/hud.ts`:
  `export function createHud(root: HTMLElement): { setSelectedCount(n: number): void; setTick(n: number): void; showError(detail: string): void }`
  — appends `<div id="hud-selected">`, `<div id="hud-tick">` and, on error,
  `<div id="hud-error" role="alert">`, all texts through `t()`.

### 5.10 App and debug API

* `client/src/main.ts` reads `seed` and `units` from `location.search`
  (defaults `DEFAULT_SEED`, `DEFAULT_UNIT_COUNT`; `units` clamped to
  `0..2000`), creates the worker and `SimClient`, builds terrain and units
  renderers on `ready`, centres the camera on the mean position of the units
  in the first snapshot (map centre if there are none), renders each
  `requestAnimationFrame` with `interpolateUnits(prev, next, (now -
  receivedAt) / TICK_MS)`, and updates the HUD.
* `client/src/debug.ts`, installed on `window.__redline` only when
  `location.search` contains `debug=1`:

```ts
export interface RedlineDebug {
  isReady(): boolean;
  tick(): number;                              // tick of the latest snapshot
  unitCount(): number;
  unitPosition(id: number): { x: number; y: number } | null;   // latest snapshot, tiles
  isMoving(id: number): boolean;
  selectedIds(): number[];                     // ascending
  worldToScreen(x: number, y: number): { x: number; y: number };  // sim tiles -> page CSS px
  cameraTarget(): { x: number; y: number };
  commandMove(ids: number[], x: number, y: number): void;        // tiles; via SimClient.move
  stateHash(): Promise<string>;
  drawCalls(): number;                         // renderer.info.render.calls of the last frame
  resetFrameStats(): void;
  frameStats(): { frames: number; p95FrameMs: number };  // rAF deltas since reset
  /** AC-02-46: replaces the perf panel window with frameTimesMs (last
   *  PERF_WINDOW_FRAMES entries), ignores real rAF deltas until
   *  resumeFrameTimes(), and re-renders the panel immediately. Does not touch
   *  frameStats(). */
  injectFrameTimes(frameTimesMs: number[]): void;
  /** AC-02-46: clears the perf panel window and resumes recording real rAF deltas. */
  resumeFrameTimes(): void;
}
export function installDebugApi(target: { __redline?: RedlineDebug }, api: RedlineDebug): void;
```

### 5.11 Test projects

* `client/playwright.config.ts`: `grepInvert: /@perf/` for the default run;
  a project `perf` (`grep: /@perf/`, Chromium launch args
  `["--ignore-gpu-blocklist", "--use-angle=metal"]`) used only by the new
  client script `"test:perf": "playwright test --project=perf"` and root
  script `"test:perf": "cd client && node --run test:perf"`. `test:perf` is
  not part of `verify`.
* Parity test `client/src/sim/parity.test.ts` runs in Vitest's Node
  environment: reads the fixture, loads `@sim/sim_bg.wasm` bytes with
  `node:fs` and `initSync({ module })`, executes the script through
  `runScript` and compares with the stdout of
  `cargo run --quiet -p headless -- hash <fixture>` (via
  `node:child_process.execFileSync`, cwd = repository root), timeout 300 s.
* `client/src/sim/script.ts`:

```ts
export interface ScriptCommand { tick: number; unitRange: [number, number]; target: [number, number] }
export interface Script { seed: number; units: number; ticks: number; commands: ScriptCommand[] }
export interface ScriptSim { command_move(ids: Uint32Array, x: number, y: number): void; step(): void; state_hash_hex(): string }
/** Same semantics as headless run_script; returns state_hash_hex(). */
export function runScript(sim: ScriptSim, script: Script): string;
```

### 5.12 Performance panel (`client/src/perfPanel.ts`)

Debug-only overlay the owner watches while testing manually (owner request,
2026-10-09). It consumes the same rAF delta that `main.ts` already records into
`frameStats` (no second timing loop or `requestAnimationFrame`).

```ts
export const PERF_WINDOW_FRAMES = 120;
export const PERF_BAD_P95_MS = 19;
export const PERF_PANEL_UPDATE_MS = 250;
export interface PerfSummary { fps: number; p95FrameMs: number; bad: boolean }
/** Pure. Uses only the last PERF_WINDOW_FRAMES entries of frameTimesMs (all
 *  of them if fewer). Empty window -> { fps: 0, p95FrameMs: 0, bad: false }.
 *  fps = Math.round(1000 / mean) (0 if mean is 0); p95FrameMs uses the same
 *  nearest-rank rule as createFrameStats: ascending sorted[max(0,
 *  ceil(n * 0.95) - 1)]; bad = p95FrameMs > PERF_BAD_P95_MS (strict). */
export function summarizeFrames(frameTimesMs: readonly number[]): PerfSummary;
export interface PerfPanel {
  /** Appends frameMs to the rolling window (dropping entries older than the
   *  last PERF_WINDOW_FRAMES) unless injected mode is on, then renders if
   *  nowMs - lastRenderMs >= PERF_PANEL_UPDATE_MS, then sets lastRenderMs =
   *  nowMs. lastRenderMs starts at -Infinity (first record renders) and is
   *  only changed here. */
  record(frameMs: number, nowMs: number): void;
  /** Injected mode on: window = last PERF_WINDOW_FRAMES of frameTimesMs; renders now. */
  inject(frameTimesMs: readonly number[]): void;
  /** Injected mode off: window = []; renders now. */
  resume(): void;
}
/** Appends <div id="perf-panel"> containing <div id="perf-fps"> and
 *  <div id="perf-p95"> to parent and renders once immediately. Rendering sets
 *  #perf-fps to t("perf.fps", { fps }), #perf-p95 to
 *  t("perf.p95", { ms: p95FrameMs.toFixed(1) }) and
 *  classList.toggle("perf-bad", bad) on #perf-panel. */
export function createPerfPanel(parent: HTMLElement): PerfPanel;
```

* `client/src/main.ts`, only when `params.get("debug") === "1"`, calls
  `createPerfPanel(document.body)` before the first frame; in `frame(now)` it
  calls `perfPanel.record(dtMs, now)` right where it calls
  `frameStats.record(dtMs)` (same guard, same value). The debug API's
  `injectFrameTimes` / `resumeFrameTimes` delegate to `inject` / `resume`.
  Without `debug=1` no panel element exists.
* `client/index.html` styles: `#perf-panel { position: fixed; top: 8px;
  right: 8px; pointer-events: none; color: #fff; font: 14px/1.4 system-ui,
  sans-serif; text-shadow: 0 1px 2px #000; }` and
  `#perf-panel.perf-bad { color: #ff4d4d; }`. The HUD stays top-left, so the
  two never overlap.

## 6. Acceptance criteria

Raw values are Q16.16 (`65536` = 1 tile). "Tech-slice world" means
`World::tech_slice(seed, n)`.

### Simulation core

**AC-02-01 Fixed-point arithmetic.** Given `Fx` values, when operated, then
`from_int(3).mul(HALF).raw() == 98304`; `from_raw(-1).mul(HALF).raw() == -1`;
`from_int(1).div(from_int(3)).raw() == 21845`;
`from_int(-1).div(from_int(3)).raw() == -21845`;
`from_raw(-98304).floor_to_int() == -2`; `(from_int(2) + HALF).raw() == 163840`.

**AC-02-02 Square root.** Given `Fx`, when `sqrt` is called, then
`from_int(4).sqrt() == from_int(2)`, `from_int(2).sqrt().raw() == 92681`,
`from_int(-1).sqrt() == ZERO`; and `isqrt_u64(u64::MAX) == 4294967295`,
`isqrt_u64(15) == 3`, `isqrt_u64(16) == 4`.

**AC-02-03 Vector length and normalise.** Given `v = FxVec2(3, 4)` (ints), when
measured, then `v.length() == from_int(5)`, `v.normalize()` has raws
`(39321, 52428)`, `FxVec2::ZERO.normalize() == ZERO`, and
`FxVec2(from_int(100), from_int(100)).length().raw() == 9268190`.

**AC-02-04 SplitMix64.** Given `SplitMix64::new(0)`, when drawing, then the
first three `next_u64` are `0xE220A8397B1DCDAF`, `0x6E789E6AA1B965F4`,
`0x06C45D188009454F`; and `SplitMix64::new(0).next_u32() == 0xE220A839`.

**AC-02-05 Tech-slice layout.** Given `MapGrid::tech_slice()`, when queried,
then width and height are 128; `(0,0)`, `(127,5)`, `(61,30)`, `(33,33)`,
`(95,90)` are blocked; `(61,63)`, `(20,20)`, `(100,20)`, `(64,64)` are
passable; `tiles().len() == 16384` with `tiles()[0] == 1` and
`tiles()[20 * 128 + 20] == 0`; out-of-bounds `(-1,0)` and `(128,0)` are not
passable.

**AC-02-06 Spawn.** Given `World::tech_slice(7, 500)`, when created, then it
has 500 units with ids `0..500` at tick 0, all `Idle { last_order_id: 0 }`;
unit 0 is in cell `(4,4)`, unit 52 in `(56,4)`, unit 53 in `(4,5)`; every unit
is within raw `16384` of its cell centre on both axes; and
`World::tech_slice(7, 500)` built twice yields identical unit vectors.

**AC-02-07 Unit cap.** Given `unit_count = 2001`, when
`World::tech_slice(1, 2001)` is called, then it returns
`Err(SimError::TooManyUnits { requested: 2001, max: 2000 })`; `2000` succeeds.

**AC-02-08 Integration field.** Given `MapGrid::open(8, 8)` and goal `(0,0)`,
when the flow field is computed, then integration at `(0,0)` is 0, `(3,0)` is
30, `(3,1)` is 34, `(3,3)` is 42, `(7,7)` is 98.

**AC-02-09 Direction field.** Given the same field, then direction at `(3,3)`
is `NW`, at `(3,0)` is `W`, at `(0,3)` is `N`, at `(0,0)` is `None`; and
`Dir8::NE.unit_vector()` has raws `(46341, -46341)`.

**AC-02-10 No corner cutting.** Given `MapGrid::open(3, 3)` with `(1,0)`
blocked and goal `(2,0)`, when computed, then `integration((0,0)) == 40`,
`direction((0,0)) == Some(S)`, `direction((1,1)) == Some(E)`, and
`can_step(map, (1,1), NE)` is false.

**AC-02-11 Unreachable cells.** Given `MapGrid::open(5, 5)` with every cell of
column `x = 2` blocked and goal `(4,2)`, when computed, then
`integration((0,0)) == UNREACHABLE` and `direction((0,0)) == None`; and in a
`World::new` on that map, a unit at `(0.5, 0.5)` ordered to `(4.5, 2.5)` is
`Idle { last_order_id: 1 }` after one step with its position unchanged.

**AC-02-12 Blocked target remap.** Given `MapGrid::tech_slice()`,
`nearest_passable((61,30)) == Some((59,28))` and
`nearest_passable((20,20)) == Some((20,20))`; and given a tech-slice world
with 1 unit, when a move to raw `(61.5, 30.5)` = `(4030464, 1998848)` is
applied by one step, then the unit's order target is `(59.5, 28.5)` =
`(3899392, 1867776)`.

**AC-02-13 Speed.** Given `World::new(MapGrid::open(32, 32))` with one unit
spawned at `(2.5, 2.5)` and a move to `(12.5, 2.5)`, when one step runs, then
the unit's raw position is `(176947, 163840)` and the tick is 1.

**AC-02-14 Exact arrival.** Given the same setup, when 60 steps run, then the
unit's position equals `(12.5, 2.5)` exactly (raw `(819200, 163840)`), its
order is `Idle { last_order_id: 1 }`, and `flow_field_count() == 0`.

**AC-02-15 Routing through the gap.** Given `World::new(MapGrid::tech_slice())`
with one unit at `(20.5, 20.5)` and a move to `(100.5, 20.5)`, when stepping up
to 1500 ticks, then the unit is `Idle` at exactly `(100.5, 20.5)` before tick
1500; at every tick its cell is passable; and at least one tick has its cell
with `60 <= x <= 63` and `60 <= y <= 67`.

**AC-02-16 Group arrival and separation.** Given `World::new(MapGrid::open(64,
64))` with 100 units at the centres of cells `x 5..=14, y 5..=14` (spawned
row-major) and one move of all of them to `(40.5, 40.5)`, when 600 steps run,
then all units are `Idle { last_order_id: 1 }`, every unit is within 12 tiles
(`length <= from_int(12)`) of the target, and every pair of units is at least
raw `16384` (0.25 tile) apart.

**AC-02-17 Never inside walls.** Given the fixture script
(`crates/sim/tests/fixtures/tech-slice-script.json`), when executed through the
public `World` API, then after every step every unit's cell is passable.

**AC-02-18 Flow field cache.** Given a tech-slice world with 10 units, when a move of
units `0..5` to `(100.25, 20.25)` and a move of units `5..10` to
`(100.75, 20.75)` (same cell) are enqueued before one step, then `flow_field_count() == 1` and
`next_order_id() == 3`; and after all units are `Idle` (at most 1500 steps),
`flow_field_count() == 0`.

**AC-02-19 Determinism.** Given two `World::tech_slice(42, 500)` worlds fed the
fixture commands, when stepped 600 ticks, then their `state_hash` values are
equal; and `World::tech_slice(43, 500)` stepped the same way gives a
different hash.

**AC-02-20 Hash definition.** Given byte strings, `fnv1a64(b"") ==
0xcbf29ce484222325` and `fnv1a64(b"a") == 0xaf63dc4c8601ec8c`; and given
`World::new(MapGrid::open(4, 4))` with no units, `state_hash` equals
`fnv1a64` of 12 zero bytes except bytes 4..8 = `1u32` LE (tick 0,
next_order_id 1, unit_count 0); and the hash of a tech-slice world changes
after one step with a pending move.

**AC-02-21 Snapshot layout.** Given `World::new(MapGrid::open(8, 8))` with
units at `(1.5, 1.5)` and `(2.5, 2.5)` and a move of unit 1 to `(6.5, 2.5)`,
when one step runs and `encode_snapshot` is called, then the vector is
`[1, 2, 0, 98304, 98304, 0, 1, 176947, 163840, 1]`.

**AC-02-22 WASM API natively.** Given `Sim::new(42, 500)`, then
`map_width() == 128`, `map_height() == 128`, `map_tiles().len() == 16384`,
`unit_count() == 500`, `snapshot().len() == 2 + 500 * 4`, `tick() == 0`,
`state_hash_hex()` is 16 lowercase hex chars; after `command_move(&[0], 4030464,
1998848)` and `step_n(3)`, `tick() == 3`; and `Sim::new(1, 2001)` is `Err`
containing `"too many units"`.

**AC-02-23 Headless hash CLI.** Given the built `headless` binary, when run as
`headless hash crates/sim/tests/fixtures/tech-slice-script.json` twice, then
both runs exit 0 and print the same line matching `^[0-9a-f]{16}\n$`; and
`headless hash does-not-exist.json` exits with code 2.

**AC-02-24 Native vs WASM parity.** Given the fixture script, when run through
the WASM build (`runScript` in Node) and through `headless hash`, then both
hashes are identical.

### Client units

**AC-02-25 Fixed conversion.** `toRaw(1) === 65536`, `toRaw(100.5) ===
6586368`, `toRaw(-0.5) === -32768`, `fromRaw(98304) === 1.5`.

**AC-02-26 Snapshot decoding.** Given `Int32Array [7, 2, 0, 98304, 65536, 1,
5, 0, 32768, 0]`, `decodeSnapshot` returns `{ tick: 7, units: [{ id: 0, x: 1.5,
y: 1, moving: true }, { id: 5, x: 0, y: 0.5, moving: false }] }`.

**AC-02-27 Interpolation.** Given prev unit 0 at `(0, 0)` and next at `(2, 4)`,
`interpolateUnits` with alpha `0.5` yields `(1, 2)`, alpha `-1` yields `(0, 0)`,
alpha `3` yields `(2, 4)`; a unit absent from prev takes next's position.

**AC-02-28 Worker init.** Given a fake `SimLike` (map 2x2, tiles `[0,1,0,0]`),
when `handle({ type: "init", seed: 1, unitCount: 3 })`, then the factory got
`(1, 3)` and `post` received `ready` (`apiVersion` 1, 2, 2, those tiles) then
one `snapshot`; and when the factory throws `new Error("boom")`, `post` receives
`{ type: "error", detail: "Error: boom" }` only.

**AC-02-29 Worker pacing.** Given an initialised handler, `advance(0)` steps 0
times; `advance(100)` steps 1 time (100 / 66.67) and posts one snapshot;
`advance(150)` steps 1 more (accumulated 83.3 ms → 1, remainder 16.7);
`advance(149)` (time not increasing) and any call before `init` post nothing;
`advance(10_000)` steps exactly 4 times and the next `advance(10_050)` steps 0
times (accumulator reset); and the snapshot buffer is passed in the transfer
list.

**AC-02-30 Worker commands.** Given an initialised handler, `move` with
`unitIds [3, 1]`, `targetXRaw 65536`, `targetYRaw 131072` calls
`command_move(Uint32Array [3, 1], 65536, 131072)`; `hashRequest` with
`requestId 9` posts `{ type: "hash", requestId: 9, hash: <fake hash> }`; `move`
before `init` does nothing.

**AC-02-31 Sim client.** Given a fake `WorkerLike`, `createSimClient` posts
`init` with the options; a `ready` message resolves `ready`; an `error`
message rejects it with the detail; `move([2, 1], 5, 6)` posts
`{ type: "move", unitIds: [2, 1], targetXRaw: 5, targetYRaw: 6 }`;
`requestHash()` posts `hashRequest` with `requestId` 1 and resolves with the
`hash` of the matching reply; `onSnapshot` listeners receive the decoded
snapshot and `now()`, and stop after unsubscribe.

**AC-02-32 Click picking.** Given units `0 (1, 1)`, `1 (1.3, 1)`, `2 (5, 5)`,
`pickUnit(units, 1.2, 1)` is `1`, `pickUnit(units, 1.15, 1)` is `0` (tie →
lowest id), `pickUnit(units, 3, 3)` is `null`.

**AC-02-33 Box selection.** `rectFromDrag({x: 10, y: 50}, {x: 2, y: 5})` is
`{minX: 2, minY: 5, maxX: 10, maxY: 50}`; with identity projection, units at
`(2, 5)`, `(10, 50)`, `(11, 20)` and rect above select ids of the first two
only; `isDrag({0,0},{4,4})` is false and `isDrag({0,0},{5,0})` is true.

**AC-02-34 Camera pan.** `panDelta(new Set(["ArrowRight"]), 0.5)` is
`{x: 10/√2, y: -10/√2}` (±1e-9); `panDelta(new Set(["ArrowUp", "ArrowDown"]),
1)` is `{x: 0, y: 0}`; `panDelta(new Set(["KeyQ"]), 1)` is `{x: 0, y: 0}`.

**AC-02-35 i18n.** `t("hud.selectedCount", { count: 3 })` is `"Selected: 3"`;
`t("hud.tick", {})` is `"Tick {tick}"`; every value in `en.json` is a
non-empty string.

**AC-02-36 Terrain mesh.** `createTerrain(3, 2, [0,1,0,0,0,0])` returns a
`Mesh` whose geometry has 24 positions, an index of 36 entries, and the 4
vertices of tile `(1,0)` coloured `BLOCKED_COLOR` while those of tile `(0,0)`
are `PASSABLE_COLOR`.

**AC-02-37 Instanced units.** `createUnitsRenderer(500)` returns an
`InstancedMesh` with capacity 500; after `update` with 3 units and selection
`{1}`, `mesh.count === 3`, instance 1 has colour `SELECTED_COLOR`, instance 0
`UNIT_COLOR`, and instance 2's matrix translation is `(x, 0.25, y)` of unit 2.

### End to end (Playwright, `?debug=1`)

**AC-02-38 Boot.** Given `/?debug=1`, when the page loads, then within 10 s
`isReady()` is true, `unitCount()` is 500, the page has a Web Worker whose URL
contains `sim.worker`, and `tick()` increases by at least 10 over 2 s.

**AC-02-39 Click selection.** Given `/?debug=1&units=1`, when the user
left-clicks at `worldToScreen` of unit 0, then `selectedIds()` is `[0]` and
`#hud-selected` reads `Selected: 1`; clicking an empty passable ground point
clears it to `Selected: 0`.

**AC-02-40 Box selection.** Given `/?debug=1&units=20`, when the user drags
from 20 px above-left of the screen point of `(4, 4)` to 20 px below-right of
the screen point of `(24, 5)`, then `selectedIds()` contains every unit whose
screen point falls inside the dragged rectangle and at least 2 units.

**AC-02-41 Right-click move.** Given `/?debug=1&units=1` with unit 0 selected,
when the user right-clicks at `worldToScreen(10.5, 10.5)`, then within 10 s
`isMoving(0)` becomes true and later false with `unitPosition(0)` within 0.01
tile of `(10.5, 10.5)`.

**AC-02-42 Draw calls.** Given `/?debug=1` (500 units) after ready, then
`drawCalls()` is between 1 and 4 inclusive.

**AC-02-43 Camera pan.** Given `/?debug=1`, when `ArrowRight` is held for
500 ms, then `cameraTarget().x` increased and `cameraTarget().y` decreased.

**AC-02-44 60 fps with 500 units (`@perf`, reference machine only).** Given
`/?debug=1` (500 units) in the `perf` project, when all units are ordered to
`(100.5, 100.5)` via `commandMove` and `resetFrameStats()` is called, then
after 300 frames `frameStats().p95FrameMs <= 19`. (A clean run on a 60 Hz
display measures 16.7–16.8 ms at 0.1 ms timer resolution; 19 ms still fails on
any dropped frame, which costs about 33 ms.)

**AC-02-45 Select all shortcut.** Given `/?debug=1&units=20` after ready and
an empty selection, when the user presses `Control+A` (`Meta+A` on macOS, via
Playwright `ControlOrMeta+A`) while the page has focus, then `selectedIds()`
is `[0, 1, ..., 19]`, `#hud-selected` reads `Selected: 20`, the browser
default is prevented (`window.getSelection()?.toString()` is `""`), and
`cameraTarget()` is unchanged (the chord does not pan with `KeyA`). Unit part:
`selectAll` of units `5 (0, 0)`, `2 (1, 1)`, `9 (2, 2)` is `[2, 5, 9]` and of
`[]` is `[]`; `isSelectAllShortcut` is true for `{code: "KeyA", ctrlKey: true,
metaKey: false}` and `{code: "KeyA", ctrlKey: false, metaKey: true}`, false for
`{code: "KeyA", ctrlKey: false, metaKey: false}` and `{code: "KeyB", ctrlKey:
true, metaKey: false}`.

**AC-02-46 Performance panel.** Given `/?debug=1` after ready, then
`#perf-panel` is visible, its bounding box lies within 16 px of the viewport's
top-right corner and does not intersect `#hud-selected` or `#hud-tick`, and
within 2 s `#perf-fps` no longer reads `FPS 0` (real frames are recorded and the
panel re-renders at least every `PERF_PANEL_UPDATE_MS` = 250 ms, well under
500 ms). When `injectFrameTimes` is called with 120 × `40`, then `#perf-panel`
has class `perf-bad`, `#perf-fps` reads `FPS 25` and `#perf-p95` reads
`p95 40.0 ms`; when it is then called with 120 × `10`, `#perf-panel` no longer
has `perf-bad`, `#perf-fps` reads `FPS 100` and `#perf-p95` reads `p95 10.0 ms`.
Given `/` (no `debug=1`) once `#hud-tick` has text, then no `#perf-panel`
element exists. Unit part (`summarizeFrames`): `[]` → `{ fps: 0, p95FrameMs: 0,
bad: false }`; 120 × `16` → `{ fps: 63, p95FrameMs: 16, bad: false }`; 113 ×
`16` followed by 7 × `40` → `{ fps: 57, p95FrameMs: 40, bad: true }`; 114 ×
`16` followed by 6 × `40` → `p95FrameMs: 16, bad: false`; 120 × `19` →
`bad: false`; 120 × `19.5` → `bad: true`; 80 × `100` followed by 120 × `10` →
`{ fps: 100, p95FrameMs: 10, bad: false }` (only the last 120 frames count).

## 7. Traceability

| Criterion | Test file | Test name |
|---|---|---|
| AC-02-01 | `crates/sim/tests/fixed_point.rs` | `ac_02_01_fixed_arithmetic_rounding` |
| AC-02-02 | `crates/sim/tests/fixed_point.rs` | `ac_02_02_square_root` |
| AC-02-03 | `crates/sim/tests/fixed_point.rs` | `ac_02_03_vector_length_and_normalize` |
| AC-02-04 | `crates/sim/tests/rng.rs` | `ac_02_04_splitmix64_reference_values` |
| AC-02-05 | `crates/sim/tests/map.rs` | `ac_02_05_tech_slice_layout` |
| AC-02-06 | `crates/sim/tests/map.rs` | `ac_02_06_tech_slice_spawn` |
| AC-02-07 | `crates/sim/tests/map.rs` | `ac_02_07_unit_cap` |
| AC-02-08 | `crates/sim/tests/flow_field.rs` | `ac_02_08_integration_field_open_map` |
| AC-02-09 | `crates/sim/tests/flow_field.rs` | `ac_02_09_direction_field_open_map` |
| AC-02-10 | `crates/sim/tests/flow_field.rs` | `ac_02_10_no_corner_cutting` |
| AC-02-11 | `crates/sim/tests/flow_field.rs` | `ac_02_11_unreachable_cells` |
| AC-02-12 | `crates/sim/tests/movement.rs` | `ac_02_12_blocked_target_remap` |
| AC-02-13 | `crates/sim/tests/movement.rs` | `ac_02_13_unit_moves_at_unit_speed` |
| AC-02-14 | `crates/sim/tests/movement.rs` | `ac_02_14_unit_arrives_exactly` |
| AC-02-15 | `crates/sim/tests/movement.rs` | `ac_02_15_units_route_through_the_gap` |
| AC-02-16 | `crates/sim/tests/movement.rs` | `ac_02_16_group_arrives_separated` |
| AC-02-17 | `crates/sim/tests/movement.rs` | `ac_02_17_units_never_enter_blocked_cells` |
| AC-02-18 | `crates/sim/tests/movement.rs` | `ac_02_18_flow_field_cache` |
| AC-02-19 | `crates/sim/tests/determinism.rs` | `ac_02_19_same_seed_same_hash` |
| AC-02-20 | `crates/sim/tests/determinism.rs` | `ac_02_20_hash_definition` |
| AC-02-21 | `crates/sim/tests/determinism.rs` | `ac_02_21_snapshot_layout` |
| AC-02-22 | `crates/sim/tests/wasm_api.rs` | `ac_02_22_wasm_api_natively` |
| AC-02-23 | `crates/headless/tests/cli.rs` | `ac_02_23_hash_cli` |
| AC-02-24 | `client/src/sim/parity.test.ts` | `AC-02-24: native and WASM hashes are identical` |
| AC-02-25 | `client/src/sim/fixed.test.ts` | `AC-02-25: converts tiles to raw fixed point and back` |
| AC-02-26 | `client/src/sim/snapshot.test.ts` | `AC-02-26: decodes a snapshot buffer` |
| AC-02-27 | `client/src/sim/snapshot.test.ts` | `AC-02-27: interpolates unit positions` |
| AC-02-28 | `client/src/sim/workerHandler.test.ts` | `AC-02-28: init posts ready and a snapshot, or an error` |
| AC-02-29 | `client/src/sim/workerHandler.test.ts` | `AC-02-29: advance paces ticks at 15 Hz` |
| AC-02-30 | `client/src/sim/workerHandler.test.ts` | `AC-02-30: forwards move and answers hash requests` |
| AC-02-31 | `client/src/sim/simClient.test.ts` | `AC-02-31: wraps the worker protocol` |
| AC-02-32 | `client/src/input/selection.test.ts` | `AC-02-32: picks the nearest unit under the cursor` |
| AC-02-33 | `client/src/input/selection.test.ts` | `AC-02-33: selects units inside a dragged rectangle` |
| AC-02-34 | `client/src/input/cameraPan.test.ts` | `AC-02-34: pans the camera with keys` |
| AC-02-35 | `client/src/i18n/index.test.ts` | `AC-02-35: translates keys with parameters` |
| AC-02-36 | `client/src/render/terrain.test.ts` | `AC-02-36: builds one terrain mesh with tile colours` |
| AC-02-37 | `client/src/render/units.test.ts` | `AC-02-37: renders units as instances` |
| AC-02-38 | `client/tests/e2e/tech-slice.spec.ts` | `AC-02-38: boots the simulation in a worker` |
| AC-02-39 | `client/tests/e2e/tech-slice.spec.ts` | `AC-02-39: selects a unit by clicking` |
| AC-02-40 | `client/tests/e2e/tech-slice.spec.ts` | `AC-02-40: selects units with a box` |
| AC-02-41 | `client/tests/e2e/tech-slice.spec.ts` | `AC-02-41: moves selected units with right click` |
| AC-02-42 | `client/tests/e2e/tech-slice.spec.ts` | `AC-02-42: renders 500 units in at most 4 draw calls` |
| AC-02-43 | `client/tests/e2e/tech-slice.spec.ts` | `AC-02-43: pans the camera with arrow keys` |
| AC-02-44 | `client/tests/e2e/perf.spec.ts` | `AC-02-44: keeps 60 fps with 500 moving units @perf` |
| AC-02-45 | `client/src/input/selection.test.ts` | `AC-02-45: selects every unit and recognises the shortcut` |
| AC-02-45 | `client/tests/e2e/tech-slice.spec.ts` | `AC-02-45: selects all units with Ctrl+A` |
| AC-02-46 | `client/src/perfPanel.test.ts` | `AC-02-46: summarizes a rolling window of frame times` |
| AC-02-46 | `client/tests/e2e/tech-slice.spec.ts` | `AC-02-46: shows a performance panel only in debug mode` |

## 8. Issue breakdown (Phase 1 queue)

Opened by roadmap task 0.11 as issues #10..#26 (label `phase:1`, blocked-by
relationships set in GitHub). For each issue, the tier S author first commits
the failing tests listed in §7 for its criteria (RED, D-08); the implementer
then makes them pass without touching them. Estimated sizes exclude those
tests. Labels: tier + area.

| ID | Issue | Title | Criteria | Files allowed (production) | Est. lines | Tier | Area | Depends on |
|---|---|---|---|---|---|---|---|---|
| P1-01 | #10 | Rules checker and determinism clippy config | AC-01-01..04 | `scripts/check-rules.mjs`, `clippy.toml`, `package.json` | 120 | ready-local | area:infra | — |
| P1-02 | #11 | Fixed-point math and SplitMix64 | AC-02-01..04 | `crates/sim/src/{fixed,rng,lib}.rs` | 180 | ready-local | area:sim | — |
| P1-03 | #12 | Map grid and tech-slice layout | AC-02-05, AC-02-12 (`nearest_passable` part) | `crates/sim/src/{map,lib}.rs` | 150 | ready-local | area:sim | P1-02 |
| P1-04 | #13 | Flow field computation | AC-02-08..10, AC-02-11 (field part) | `crates/sim/src/{flow,lib}.rs` | 200 | ready-pro | area:sim | P1-03 |
| P1-05 | #14 | World, move orders and movement | AC-02-06, 07, 11 (world part), 12, 13, 14, 15, 18 | `crates/sim/src/{world,lib}.rs` | 280 | ready-pro | area:sim | P1-04 |
| P1-06 | #15 | Separation and contact arrival | AC-02-16, AC-02-17 | `crates/sim/src/world.rs` | 150 | ready-pro | area:sim | P1-05 |
| P1-07 | #16 | State hash and snapshot encoding | AC-02-19..21 | `crates/sim/src/{hash,snapshot,lib}.rs` | 120 | ready-local | area:sim | P1-05 |
| P1-08 | #17 | WASM `Sim` API, API version 1 | AC-02-22, AC-01-05 (Rust) | `crates/sim/src/{wasm_api,lib}.rs`, skeleton tests in `crates/sim/src/lib.rs` and `crates/headless/src/main.rs` (version 0 → 1) | 120 | ready-local | area:sim | P1-07 |
| P1-09 | #18 | Headless `hash` subcommand and fixture script | AC-02-23 | `crates/headless/src/{main,script}.rs`, `crates/headless/Cargo.toml`, root `Cargo.toml`, `crates/sim/tests/fixtures/tech-slice-script.json` | 150 | ready-local | area:sim | P1-08 |
| P1-10 | #19 | Client protocol, fixed conversion and snapshots | AC-02-25..27 | `client/src/sim/{protocol,fixed,snapshot}.ts` | 130 | ready-local | area:client | — |
| P1-11 | #20 | WASM wiring and native/WASM parity | AC-02-24 | `client/src/sim/script.ts`, `client/{vite,vitest}.config.ts`, `client/tsconfig.json` | 100 | ready-pro | area:client | P1-09, P1-10 |
| P1-12 | #21 | Worker handler, worker entry and sim client | AC-02-28..31, AC-01-05 (client) | `client/src/sim/{workerHandler,sim.worker,simClient}.ts` | 240 | ready-pro | area:client | P1-10, P1-11 |
| P1-13 | #22 | i18n module and HUD | AC-02-35 | `client/src/i18n/{index.ts,en.json}`, `client/src/hud.ts` | 90 | ready-local | area:client | — |
| P1-14 | #23 | Terrain and instanced unit renderers | AC-02-36, AC-02-37 | `client/src/render/{terrain,units}.ts`, `client/src/camera.ts` | 170 | ready-pro | area:client | P1-10 |
| P1-15 | #24 | Selection and camera pan logic | AC-02-32..34 | `client/src/input/{selection,cameraPan}.ts` | 110 | ready-local | area:client | P1-10 |
| P1-16 | #25 | App wiring, input controller, debug API and E2E | AC-02-38..43 | `client/src/{main,debug}.ts`, `client/src/input/controller.ts`, `client/index.html` | 280 | ready-pro | area:client | P1-12, P1-13, P1-14, P1-15 |
| P1-17 | #26 | Performance project and `test:perf` | AC-02-44 | `client/playwright.config.ts`, `client/package.json`, `package.json` | 60 | ready-pro | area:client | P1-16 |
| P1-18 | #46 | Select all units shortcut | AC-02-45 | `client/src/input/{selection,controller}.ts` | 40 | ready-local | area:client | P1-16 |
| P1-19 | #50 | Performance panel | AC-02-46 | `client/src/{perfPanel,main,debug}.ts`, `client/src/i18n/en.json`, `client/index.html` | 100 | ready-local | area:client | P1-18 |

Every issue's "Done when" is `node --run verify` green (P1-17 additionally
`node --run test:perf` green on the reference machine, reported in the PR).
Files forbidden in every issue: tests written in the spec phase, `AGENTS.md`,
`.agents/skills/`, `specs/`.
