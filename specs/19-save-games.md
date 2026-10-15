# 19 — Save games and example saves

Status: accepted (owner request 2026-10-15, issue #279).
Depends on `03-phase2-core-loop.md` (§5.4 world, §5.6 skirmish setup, §5.8
commands, §5.14 hash, §5.15 snapshot, §5.16 WASM API, §5.17 headless, §6.3
protocol, §6.7 app), `08-player-controls.md` (§3 game menu, camera, switch
side, reveal), `17-projectiles-and-combat-readability.md` (projectiles,
events). Supersedes `14-showcase.md` except its §2 (`DebugSpawn` of buildings)
and the `#hud-selected-type` label (see §5.7). Roadmap: Phase 5.
Decisions: D-02 (deterministic fixed-point simulation), D-05 (architecture).

## 1. Context

The owner wants to stop rebuilding bases and armies by hand to check a
feature. Today the only shortcut is the showcase (`?showcase=1`, spec 14), a
special mode hardcoded in the client. Instead:

* The player saves and loads matches from the game menu, in named slots.
* A save is a full snapshot: the simulation, the AIs, the menu options, the
  controlled side and the camera, zoom included.
* The repository ships **example saves**: the showcase and many test scenes
  (duels, artillery, economy, low power, pathfinding, AI attack...). Automated
  tests and the owner's manual tests start from them with `?load=<id>`.
* A save can be copied to the clipboard and pasted to an agent, which turns it
  into a new example save.
* Agents in any harness create, list and run example saves through a skill and
  a CLI that print short results, so they do not fill their context with game
  code.

### 1.1 Owner decisions (2026-10-15)

1. Full snapshot: everything possible, including options, controlled side and
   zoom. No replay of command logs.
2. Saves live in the browser. Example saves ship with the game, the showcase
   among them.
3. Saves become examples through a "Copy" button that puts the save on the
   clipboard; the agent imports it. No other import path.
4. Agent tooling must work in any harness. Chosen: a skill
   (`.agents/skills/test-saves/SKILL.md`) plus `node --run saves:*` scripts
   with one-line outputs. An MCP server is out of scope; it can wrap the same
   scripts later without changing this spec.

## 2. Scope

In:

* Sim: serializable world state (`crates/sim/src/save.rs`), setup-form worlds
  (`World::from_setup`), WASM API v4.
* Data: example saves in `data/saves/`, schema, build into
  `data/generated/saves/`.
* Client: `?load=<id>`, save manager in the game menu, IndexedDB slots,
  clipboard copy, removal of the showcase mode.
* Headless `save` commands, `saves:*` scripts, the `test-saves` skill.
* A catalogue of example saves (§7) with contract tests.

Out:

* Replays, autosave, quick-save keys, multiplayer saves.
* Importing a save in the browser (paste box, file upload).
* Migrating saves across `SAVE_FORMAT_VERSION` changes (§3.6).
* An MCP server.

## 3. Simulation (`crates/sim`)

### 3.1 Map id in the world

`World` gains `pub(crate) map_id: Option<String>`: `Some(id)` for
`World::skirmish` and `World::from_setup`, `None` for every other constructor
(tech slice, `new`, `sandbox`). It is not hashed.

### 3.2 State types (`crates/sim/src/save.rs`, new)

Every type derives `serde::Serialize`, `serde::Deserialize`, uses
`#[serde(rename_all = "camelCase", deny_unknown_fields)]` and keeps the field
order shown. Type, weapon, faction and AI personality references are written
as their ruleset **string ids**, so a save survives balance changes and type
reordering. `u64` values are written as decimal strings, because JavaScript
parses JSON numbers as doubles. Fixed-point values are raw `i32` (`Fx::raw`).

```rust
pub const SAVE_FORMAT_VERSION: u32 = 1;

pub struct SimState {
    pub format_version: u32,          // SAVE_FORMAT_VERSION
    pub map_id: String,
    pub seed: String,                 // u64, decimal
    pub tick: u32,
    pub next_entity_id: u32,
    pub next_order_id: u32,
    pub next_projectile_id: u32,
    pub victory_enabled: bool,
    pub debug_commands: bool,
    pub outcome: OutcomeState,
    pub players: Vec<PlayerState>,    // ascending id
    pub entities: Vec<EntityState>,   // ascending id
    pub projectiles: Vec<ProjectileState>, // creation order
    pub pending: Vec<PendingCommand>, // queue order
    /// Goal cells of the cached flow fields, ascending cell index. Saved
    /// because a `Move` order never rebuilds a missing field (the unit goes
    /// idle); the fields themselves are recomputed from `nav` on load.
    pub flow_goals: Vec<[i32; 2]>,
    pub ais: Vec<AiState>,            // ascending player
}

#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OutcomeState { Ongoing, Winner { player: u8 }, Draw }

pub struct PlayerState {
    pub id: u8,
    pub faction: String,
    pub credits: u32,
    pub defeated: bool,
    /// Run lengths of `explored`, row-major, alternating false/true and
    /// starting with false (the first run may be 0). Sum = map cells.
    pub explored: Vec<u32>,
    /// Same encoding for `visible`. Saved, not derived: the vision phase runs
    /// before the deaths phase, so recomputing it on load would differ.
    pub visible: Vec<u32>,
    /// `[power_produced, power_consumed]`. Saved, not derived: the economy
    /// phase computes it before construction completes in the same step.
    pub power: [u32; 2],
    pub ghosts: Vec<GhostState>,      // ascending entity
}

pub struct GhostState { pub entity: u32, pub kind: String, pub owner: u8, pub origin: [i32; 2] }

pub struct EntityState {
    pub id: u32,
    pub owner: u8,
    pub kind: String,
    pub pos: [i32; 2],
    pub hp: u32,
    pub order: OrderState,
    pub cooldown: u32,
    pub cargo: u32,
    pub last_target: Option<u32>,
    pub last_hit: Option<LastHitState>,
    pub site: Option<SiteState>,
}

pub struct LastHitState { pub shooter: u32, pub weapon: String }

#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OrderState {
    Idle { last_order_id: u32 },
    Move { order_id: u32, target: [i32; 2], goal: [i32; 2] },
    Attack { order_id: u32, target: u32 },
    Harvest { order_id: u32, depot: u32, center: Option<u32>,
              phase: HarvestPhaseState, timer: u32 },
    Build { order_id: u32, building: u32 },
}

#[serde(rename_all = "camelCase")]
pub enum HarvestPhaseState { ToDepot, Loading, ToCenter, Unloading }

pub struct SiteState {
    pub origin: [i32; 2],
    pub progress: u32,
    pub complete: bool,
    pub queue: Vec<QueueItemState>,
    pub rally: Option<[i32; 2]>,
}

pub struct QueueItemState { pub kind: String, pub progress: u32 }

pub struct ProjectileState {
    pub id: u32, pub owner: u8, pub shooter: u32, pub weapon: String,
    pub target: u32, pub origin: [i32; 2], pub impact: [i32; 2],
    pub launch_tick: u32, pub impact_tick: u32,
}

pub struct PendingCommand { pub player: u8, pub command: CommandState }

/// `Command` with string ids; one variant per `Command` variant, same fields,
/// `FxVec2` as `[i32; 2]`, `Cell` as `[i32; 2]`, `TypeId` as `String`. The tag
/// is `type` because `Construct`, `Produce` and `DebugSpawn` have a `kind`.
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CommandState { /* Move, Attack, Harvest, Construct, Resume, Produce,
                          Cancel, Rally, Stop, DebugSpawn, DebugSetHp */ }

pub struct AiState {
    pub player: u8,
    pub personality: String,
    pub rng: String,                  // SplitMix64 state, u64 decimal
    pub force: Option<u16>,
    pub attackers: Vec<u32>,
    pub active: bool,
}
```

`SplitMix64` gains `pub(crate) fn state(&self) -> u64` and
`pub(crate) fn from_state(state: u64) -> SplitMix64`.

### 3.3 Derived data

These are **not** saved and are rebuilt by `load`: `World::rules` (always
`Ruleset::builtin()`), `terrain` (from the map's `blocked` rectangles, as in
`World::skirmish`), `nav` (terrain plus the footprints of every site; no `Move` remapping is
needed because a saved goal is never blocked), flow `fields` (one
`FlowField::compute(nav, goal)` per saved `flow_goals` entry: a field is a pure
function of `nav` and its goal, and `rebuild_nav` clears them all), `events`
(empty) and the
`Sim` presentation buffers `shots` and `pending_events` (empty). `visible` and
power are saved (§3.2), because they are computed mid-step and recomputing them
on load would change the fog and the snapshots.

The save functions destructure `World`, `Player`, `Entity`, `Site`,
`Projectile` and `Ai` exhaustively (`let World { tick, rules: _, .. }` with
every field named, no `..`), so adding a field without deciding whether it is
saved or derived fails to compile.

### 3.4 Functions (`save.rs`)

```rust
/// Err("save unsupported: world has no map id") when `world.map_id` is None.
pub fn save_state(world: &World, seed: u64, ais: &[Ai]) -> Result<SimState, String>;

/// Rebuilds a world and its AIs. Errors start with "invalid save: " and name
/// the problem: "unsupported format version 7", "unknown map: x",
/// "unknown type: x", "unknown weapon: x", "unknown faction: x",
/// "unknown ai: x", "explored length 12 != 4096 cells", "visible length 12 != 4096 cells",
/// "duplicate entity id 3".
pub fn load_state(state: &SimState) -> Result<(World, u64, Vec<Ai>), String>;
```

Round trip: `save_state(load_state(s))` equals `s` for every `s` produced by
`save_state`.

### 3.5 Setup form (`World::from_setup`)

Example saves are written by hand in a compact **setup** form. A setup is
converted into a tick-0 world:

```rust
pub struct Setup {                    // camelCase, deny_unknown_fields
    pub map: String,
    pub seed: String,                 // u64, decimal
    pub victory: bool,
    pub debug: bool,                  // enables debug commands
    /// true: the map's starts place each player's HQ and dozer (spec 03 §5.6).
    pub starts: bool,
    /// One per map start; absent = `startingCredits` for every player.
    pub credits: Option<Vec<u32>>,
    pub ai: Vec<SetupAi>,             // may be empty
    pub entities: Vec<SetupEntity>,
}
pub struct SetupAi { pub player: u8, pub personality: String, pub active: bool }
pub struct SetupEntity {
    pub player: u8,
    #[serde(rename = "type")] pub kind: String,
    /// Units: centre in centi-tiles. Buildings: absent.
    pub at_centi: Option<[i32; 2]>,
    /// Buildings: footprint origin cell. Units: absent.
    pub origin: Option<[i32; 2]>,
    pub label: Option<String>,
    pub hp_percent: Option<u32>,      // 1..=100, default 100
    pub build_percent: Option<u32>,   // buildings only, 0..=100, default 100
    pub order: Option<SetupOrder>,
}
#[serde(rename_all = "camelCase")]
pub enum SetupOrder {                 // externally tagged: { attack: "leo1" }
    Attack(String),                   // label
    MoveCenti([i32; 2]),
    Harvest(String),                  // label of a depot
}
```

`World::from_setup(rules: Ruleset, setup: &Setup) -> Result<World, SimError>`
(new `SimError::InvalidSetup { detail: String }`, text
`invalid setup: <detail>`):

1. Like `World::skirmish(map)`: terrain, one player per map start with the
   start's faction, every depot (labels `depot-0`, `depot-1`... in map order),
   then, when `starts`, each start's HQ and dozer (labels `hq-<player>`,
   `dozer-<player>`). `map_id = Some(map)`.
2. Credits from `credits` when present (length must equal the starts).
3. Entities in list order. Buildings use `place_building(.., complete)`, with
   `complete = build_percent == 100` and `progress = build_ticks * build_percent`
   otherwise. Units are spawned the way `DebugSpawn` spawns them. The footprint
   must be free and inside the map, and a unit's cell must be open. HP =
   `max(1, max_hp * hp_percent / 100)`.
4. Orders are enqueued in list order, as the entity's owner, in the shape of
   the matching `Command` (`Attack`, `Move`, `Harvest`). They apply on the
   first step.
5. `victory_enabled = victory`, `debug_commands = debug`, initial visibility as
   in `World::skirmish`.

Detail texts: `entities[3]: unknown type x`, `entities[3]: type x is a depot`,
`entities[3]: footprint blocked`, `entities[3]: cell blocked`,
`entities[3]: outside the map`, `entities[3]: unknown label x`,
`entities[3]: duplicate label x`, `entities[3]: building needs origin`,
`entities[3]: unit needs atCenti`, `entities[3]: hpPercent 0 out of 1..=100`,
`entities[3]: player 4 has no start`, `ai[0]: unknown ai x`,
`credits: 3 entries for 2 starts`. AIs are attached with `Ai::new` seeded with
`seed`, then `set_active(active)`.

### 3.6 Format version

`SAVE_FORMAT_VERSION` starts at 1. A PR that changes `SimState` bumps it and
regenerates every committed world-form example (§4.2) by loading it with the
previous version's code path, or replaces it with a setup-form example. Old
browser slots then fail to load with the "unsupported format version" error
(§5.3). Migration code is out of scope.

### 3.7 WASM API v4 (`wasm_api.rs`)

`api_version()` returns 4. New members of `Sim`:

```rust
/// Setup-form world (§3.5) from the JSON of a `Setup`.
pub fn from_setup(json: &str) -> Result<Sim, String>;
/// World-form state (§3.2) from the JSON of a `SimState`.
pub fn load_state(json: &str) -> Result<Sim, String>;
/// JSON of `save_state(world, seed, ais)`; compact, field order of §3.2.
pub fn save_state(&self) -> Result<String, String>;
```

`Sim::skirmish` sets `map_id`. The tech slice cannot be saved.

## 4. Data

### 4.1 Setup-form examples (`data/saves/<id>.yaml`)

```yaml
id: armor-duel                 # required, equals the file name, ^[a-z0-9-]+$, not "slot-*"
map: showcase                  # required, a map id
seed: 1                        # optional, default 1 (written as decimal string in the setup)
victory: false                 # required
debug: true                    # optional, default false
starts: false                  # optional, default true
speed: 1                       # optional, 1..=8, default 1 (client speed, spec 05)
credits: [20000, 20000]        # optional
ai: []                         # optional, [{ player, personality, active }]
client:                        # optional; defaults in §5.1
  controlled: 0
  revealed: true
  camera: { x: 50, y: 20, zoom: 1.5 }
  gore: true
  generatedTextures: true
  fpsPanel: false
entities:                      # optional, default []
  - { player: 0, type: ua-leopard-2a4, atCenti: [4050, 2050], label: leo1 }
  - { player: 1, type: ru-t-72b3, atCenti: [5850, 2050], order: { attack: leo1 } }
  - { player: 0, type: ua-barracks, origin: [10, 4], buildPercent: 40 }
```

Schema: `data/schema/save.schema.json` (JSON Schema 2020-12). Example saves are
listed in `data/rules/globals.yaml` under `saves: [...]`, in menu order, like
`maps`. The player-facing name and description are i18n keys
`saves.<id>.name` and `saves.<id>.description` in `client/src/i18n/en.json`.

### 4.2 World-form examples (`data/saves/<id>.json`)

A `SaveFile` (§5.1) with `world`, as copied from the game and imported by
`saves:import` (§6.2). Listed in `globals.yaml` like the YAML ones. Its `name`
is ignored in the menu, which uses the i18n key.

### 4.3 Build (`scripts/build-data.mjs`)

`buildSaves(sources, ruleset)` validates each save and writes:

* `data/generated/saves/<id>.json`: a `SaveFile` (§5.1). Setup-form examples
  get `setup` (the §3.5 `Setup` with `seed` as a string), `match` and `client`
  with the defaults of §5.1, `name` = the id, `savedAt` =
  `"1970-01-01T00:00:00.000Z"`. World-form examples are copied as they are.
* `data/generated/saves.json`: `{ "formatVersion": 1, "saves": [{ "id",
  "map", "form": "setup" | "world", "entities": <count> }] }` in
  `globals.yaml` order.

Build errors (`DataError`, spec 03 §4.3): `schema`, `duplicate-id`,
`unknown-reference` (map, type, personality, label, faction mismatch: a type of
another faction than the player's start), `invalid-value` (id starting with
`slot-`, overlapping building footprints, unit or footprint outside the map or
on a blocked cell, `buildPercent` on a unit, `origin` on a unit or `atCenti` on
a building). The sim re-checks everything in §3.5. The build only catches
mistakes early.

## 5. Client (`client/`)

### 5.1 Save file (`client/src/saves/saveFile.ts`, new)

```ts
export const SAVE_FILE_FORMAT = "redline-save";
export const SAVE_FILE_VERSION = 1;
export const SLOT_COUNT = 10;
/** `slot-1` .. `slot-10`. */
export type SlotId = `slot-${number}`;

export interface MatchOptions {
  mapId: string;
  seed: string;
  debug: boolean;
  speed: number;
}

export interface ClientState {
  /** Controlled player (spec 08 §3.5). */
  controlled: number;
  /** Viewer is OBSERVER (spec 08 §3.5). */
  revealed: boolean;
  gore: boolean;
  generatedTextures: boolean;
  fpsPanel: boolean;
  /** Ground target in tiles and `camera.zoom` (spec 08 §3.4). */
  camera: { x: number; y: number; zoom: number };
  /** Last view of the other players, by player id (`cameraMemory`). */
  cameraMemory: Record<string, { x: number; y: number }>;
  /** Selected entity ids, ascending. */
  selected: number[];
}

export interface SaveFile {
  format: typeof SAVE_FILE_FORMAT;
  version: typeof SAVE_FILE_VERSION;
  /** Player-given name, 1..=40 chars after trim. */
  name: string;
  /** ISO 8601 UTC, client clock; never read by the sim. */
  savedAt: string;
  /** Sim tick at save time (0 for setup form); shown as game time. */
  tick: number;
  match: MatchOptions;
  client: ClientState;
  /** Exactly one of `world` (a §3.2 `SimState` object) or `setup` (§3.5). */
  world?: unknown;
  setup?: unknown;
}

/** Client defaults when an example omits `client` fields: controlled 0,
 *  revealed false, gore true, generatedTextures true, fpsPanel = debug,
 *  camera = the controlled player's HQ at zoom 1 (or the map centre without
 *  one), cameraMemory {}, selected []. */
export const DEFAULT_CLIENT_STATE: Omit<ClientState, "camera" | "fpsPanel">;

export function buildSaveFile(args: {
  name: string; savedAt: Date; tick: number;
  match: MatchOptions; client: ClientState; worldJson: string;
}): SaveFile;

/** Parses and validates; never throws. Error codes: "json", "format",
 *  "version", "shape" (a missing or mistyped field, or both/neither of
 *  world and setup). */
export function parseSaveFile(text: string):
  { ok: true; save: SaveFile } | { ok: false; error: string };

/** Game time of `tick` at 15 Hz as "m:ss" (or "h:mm:ss" from one hour). */
export function gameTime(tick: number): string;

/** Default name of a new save: "<map name> <gameTime>". */
export function defaultSaveName(mapName: string, tick: number): string;
```

### 5.2 Slot store (`client/src/saves/store.ts`, new)

```ts
export interface SaveSummary {
  id: SlotId;
  name: string;
  mapId: string;
  savedAt: string;
  tick: number;
}

export interface SaveStore {
  /** Occupied slots, ascending slot number. */
  list(): Promise<SaveSummary[]>;
  get(id: SlotId): Promise<SaveFile | null>;
  put(id: SlotId, save: SaveFile): Promise<void>;
  rename(id: SlotId, name: string): Promise<void>;
  remove(id: SlotId): Promise<void>;
}

/** IndexedDB database "redline", version 1, object store "saves" with
 *  keyPath "id"; records are `{ id, save }`. Rejects with
 *  `Error("storage unavailable")` when IndexedDB is missing or blocked. */
export function createIndexedDbSaveStore(): SaveStore;
/** Same contract in memory, for unit tests. */
export function createMemorySaveStore(): SaveStore;
```

### 5.3 Boot with `?load=<id>` (`client/src/saves/boot.ts`, new)

```ts
export type LoadSource =
  | { kind: "slot"; id: SlotId }
  | { kind: "example"; id: string };

/** `slot-N` with 1 <= N <= SLOT_COUNT → slot; any other id listed in
 *  `saves.json` → example; else null. */
export function loadSource(param: string | null, exampleIds: readonly string[]): LoadSource | null;

/** Reads the save of `source` (store or `data/generated/saves/<id>.json`
 *  through a lazy `import.meta.glob`) and validates it. */
export function readSave(source: LoadSource, store: SaveStore):
  Promise<{ ok: true; save: SaveFile } | { ok: false; error: string }>;
```

`startSkirmish` with `?load=<id>`:

1. `loadSource`. Every other URL parameter is ignored. The save's `match`
   gives map, seed, debug and speed.
2. On error (unknown id, empty slot, `parseSaveFile` or worker load error) it
   shows `#load-error` with `t("saves.loadError", { detail })` and starts the
   default skirmish instead.
3. The worker gets `initFromSave` (§5.4). The settings `gore` and
   `generatedTextures` are applied and persisted (`saveSettings`). The
   controlled player, the viewer (`OBSERVER` when `revealed`), `fpsPanel`, the
   camera target and zoom, `cameraMemory` and AI active state come from the
   save. Selection is restored on the first snapshot, keeping only ids that
   exist and belong to the controlled player.
4. The match starts unpaused with the menu closed. "Restart match" reloads the
   same URL, so it restarts from the save.

`?showcase=...` is no longer recognised: it boots the default skirmish.

### 5.4 Protocol (`client/src/sim/protocol.ts`)

`EXPECTED_API_VERSION = 4`. New messages:

```ts
export type InitFromSaveMessage = {
  type: "initFromSave";
  /** JSON of the `world` or `setup` member, as given by the save. */
  form: "world" | "setup";
  json: string;
  viewer: number;
  speed: number;
};
export type SaveRequestMessage = { type: "saveRequest"; requestId: number };
export type SaveStateMessage = {
  type: "saveState";
  requestId: number;
  /** `Sim::save_state` JSON, or null with `error` when it failed. */
  world: string | null;
  error?: string;
};
```

The worker builds the sim with `Sim.from_setup` / `Sim.load_state` and answers
`ready` (or `error` with the sim's text). AI personalities come from the state,
not from the message. `SkirmishClient` gains
`saveState(): Promise<string>`, which rejects with the error text.

### 5.5 Save manager (`client/src/ui/saveManager.ts`, new)

The game menu (spec 08 §3.1) gains a button `#game-menu-saves`
(`t("menu.saves")`, "Saved games") under Resume. It opens `#save-manager`, a
panel over the menu, built once. Buttons are created once and updated on
events, never per frame (client `AGENTS.md`):

* A title `t("saves.title")` and a close button `#save-manager-close`
  (`t("saves.close")`). Esc closes the panel first, then the menu.
* **Slots** section: `SLOT_COUNT` rows `.save-slot[data-slot="slot-N"]`. An
  occupied row shows the name, map name, local date and time of `savedAt`
  (`Intl.DateTimeFormat`, `dateStyle: "short", timeStyle: "short"`) and game
  time. An empty row shows `t("saves.empty")`. Buttons per row:
  * `Save` (`.save-slot-save`). On an empty slot it opens the name dialog,
    pre-filled with `defaultSaveName`. On an occupied slot it opens the same
    dialog pre-filled with the existing name and the text
    `t("saves.confirmOverwrite")`. Confirm saves, Cancel does nothing.
  * `Load` (`.save-slot-load`, occupied only). Opens the confirm dialog with
    `t("saves.confirmLoad")` ("Unsaved progress in the current match will be
    lost."). Confirm navigates to `?load=slot-N`.
  * `Rename` (`.save-slot-rename`, occupied only). Name dialog; `rename`.
  * `Copy` (`.save-slot-copy`, occupied only).
    `navigator.clipboard.writeText(JSON.stringify(save, null, 2))`, then a
    toast `t("saves.copied")`, or `t("saves.copyFailed")` on rejection.
  * `Delete` (`.save-slot-delete`, occupied only). Confirm dialog
    `t("saves.confirmDelete", { name })`; `remove`.
* **Examples** section: one row `.save-example[data-example="<id>"]` per
  example, in `saves.json` order, with `t("saves.<id>.name")` and
  `t("saves.<id>.description")`. Buttons: `Load` (same confirm, then
  `?load=<id>`) and `Copy` (the generated `SaveFile`).
* Dialogs: one `#save-dialog` element reused for name and confirm, with
  `#save-dialog-text`, `#save-dialog-name` (text input, maxlength 40, shown
  only for names), `#save-dialog-ok` and `#save-dialog-cancel`. Enter confirms
  and Esc cancels. OK is disabled while the trimmed name is empty.
* Saving: the client asks the worker for `saveState` while paused (the menu is
  open), builds the `SaveFile` from the current client state with
  `buildSaveFile`, `put`s it and re-renders the rows. A failure shows the toast
  `t("saves.saveFailed", { detail })`.
* When `SaveStore` rejects with "storage unavailable", the Slots section shows
  `t("saves.storageUnavailable")` and only Examples work.

```ts
export interface SaveManagerView {
  open: boolean;
  slots: readonly (SaveSummary | { id: SlotId; empty: true })[];
  examples: readonly { id: string }[];
  storageAvailable: boolean;
  dialog:
    | null
    | { kind: "name"; slot: SlotId; text: string | null; name: string }
    | { kind: "confirm"; text: string; action: SaveManagerAction };
}
export type SaveManagerAction =
  | { kind: "load"; id: string }
  | { kind: "delete"; slot: SlotId };
export interface SaveManagerActions {
  close(): void;
  save(slot: SlotId, name: string): void;
  rename(slot: SlotId, name: string): void;
  load(id: string): void;          // after confirm: navigates to ?load=id
  copy(id: string): void;
  remove(slot: SlotId): void;      // after confirm
}
export function createSaveManager(parent: HTMLElement, actions: SaveManagerActions):
  { root: HTMLElement; render(view: SaveManagerView): void };
```

New i18n keys in `en.json`: `menu.saves`, `saves.title`, `saves.close`,
`saves.slots`, `saves.examples`, `saves.empty`, `saves.save`, `saves.load`,
`saves.rename`, `saves.copy`, `saves.delete`, `saves.ok`, `saves.cancel`,
`saves.namePrompt`, `saves.confirmOverwrite`, `saves.confirmLoad`,
`saves.confirmDelete`, `saves.copied`, `saves.copyFailed`, `saves.saveFailed`,
`saves.loadError`, `saves.storageUnavailable`, and `saves.<id>.name` /
`saves.<id>.description` per example.

### 5.6 Debug API (`window.__redline`)

Gains `saveState(): Promise<string>` (the sim JSON), `loadedSave(): string |
null` (the `?load` id once applied), `cameraZoom(): number`, `controlled():
number`, `viewer(): number` and `entities()` (already used by spec 14 tests:
`{ id, owner, kind, x, y }[]`).

### 5.7 Showcase removal

Removed: `client/src/app/showcase.ts`, `client/src/app/showcase.test.ts`,
`client/tests/e2e/showcase.spec.ts`, `SHOWCASE_MAP`, `SHOWCASE_VIEWS` and the
`?showcase` branch of `startSkirmish`. Kept: the `showcase` map, `DebugSpawn`
of buildings (spec 14 §2, AC-14-01), `#hud-selected-type` and `selectionLabel`
(AC-14-03).

## 6. Agent tooling

### 6.1 Headless (`crates/headless`)

```
headless save run <file> <ticks>   # file: a SaveFile (.json)
headless save check <file>
```

* `run` loads the save (`world` or `setup`), steps `<ticks>` (0..=108000) and
  prints one JSON line:
  `{"tick":900,"outcome":"ongoing"|"winner:0"|"draw","hash":"<16 hex>",
  "players":[{"id":0,"credits":1234,"units":8,"buildings":3,"power":[60,40]}]}`.
  `units` and `buildings` count live entities by category.
* `check` loads, saves and loads again, then exits 0 when the two
  `save_state` JSON strings are identical. Otherwise it prints
  `round trip differs at <json pointer>` and exits 1.
* Errors print the sim text and exit 1.

### 6.2 Scripts (`scripts/saves.mjs`, `package.json`)

```
node --run saves:list                        # one line per example
node --run saves:run -- <id|path> [ticks]    # default 900; headless save run
node --run saves:import -- <file> <id> [--force]
```

* `saves:list` prints `<id>  <map>  <form>  <entities>  http://localhost:5173/?load=<id>`
  per example, from `data/generated/saves.json`. It runs `build:data` first
  when the generated index is older than any `data/saves/*` file.
* `saves:run` resolves `<id>` to `data/generated/saves/<id>.json`, runs
  `cargo run -q --release -p headless -- save run <file> <ticks>` and prints
  its line.
* `saves:import` reads `<file>` (`-` = stdin), `parseSaveFile` rules (shared
  module `scripts/save-file.mjs`, mirrored by `client/src/saves/saveFile.ts`
  and tested against the same fixtures), requires `world`. It writes
  `data/saves/<id>.json` (2-space JSON), appends `<id>` to `saves:` in
  `globals.yaml` and adds `saves.<id>.name` (= the save's `name`) and
  `saves.<id>.description` (= `""`, to be filled by the agent) to
  `en.json`. Then it runs `build:data` and `headless save check`. It refuses
  an existing id without `--force` and an id that breaks §4.1. Output: one
  line `imported <id> (<entities> entities, tick <tick>)` or `error: ...`
  (exit 1).

All three print at most one line per save and never dump save contents.

### 6.3 Skill (`.agents/skills/test-saves/SKILL.md`, new)

Description: "Create, run or import example saves (test scenes) and use them
in tests and owner test steps." Contents:

* When: a feature needs a specific situation to test (units, buildings,
  combat, economy, AI...), writing e2e or sim tests, writing
  `needs-owner-test` steps, or the owner pastes a save.
* The setup-form YAML of §4.1 with one short example, the labels of §3.5 and
  the `saves:*` commands.
* Rules:
  * E2E tests that need a prepared situation load an example save
    (`/?load=<id>`) instead of issuing `debugSpawn` commands.
  * Rust tests that need one use the test helper
    `crates/sim/tests/common/saves.rs::load_example(id) -> Sim`.
  * Every manual step in a `needs-owner-test` comment uses a `?load=` URL
    when the step needs more than a fresh skirmish. When no example fits,
    the PR adds one.
  * A pasted save goes through `saves:import`, then gets a description in
    `en.json` and a contract test (§7) when a test depends on it.
* Root `AGENTS.md`, section "Done Means Self-Tested", gains one line: "Manual
  test steps start from example saves: see the `test-saves` skill."

## 7. Example catalogue

Each example has a contract test (AC-19-14) run natively through
`load_example`. Coordinates are chosen by the implementer within the
constraints. The build rejects overlaps and blocked cells. "AI off" means
`ai: []`. Unless stated otherwise: `debug: true`, `victory: false`,
`client.revealed: true`, camera centred on the action.

| id | map | Content | Contract (native) |
|---|---|---|---|
| `showcase` | showcase | `starts: true`; every non-HQ building and non-dozer unit of each faction once, laid out as spec 14 §4 (buildings at `(x0 + 5i, hqY)`, units in two rows of four at y 16.5 / 20.5); camera zoom 1 at `(x0 + 14, 12)` of player 0 | 28 entities; each faction's types exactly once |
| `showcase-units` | showcase | Same entities as `showcase`; camera zoom 2 at `(x0 + 9.5, 18.5)` | Same as `showcase` |
| `armor-duel` | showcase | 4 `ua-leopard-2a4` + 2 `ua-bradley` facing 4 `ru-t-72b3` + 2 `ru-bmp-2`, 12 tiles apart, each attacking an enemy | A death within 900 ticks |
| `infantry-vs-armor` | showcase | 8 `ua-rifleman` + 4 `ua-stugna-team` in a line; 3 `ru-t-72b3` with move orders through them | A death within 900 ticks |
| `rpg-ambush` | showcase | 6 `ru-rpg-gunner` + 4 `ru-rifleman` beside the path of 4 `ua-bradley` moving across the map | A death within 900 ticks |
| `artillery-range` | showcase | 2 `ua-himars` and 2 `ru-tos-1a` at long range, each attacking an enemy building cluster (power plant, barracks) | A projectile in flight within 300 ticks; building HP lower at 900 |
| `defenses` | showcase | `ua-defense` and `ru-defense`, each with 4 enemy units moving into range | A death within 900 ticks |
| `base-assault` | first-line | `starts: true`, `victory: true`; full complete Ukrainian base; 12 mixed Russian units attacking the HQ; controlled 0 | A Ukrainian building damaged within 900 ticks |
| `economy` | first-line | `starts: true`, AI off, `revealed: false`; each side has a supply center and 2 supply trucks harvesting the nearest depot | Both players' credits rise within 900 ticks |
| `low-power` | showcase | `starts: true`; Ukrainian barracks, factory and defense with one power plant, consumption above production | `power` consumed > produced after 1 tick |
| `production` | first-line | `starts: true`, credits `[50000, 50000]`; every Ukrainian building complete, a rally point on the factory; camera on the base | Every Ukrainian building type present and complete |
| `construction` | showcase | Buildings of both factions at `buildPercent` 0, 30, 60 and 100, each with a dozer resuming it | A site's progress grows within 300 ticks |
| `damaged-base` | showcase | Each building type of both factions at 100, 75, 50, 25 and 10 % HP | HP matches the percentages at tick 0 |
| `pathfinding-river` | first-line | 10 Ukrainian units on the west bank with a move order to a point on the east bank away from the fords | ≥ 8 units within 3 tiles of the target within 1800 ticks |
| `crowd` | showcase | 60 units per side in two blocks, every unit attacking the nearest enemy | No panic at 900 ticks; a death within 900 |
| `gore` | showcase | 20 `ua-rifleman` vs 20 `ru-rifleman` close, attacking; `client.gore: true` | 5 deaths within 900 ticks |
| `victory-near` | showcase | `starts: false`, `victory: true`; one `ru-hq` at 5 % HP attacked by 4 `ua-leopard-2a4` | `Winner(0)` within 900 ticks |
| `ai-attack` | first-line | `starts: true`, `victory: true`; Ukrainian base with few defenders, controlled 0; Russia with a full base, credits 40000 and AI `russia-rush` active; `revealed: false` | A Russian unit inside 20 tiles of the Ukrainian HQ within 6000 ticks |

## 8. Acceptance criteria

### Data

* AC-19-01: Given `data/saves/*` listed in `globals.yaml`, When `build:data`
  runs, Then each example produces `data/generated/saves/<id>.json`. For a
  setup-form example that file holds a `SaveFile` with `setup`, defaulted
  `match` and `client`. `saves.json` lists the ids in order. Given the
  fixtures of each error kind of §4.3, Then the build fails with that code,
  file and pointer.
* AC-19-02: Given the `showcase` example, Then it holds every non-HQ building
  and non-dozer unit type of each faction exactly once (14 entities per
  faction counting the start HQ and dozer), none overlap and all are inside
  the map. Given `showcase-units`, Then its entities equal `showcase`'s and
  only `client.camera` differs. (Ports AC-14-02.)

### Simulation

* AC-19-03: Given a `Setup` with starts, credits, an AI, a unit with
  `hpPercent: 50`, a building with `buildPercent: 40`, labels and the three
  order kinds, When `World::from_setup` runs, Then the world has the depots,
  starts and entities in the order of §3.5, the given credits, HP and site
  progress, `map_id`, victory and debug flags. After one step every order has
  been applied (unit orders are `Attack`/`Move`/`Harvest`). Given each
  invalid setup of §3.5, Then it errors with that detail text.
* AC-19-04: Given (a) a `first-line` skirmish with two AIs at ticks 0, 1000
  and 3000 and (b) every example after 300 ticks, When saved with
  `save_state`, loaded with `load_state` and saved again, Then the two JSON
  strings are byte-identical.
* AC-19-05: Given a `first-line` skirmish with two AIs stepped from tick 2000
  to the first tick with a projectile in flight, plus one pending command
  (enqueued after the last step), When it is saved and loaded into a second `Sim`, and
  both are stepped 900 more ticks, Then every 100 ticks `state_hash_hex`,
  `snapshot_for(0)`, `snapshot_for(1)`, `snapshot_for(OBSERVER)`,
  `fog_for(0)`, `fog_for(1)` and `combat_for(OBSERVER)` are equal. The same
  holds for `armor-duel` and `artillery-range` saved at tick 150.
* AC-19-06: Given a saved state altered to each error case of §3.4, When
  `load_state` runs, Then it errors with the exact text. Given the tech slice,
  Then `save_state` errors with "save unsupported: world has no map id".
* AC-19-07: Given the WASM build, Then `api_version()` is 4, and `Sim` exposes
  `from_setup`, `load_state` and `save_state`, whose JSON round-trips through
  `Sim.load_state` (wasm-bindgen test or the Vitest worker test that already
  loads the WASM package).

### Tooling

* AC-19-08: Given a world-form save and a setup-form save, When
  `headless save run <file> 900` runs, Then it prints one JSON line with the
  fields of §6.1, and the hash equals the native `load` + 900 steps hash.
  `headless save check` exits 0 for both and exits 1 with the "round trip
  differs" text for a fixture whose state does not survive a load.
* AC-19-09: Given a temporary repository copy, When `saves:import` runs with a
  valid world-form file, Then `data/saves/<id>.json`, the `globals.yaml` entry
  and both i18n keys exist and it prints `imported <id> ...`. Given an
  existing id without `--force`, a setup-form file, invalid JSON or an id
  `slot-1`, Then it prints `error: ...`, exits 1 and writes nothing.
  `saves:list` prints one line per example with its `?load=` URL.

### Client

* AC-19-10: Given `parseSaveFile` fixtures (valid world, valid setup, bad
  JSON, wrong format, wrong version, missing field, both world and setup),
  Then it returns the save or the error code of §5.1. `buildSaveFile` output
  parses back to an equal object. `gameTime(0) = "0:00"`,
  `gameTime(15 * 75) = "1:15"` and `gameTime(15 * 3661) = "1:01:01"`. The
  same fixtures pass `scripts/save-file.mjs`.
* AC-19-11: Given the memory store, When saves are `put` into slots 3 and 1,
  renamed and removed, Then `list` returns occupied slots in ascending order
  with the summary fields, `rename` changes only the name, and `get` of a
  removed slot is null.
* AC-19-12: Given `loadSource`, Then `slot-1` and `slot-10` are slots,
  `slot-0`, `slot-11` and `slot-x` are null, a listed example id is an
  example, and an unknown id or null is null.
* AC-19-13: Given a `SaveManagerView` with 2 occupied slots, 8 empty ones,
  the examples and each dialog kind, When rendered (Vitest, DOM), Then the
  rows, the buttons per row of §5.5, the dialog texts and the disabled OK on
  an empty name match §5.5. Rendering the same view twice keeps the same
  button elements.
* AC-19-14: Given every example, When loaded natively and stepped as its row
  of §7 says, Then its contract holds.

### End to end (Playwright, real mouse)

* AC-19-15: Given a fresh skirmish (`?ai=off&debug=1`), When the user pans
  and zooms the camera, switches gore off, selects two units, presses Esc,
  clicks "Saved games", clicks Save on slot 1, types a name and clicks OK,
  then clicks Load on slot 1, Then the confirm dialog shows the lost-progress
  text. When the user clicks OK, Then the URL has `?load=slot-1` and, once
  ready, the tick equals the saved tick (the match was paused while saving), every
  entity id and position equals the saved ones, and the camera target and
  zoom, gore off, controlled player and the two selected ids are restored.
  `saveState()` right after load equals the saved `world` JSON.
* AC-19-16: Given slot 1 occupied, When the user clicks Save on it, Then the
  dialog shows the overwrite text with the old name. After OK the slot holds
  the new tick. Rename changes the shown name. Delete, after confirm, empties
  the row. Copy (clipboard permission granted) puts text that
  `parseSaveFile` accepts with the slot's `world`.
* AC-19-17: Given `/?load=showcase`, When ready, Then 28 entities exist, the
  viewer is the observer, and clicking a unit with the real mouse shows its
  name in `#hud-selected-type` (ports AC-14-04). Given `/?load=armor-duel`,
  Then the camera zoom and target match its `client.camera`. Given
  `/?load=slot-9` with slot 9 empty, Then `#load-error` is visible and the
  default skirmish runs. Given `/?showcase=1`, Then the default skirmish runs
  (no formation).

## 9. Amendments

* Spec 14: superseded by this spec except §2 and the `#hud-selected-type`
  label. By owner decision (2026-10-15) the showcase mode is removed. Its
  tests `client/src/app/showcase.test.ts` (AC-14-02) and
  `client/tests/e2e/showcase.spec.ts` (AC-14-04) are deleted in P5-11. AC-19-02 and AC-19-17
  cover the same behaviour through the `showcase` example. AC-14-01 and
  AC-14-03 stay. These are the only spec-phase tests this spec removes.
* Spec 03 §5.16: WASM API v4 adds the members of §3.7. Existing members are
  unchanged.
* Spec 08 §3.1: the game menu gains the "Saved games" button.

## 10. Traceability

| Criterion | File | Test |
|---|---|---|
| AC-19-01 | `scripts/build-data.test.mjs` | `AC-19-01: example saves build` |
| AC-19-02 | `scripts/build-data.test.mjs` | `AC-19-02: showcase example` |
| AC-19-03 | `crates/sim/tests/save.rs` | `ac_19_03_from_setup` |
| AC-19-04 | `crates/sim/tests/save.rs` | `ac_19_04_round_trip` |
| AC-19-05 | `crates/sim/tests/save.rs` | `ac_19_05_continuity` |
| AC-19-06 | `crates/sim/tests/save.rs` | `ac_19_06_load_errors` |
| AC-19-07 | `client/src/sim/workerHandler.test.ts` | `AC-19-07: WASM save API` |
| AC-19-08 | `crates/headless/tests/cli.rs` | `ac_19_08_save_commands` |
| AC-19-09 | `scripts/saves.test.mjs` | `AC-19-09: saves scripts` |
| AC-19-10 | `client/src/saves/saveFile.test.ts`, `scripts/save-file.test.mjs` | `AC-19-10: save file` |
| AC-19-11 | `client/src/saves/store.test.ts` | `AC-19-11: memory store` |
| AC-19-12 | `client/src/saves/boot.test.ts` | `AC-19-12: load source` |
| AC-19-13 | `client/src/ui/saveManager.test.ts` | `AC-19-13: save manager render` |
| AC-19-14 | `crates/sim/tests/example_saves.rs` | `ac_19_14_<id>` (one per example) |
| AC-19-15 | `client/tests/e2e/saves.spec.ts` | `AC-19-15: save and load a slot` |
| AC-19-16 | `client/tests/e2e/saves.spec.ts` | `AC-19-16: overwrite, rename, delete, copy` |
| AC-19-17 | `client/tests/e2e/saves.spec.ts` | `AC-19-17: example saves and load errors` |

## 11. Issue breakdown

Work in order; each issue depends on the previous one.

| Issue | Content | Criteria | Label |
|---|---|---|---|
| P5-09 (#280) | Sim: `map_id`, `save.rs` types, `save_state` / `load_state`, rng state | AC-19-04 (case a), 05 (first-line case), 06 | ready-pro |
| P5-10 (#281) | Sim: `Setup`, `World::from_setup`; data: save schema, `globals.yaml` `saves`, `buildSaves`, `showcase` and `showcase-units` examples | AC-19-01, 02, 03 | ready-pro |
| P5-11 (#282) | WASM API v4, worker protocol, `saveFile.ts`, `boot.ts`, `?load=`, debug API; showcase mode removal | AC-19-07, 10, 12, 17 | ready-pro |
| P5-12 (#283) | Save manager UI, IndexedDB store, clipboard copy, i18n | AC-19-11, 13, 15, 16 | ready-pro |
| P5-13 (#284) | Example catalogue of §7 and contract tests; AC-19-04 (b) and AC-19-05 example cases | AC-19-04, 05, 14 | ready-pro |
| P5-14 (#285) | Headless `save` commands, `saves:*` scripts, `test-saves` skill, `AGENTS.md` line | AC-19-08, 09 | ready-pro |
