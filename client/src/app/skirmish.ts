import ruleset from "@data/ruleset.json";
import savesIndex from "@data/saves.json";
import {
  ACESFilmicToneMapping,
  BasicShadowMap,
  BoxGeometry,
  Color,
  DirectionalLight,
  type Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { createIsometricCamera, setCameraTarget } from "../camera";
import {
  createFrameStats,
  installSkirmishDebugApi,
  type SkirmishDebug,
} from "../debug";
import { createHud } from "../hud";
import { t } from "../i18n";
import {
  createSkirmishController,
  type SkirmishController,
} from "../input/skirmishController";
import { createPerfPanel } from "../perfPanel";
import { type Animator, createAnimator } from "../render/animation";
import { createCorpses } from "../render/corpses";
import {
  createDeathCauses,
  detectDeaths,
  spawnDeathEffects,
} from "../render/deaths";
import {
  createEffects,
  type EffectKind,
  type Effects,
  spawnShotEffects,
} from "../render/effects";
import { createEntityRenderer, type EntityRenderer } from "../render/entities";
import { createFogOverlay } from "../render/fog";
import {
  type GeneratedTextures,
  loadGeneratedTextures,
} from "../render/generatedTextures";
import { loadModels, type ModelRegistry } from "../render/models";
import {
  createProjectiles,
  PROJECTILE_MODELS,
  type ProjectileModel,
  type Projectiles,
} from "../render/projectiles";
import {
  createTerrain,
  rockCellsOf,
  setTerrainTextures,
} from "../render/terrain";
import { RULES, typeDef, typeIndex, typeName } from "../rules";
import { loadSource, readExample, readSave } from "../saves/boot";
import {
  buildSaveFile,
  type ClientState,
  defaultSaveName,
  type SaveFile,
  SLOT_COUNT,
  type SlotId,
} from "../saves/saveFile";
import { createIndexedDbSaveStore, type SaveStore } from "../saves/store";
import { loadSettings, type Settings, saveSettings } from "../settings";
import type { ProjectileState } from "../sim/combatSnapshot";
import {
  type EntityState,
  interpolateEntities,
  type MatchSnapshot,
  OBSERVER,
  type QueueState,
} from "../sim/matchSnapshot";
import { type ReadyMessage, TICK_MS } from "../sim/protocol";
import {
  createSkirmishClient,
  type SkirmishClient,
  type SkirmishStart,
} from "../sim/skirmishClient";
import { MAX_SPEED } from "../sim/workerHandler";
import {
  commandButtons,
  createCommandPanel,
  type PanelInput,
  samePanelInput,
} from "../ui/commandPanel";
import { createGameMenu } from "../ui/gameMenu";
import { createOutcomeOverlay, outcomeText } from "../ui/outcome";
import { createPlacementHint } from "../ui/placementHint";
import { createResourceBar } from "../ui/resourceBar";
import { createSaveManager, type SlotView } from "../ui/saveManager";
import { createSelectionBox } from "../ui/selectionBox";
import { createTouchControls, isTouchDevice } from "../ui/touchControls";
import { createCameraMemory, homeView } from "./cameraMemory";

export const DEFAULT_MAP = "first-line";
export const DEFAULT_SEED = 1;
/** Opponent personality attached to player 1 by default (spec 05 §7). */
export const DEFAULT_AI = "russia-balanced";

/** Ids of the example saves, in menu order (spec 19 §4.3). */
const EXAMPLE_IDS: readonly string[] = savesIndex.saves.map((save) => save.id);
export const MAX_SPEED_SKIRMISH = MAX_SPEED;

/** Default entity renderer capacity; AC-03-62 and AC-03-63 stay below it. */
const ENTITY_CAPACITY = 2048;
/** Opacity of the placement ghost (spec §6.4). */
const PLACEMENT_GHOST_OPACITY = 0.6;
/** The unit cube ghost rests on the ground. */
const PLACEMENT_GHOST_Y = 0.5;
/** Ghost tint from the client-side `canPlace` prediction (spec §6.5). */
const PLACEMENT_VALID_COLOR = 0xffffff;
const PLACEMENT_INVALID_COLOR = 0xef4444;
/** Selection used before the controller exists (spec §6.7). */
const NO_SELECTION: ReadonlySet<number> = new Set<number>();
/** How long the `G` toast stays on screen (spec 07 §5). */
const TOAST_MS = 2000;
/** Effect counts before the scene exists (spec 07 AC-07-06). */
const NO_PROJECTILE_COUNTS = Object.fromEntries(
  PROJECTILE_MODELS.map((model) => [model, 0]),
) as Record<ProjectileModel, number>;

const NO_EFFECT_COUNTS: Record<EffectKind, number> = {
  muzzle: 0,
  impact: 0,
  blast: 0,
  explosion: 0,
  wreck: 0,
  body: 0,
  blood: 0,
  debris: 0,
};
/** The builtin ruleset type without a committed `.glb` (spec 06 §3). */
const PLACEHOLDER_TYPE = "tech-slice-placeholder";
/** Model lighting (spec 06 §5, spec 10 §3): hemisphere fill plus a warm sun. */
const HEMISPHERE_SKY = 0xdde8ff;
const HEMISPHERE_GROUND = 0x3a3020;
const HEMISPHERE_INTENSITY = 0.9;
const SUN_COLOR = 0xfff1d6;
const SUN_INTENSITY = 2.2;
const SUN_POSITION = new Vector3(-30, 60, 30);
/** Unit vector of `SUN_POSITION`; the sun sits `SUN_DISTANCE` along it. */
const SUN_DIRECTION = SUN_POSITION.clone().normalize();
const SUN_DISTANCE = 50;
/** Half-size in tiles of the sun's orthographic shadow camera (spec 10 §3). */
const SHADOW_EXTENT = 24;
const SHADOW_MAP_SIZE = 2048;
const SHADOW_BIAS = -0.0005;
/** Shadows and the ACES tone mapping of the remastered look (spec 10 §3). */
const TONE_MAPPING_NAMES: Readonly<Record<number, string>> = {
  [ACESFilmicToneMapping]: "ACESFilmic",
};

/** URL parameters of the skirmish app (spec §6.7). */
export type SkirmishOptions = URLSearchParams;

/** The map-covering fog plane created by `createFogOverlay` (spec §6.4). */
type FogOverlay = ReturnType<typeof createFogOverlay>;

function readInt(
  params: URLSearchParams,
  name: string,
  fallback: number,
): number {
  const value = Number.parseInt(params.get(name) ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

/** The complete own HQ of `player` in `entities`, or null; the camera anchor. */
function ownHeadquarters(
  entities: readonly EntityState[],
  player: number,
): EntityState | null {
  const faction = RULES.factions[player];
  if (faction === undefined) return null;
  return (
    entities.find(
      (entity) => entity.owner === player && entity.kind === faction.hq,
    ) ?? null
  );
}

function createPlacementGhost(): {
  mesh: Mesh;
  material: MeshBasicMaterial;
} {
  const material = new MeshBasicMaterial({
    transparent: true,
    opacity: PLACEMENT_GHOST_OPACITY,
  });
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
  mesh.visible = false;
  return { mesh, material };
}

/** How a skirmish starts: from the URL parameters or from a save (spec 19). */
interface SkirmishBoot {
  seed: number;
  /** The seed as saved: a u64 in decimal (spec 19 §5.1). */
  seedText: string;
  mapId: string;
  debug: boolean;
  speed: number;
  /** Whether the skirmish AI of player 1 plays; null when none is attached. */
  aiActive: boolean | null;
  start: SkirmishStart;
  /** State restored from the save, or null for a fresh match. */
  client: ClientState | null;
  /** World-form saves restore gore and textures; examples keep the player's. */
  applySettings: boolean;
  /** The `?load` id once applied. */
  loadedId: string | null;
}

/** A fresh skirmish from the URL parameters (spec §6.7). */
function paramsBoot(params: URLSearchParams): SkirmishBoot {
  const seed = readInt(params, "seed", DEFAULT_SEED);
  const mapId = params.get("map") ?? DEFAULT_MAP;
  const debug = params.get("debug") === "1";
  // `?ai=off` keeps the Phase 2 hot-seat behaviour (spec 05 §7).
  const aiParam = params.get("ai");
  const ai = aiParam === "off" ? null : (aiParam ?? DEFAULT_AI);
  const speed = debug
    ? Math.min(MAX_SPEED_SKIRMISH, Math.max(1, readInt(params, "speed", 1)))
    : 1;
  return {
    seed,
    seedText: String(seed),
    mapId,
    debug,
    speed,
    aiActive: ai === null ? null : true,
    start: { seed, mapId, viewer: 0, speed, debug, ai },
    client: null,
    applySettings: false,
    loadedId: null,
  };
}

/** The AI of player 1 in a save's state, if any (spec 19 §5.3). */
function savedAiActive(save: SaveFile): boolean | null {
  const state = (save.world ?? save.setup) as {
    ais?: { player: number; active: boolean }[];
    ai?: { player: number; active: boolean }[];
  };
  const entry = (state.ais ?? state.ai ?? []).find((ai) => ai.player === 1);
  return entry === undefined ? null : entry.active;
}

/** A skirmish restored from `save`, loaded as `?load=<id>` (spec 19 §5.3). */
function saveBoot(save: SaveFile, id: string): SkirmishBoot {
  const { match, client } = save;
  const speed = match.debug
    ? Math.min(MAX_SPEED_SKIRMISH, Math.max(1, match.speed))
    : 1;
  const form = save.world === undefined ? "setup" : "world";
  return {
    seed: Number.parseInt(match.seed, 10) || DEFAULT_SEED,
    seedText: match.seed,
    mapId: match.mapId,
    debug: match.debug,
    speed,
    aiActive: savedAiActive(save),
    start: {
      save: { form, json: JSON.stringify(save.world ?? save.setup) },
      viewer: client.revealed ? OBSERVER : client.controlled,
      speed,
    },
    client,
    applySettings: form === "world",
    loadedId: id,
  };
}

/** Shows `#load-error` with `detail` (spec 19 §5.3). */
function showLoadError(detail: string): void {
  const element = document.createElement("div");
  element.id = "load-error";
  element.textContent = t("saves.loadError", { detail });
  document.body.appendChild(element);
}

/** Skirmish app (default mode). `?load=<id>` restores a save; when it cannot
 *  be read the default skirmish starts and `#load-error` says why (spec 19
 *  §5.3). Every other parameter is ignored while loading. */
export function startSkirmish(params: SkirmishOptions): void {
  const store = createIndexedDbSaveStore();
  const load = params.get("load");
  if (load === null) {
    runSkirmish(paramsBoot(params), store);
    return;
  }
  const source = loadSource(load, EXAMPLE_IDS);
  const read =
    source === null
      ? Promise.resolve({ ok: false as const, error: `unknown save ${load}` })
      : readSave(source, store);
  void read.then((result) => {
    if (result.ok) {
      runSkirmish(saveBoot(result.save, load), store);
      return;
    }
    showLoadError(result.error);
    runSkirmish(paramsBoot(new URLSearchParams()), store);
  });
}

/** Player slot ids `slot-1` .. `slot-SLOT_COUNT`. */
const SLOT_IDS: readonly SlotId[] = Array.from(
  { length: SLOT_COUNT },
  (_, i) => `slot-${i + 1}` as SlotId,
);

/** Boots the worker, renders the match and wires the HUD, the resource bar,
 *  the command panel and the outcome overlay (spec §6.7). */
function runSkirmish(boot: SkirmishBoot, store: SaveStore): void {
  const container = document.getElementById("app");
  if (!container) throw new Error("Missing #app container");
  const hudRoot = document.getElementById("hud") ?? container;
  const { seed, mapId, debug } = boot;
  const restored = boot.client;

  const renderer = new WebGLRenderer({ antialias: true });
  // Remastered look (spec 10 §3): hard PCF shadows and ACES tone mapping.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = BasicShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new Scene();
  scene.background = new Color(0x101820);
  const camera = createIsometricCamera(1);
  const hud = createHud(hudRoot);
  const resourceBar = createResourceBar(document.body);
  const outcome = createOutcomeOverlay(document.body);
  hud.setSelectedCount(0);

  let settings: Settings = loadSettings();
  if (restored !== null && boot.applySettings) {
    settings = {
      ...settings,
      gore: restored.gore,
      generatedTextures: restored.generatedTextures,
    };
    saveSettings(settings);
  }
  const toast = document.getElementById("toast");
  let toastTimer: number | null = null;
  let paused = false;
  /** Wall-clock time spent paused; subtracted from the effects clock (spec 08 §3). */
  let pausedTotalMs = 0;
  let pauseStartMs: number | null = null;
  /** Whether the skirmish AI plays; null when none is attached (spec 08 §3.3). */
  let aiActive: boolean | null = boot.aiActive;
  /** Whether the performance panel shows; on with `?debug=1` (spec 08 §3.5). */
  let fpsPanel = restored?.fpsPanel ?? debug;
  /** Player whose fog the worker snapshots; `OBSERVER` while the map is revealed. */
  let viewer = boot.start.viewer;

  const gameMenu = createGameMenu(document.body, {
    resume: () => setMenuOpen(false),
    openSaveGame: () => openSaves("save"),
    openLoadGame: () => openSaves("load"),
    toggleGore: () => toggleGore(),
    toggleAi: () => toggleAi(),
    toggleTextures: () => toggleTextures(),
    switchSide: () => switchSide(),
    toggleReveal: () => toggleReveal(),
    toggleFpsPanel: () => toggleFpsPanel(),
    restart: () => window.location.reload(),
  });
  // Joystick and menu button on touch screens only (spec 08 §3.6).
  const touchControls = isTouchDevice()
    ? createTouchControls(document.body, {
        pan: (x, y) => controller?.setAnalogPan(x, y),
        toggleMenu: () => toggleMenuLikeEsc(),
      })
    : null;
  if (touchControls !== null) document.body.classList.add("touch");
  /** Whether the save manager is open over the game menu (spec 19 §5.5). */
  let savesOpen = false;
  /** Which menu button opened it. */
  let savesMode: "save" | "load" = "load";

  function openSaves(mode: "save" | "load"): void {
    savesMode = mode;
    savesOpen = true;
    void renderSaves();
  }
  let storageAvailable = true;
  const saveManager = createSaveManager(document.body, {
    close: () => {
      savesOpen = false;
      void renderSaves();
    },
    save: (slot, name) => void saveToSlot(slot, name),
    rename: (slot, name) =>
      void store.rename(slot, name).then(() => renderSaves()),
    load: (id) => {
      window.location.assign(`?load=${encodeURIComponent(id)}`);
    },
    copy: (id) => void copySave(id),
    remove: (slot) => void store.remove(slot).then(() => renderSaves()),
  });
  renderMenu();

  /** Re-reads the slots and renders the save manager (spec 19 §5.5). */
  async function renderSaves(): Promise<void> {
    let slots: SlotView[] = SLOT_IDS.map((id) => ({ id, empty: true }));
    if (savesOpen) {
      try {
        const saved = await store.list();
        slots = SLOT_IDS.map(
          (id) =>
            saved.find((summary) => summary.id === id) ?? { id, empty: true },
        );
        storageAvailable = true;
      } catch {
        storageAvailable = false;
      }
    }
    saveManager.render({
      open: savesOpen,
      mode: savesMode,
      slots,
      examples: EXAMPLE_IDS,
      storageAvailable,
      defaultName: defaultSaveName(mapId, next?.tick ?? 0),
    });
  }

  /** The client half of a save (spec 19 §5.1). */
  function clientState(): ClientState {
    const target = controller?.cameraTarget() ?? cameraTarget;
    return {
      controlled,
      revealed: viewer === OBSERVER,
      gore: settings.gore,
      generatedTextures: settings.generatedTextures !== false,
      fpsPanel,
      camera: { x: target.x, y: target.y, zoom: camera.zoom },
      cameraMemory: cameraMemory.views(),
      selected: [...(controller?.selected ?? [])].sort((a, b) => a - b),
    };
  }

  /** Saves the paused match into `slot` (spec 19 §5.5). */
  async function saveToSlot(slot: SlotId, name: string): Promise<void> {
    try {
      const world = await interact.saveState();
      const tick = (JSON.parse(world) as { tick: number }).tick;
      await store.put(
        slot,
        buildSaveFile({
          name,
          savedAt: new Date(),
          tick,
          match: {
            mapId,
            seed: boot.seedText,
            debug,
            speed: boot.speed,
          },
          client: clientState(),
          worldJson: world,
        }),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      showToast(t("saves.saveFailed", { detail }));
    }
    await renderSaves();
  }

  /** Puts a slot's or an example's save file on the clipboard. */
  async function copySave(id: string): Promise<void> {
    try {
      const slotId = SLOT_IDS.find((slot) => slot === id);
      const save =
        slotId === undefined ? await readExample(id) : await store.get(slotId);
      if (save === null) throw new Error(`${id} is empty`);
      await navigator.clipboard.writeText(JSON.stringify(save, null, 2));
      showToast(t("saves.copied"));
    } catch {
      showToast(t("saves.copyFailed"));
    }
  }

  /** Renders the game menu from the current state (spec 08 §3.1, §3.3). */
  function renderMenu(): void {
    gameMenu.render({
      open: paused,
      gore: settings.gore,
      ai: aiActive,
      generatedTextures: settings.generatedTextures !== false,
      revealed: viewer === OBSERVER,
      fpsPanel,
    });
    touchControls?.render({ menuOpen: paused });
  }

  /** Shows `message` in `#toast` for `TOAST_MS` (spec 07 §5). */
  function showToast(message: string): void {
    if (!(toast instanceof HTMLElement)) return;
    toast.textContent = message;
    toast.classList.add("visible");
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("visible");
    }, TOAST_MS);
  }

  function resize(): void {
    const { clientWidth: width, clientHeight: height } =
      container as HTMLElement;
    renderer.setSize(width, height);
    const aspect = width / Math.max(height, 1);
    const halfHeight = (camera.top - camera.bottom) / 2;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  container.appendChild(renderer.domElement);
  window.addEventListener("resize", resize);
  resize();

  let map: ReadyMessage | null = null;
  let prev: MatchSnapshot | null = null;
  /** The first snapshot, for the save tests (spec 19 §5.6). */
  let initial: MatchSnapshot | null = null;
  let next: MatchSnapshot | null = null;
  let fog: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let receivedAt = 0;
  let controlled = restored?.controlled ?? 0;
  let ready = false;
  /** Type index being placed, or null; the command panel starts placement. */
  let placementKind: number | null = null;
  let controller: SkirmishController | null = null;
  /** Shadow-casting sun; its shadow camera follows the camera target (spec 10 §3). */
  let sunLight: DirectionalLight | null = null;
  let cameraTarget = { x: 0, y: 0 };
  /** Per-player camera views for hot-seat player changes (spec 08 §3.2). */
  const cameraMemory = createCameraMemory(restored?.cameraMemory);
  /** True after F2 to a player with no stored view: the next snapshot built
   *  for that player centres the camera on their base. */
  let centrePending = false;
  const interact: SkirmishClient = createSkirmishClient(
    new Worker(new URL("../sim/sim.worker.ts", import.meta.url), {
      type: "module",
    }),
    boot.start,
  );
  let uiRenders = 0;
  const commandPanel = createCommandPanel(document.body, {
    onConstruct: (kind) => {
      placementKind = kind;
      refreshOverlay();
    },
    onProduce: (kind) => {
      const building = selectedProductionBuilding(kind);
      if (building === null) return;
      interact.command({
        kind: "produce",
        player: controlled,
        building: building.id,
        typeIndex: kind,
      });
    },
    onCancel: () => {
      const queue = selectedQueue();
      if (queue === null) return;
      interact.command({
        kind: "cancel",
        player: controlled,
        building: queue.building,
      });
    },
  });
  let animator: Animator;
  const corpses = createCorpses();
  const deathCauses = createDeathCauses();
  let entities: EntityRenderer | null = null;
  let terrain: Group | null = null;
  /** Generated PNGs, loaded the first time they are switched on (spec 12). */
  let generated: GeneratedTextures | null = null;
  let generatedLoading = false;
  let effects: Effects | null = null;
  let projectiles: Projectiles | null = null;
  /** Flying projectiles of the latest combat snapshot (spec 17 §5). */
  let flying: readonly ProjectileState[] = [];
  let fogOverlay: FogOverlay | null = null;
  const placementGhost = createPlacementGhost();
  const placementHint = createPlacementHint(document.body);
  /** Models applied to the entity renderer; fallback boxes until they load. */
  let models: ModelRegistry | null = null;
  let modelsReady = false;
  const registry: ModelRegistry = { get: (typeId) => models?.get(typeId) };
  void loadModels(
    RULES.types.filter((type) => type.id !== PLACEHOLDER_TYPE),
  ).then((loaded) => {
    models = loaded;
    modelsReady = true;
  });

  /** The queue of the selected production building, if any. */
  function selectedQueue(): QueueState | null {
    const active = controller;
    if (next === null || active === null) return null;
    return (
      next.queues.find((queue) => active.selected.has(queue.building)) ?? null
    );
  }

  /** Own entities currently selected. */
  function selectedEntities(): EntityState[] {
    const active = controller;
    if (next === null || active === null) return [];
    return next.entities.filter(
      (entity) => entity.owner === controlled && active.selected.has(entity.id),
    );
  }

  /** The selected complete own building that produces `kind`, if any. */
  function selectedProductionBuilding(kind: number): EntityState | null {
    return (
      selectedEntities().find(
        (entity) =>
          typeDef(entity.kind).category === "building" &&
          typeDef(entity.kind).produces.includes(kind),
      ) ?? null
    );
  }

  /** A restored save's camera, else the controlled player's HQ (spec 19 §5.3). */
  function centreOnOwnHq(snapshot: MatchSnapshot): void {
    if (restored !== null) {
      moveCamera(restored.camera.x, restored.camera.y);
      return;
    }
    const hq = ownHeadquarters(snapshot.entities, controlled);
    if (hq === null) return;
    moveCamera(hq.x, hq.y);
  }

  function moveCamera(x: number, y: number): void {
    if (controller !== null) {
      controller.setTarget(x, y);
      return;
    }
    cameraTarget = { x, y };
    setCameraTarget(camera, x, y);
  }

  /** Centres on the controlled player's base once a snapshot built for them
   *  arrives (spec 08 §3.2). */
  function centreOnHomeIfPending(snapshot: MatchSnapshot): void {
    if (!centrePending) return;
    if (snapshot.viewer !== controlled && snapshot.viewer !== OBSERVER) return;
    centrePending = false;
    const home = homeView(
      snapshot.entities,
      controlled,
      RULES.factions[controlled]?.hq ?? null,
      (kind) => typeDef(kind).category === "building",
    );
    if (home === null) return;
    moveCamera(home.x, home.y);
  }

  /** `#hud-player`, 1-based (spec §6.6). */
  function setHudPlayer(): void {
    hud.setPlayer(controlled + 1, controlled);
  }

  /** Builds the scene once the map and the first snapshot are known. */
  function start(): void {
    if (ready || map === null || next === null) return;
    const mapInfo = map;
    // Rock tiles are the static obstacles of the ruleset map; the ready
    // message's `tiles` also marks buildings and depots (spec 10 §4).
    const mapDefinition = ruleset.maps.find((entry) => entry.id === mapId);
    const rockCells =
      mapDefinition === undefined
        ? new Uint8Array(mapInfo.mapWidth * mapInfo.mapHeight)
        : rockCellsOf(mapDefinition);
    terrain = createTerrain(
      mapInfo.mapWidth,
      mapInfo.mapHeight,
      rockCells,
      seed,
    );
    scene.add(terrain);
    const sun = new DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    sun.shadow.camera.left = -SHADOW_EXTENT;
    sun.shadow.camera.right = SHADOW_EXTENT;
    sun.shadow.camera.top = SHADOW_EXTENT;
    sun.shadow.camera.bottom = -SHADOW_EXTENT;
    sun.shadow.bias = SHADOW_BIAS;
    sun.shadow.camera.updateProjectionMatrix();
    sunLight = sun;
    updateSun();
    scene.add(
      new HemisphereLight(
        HEMISPHERE_SKY,
        HEMISPHERE_GROUND,
        HEMISPHERE_INTENSITY,
      ),
      sun,
      sun.target,
    );
    animator = createAnimator();
    entities = createEntityRenderer(
      ENTITY_CAPACITY,
      registry,
      animator,
      corpses,
    );
    scene.add(entities.group);
    effects = createEffects();
    scene.add(effects.group);
    projectiles = createProjectiles();
    scene.add(projectiles.group);
    fogOverlay = createFogOverlay(mapInfo.mapWidth, mapInfo.mapHeight);
    scene.add(fogOverlay.mesh);
    scene.add(placementGhost.mesh);
    controller = createSkirmishController({
      canvas: renderer.domElement,
      selectionBox: createSelectionBox(document.body),
      keyTarget: window,
      camera,
      mapWidth: mapInfo.mapWidth,
      mapHeight: mapInfo.mapHeight,
      entities: () => next?.entities ?? [],
      tiles: () => mapInfo.tiles,
      fog: () => fog,
      placementKind: () => placementKind,
      exitPlacement: () => {
        placementKind = null;
        refreshOverlay();
      },
      player: () => controlled,
      command: (command) => interact.command(command),
      onSelectionChange: (ids) => {
        hud.setSelectedCount(ids.size);
        hud.setSelectedTypes(
          (next?.entities ?? [])
            .filter((entity) => ids.has(entity.id))
            .map((entity) => typeName(entity.kind)),
        );
        refreshOverlay();
      },
      debug,
      setControlledPlayer,
      toggleReveal,
    });
    setHudPlayer();
    centreOnOwnHq(next);
    if (restored !== null) restoreView(next);
    ready = true;
    // Generated textures are the default: load the PNGs once the scene exists.
    if (settings.generatedTextures !== false) {
      settings = { ...settings, generatedTextures: false };
      toggleTextures();
    }
  }

  /** Restores a save's zoom and selection once the scene exists (spec 19
   *  §5.3): only ids that exist and belong to the controlled player. */
  function restoreView(snapshot: MatchSnapshot): void {
    if (restored === null) return;
    camera.zoom = restored.camera.zoom;
    camera.updateProjectionMatrix();
    const own = new Set(
      snapshot.entities
        .filter((entity) => entity.owner === controlled)
        .map((entity) => entity.id),
    );
    controller?.setSelection(restored.selected.filter((id) => own.has(id)));
  }

  /** Centres the sun's shadow camera on the camera's ground target (spec 10 §3):
   *  the sun sits `SUN_DISTANCE` along `SUN_DIRECTION` from it. Zoomed out, the
   *  shadow camera grows to `SHADOW_EXTENT / zoom` (spec 08 §3.4). */
  function updateSun(): void {
    if (sunLight === null) return;
    const extent = SHADOW_EXTENT / Math.min(camera.zoom, 1);
    const shadowCamera = sunLight.shadow.camera;
    if (shadowCamera.right !== extent) {
      shadowCamera.left = -extent;
      shadowCamera.right = extent;
      shadowCamera.top = extent;
      shadowCamera.bottom = -extent;
      shadowCamera.updateProjectionMatrix();
    }
    const target = controller?.cameraTarget() ?? cameraTarget;
    sunLight.target.position.set(target.x, 0, target.y);
    sunLight.position
      .copy(sunLight.target.position)
      .addScaledVector(SUN_DIRECTION, SUN_DISTANCE);
    sunLight.target.updateMatrixWorld();
  }

  /** Applies the controlled-player change of the debug-only F2 key (§6.5). */
  function setControlledPlayer(player: number): void {
    const current = controller?.cameraTarget() ?? cameraTarget;
    const view = cameraMemory.switchPlayer(controlled, player, current);
    controlled = player;
    if (view === null) {
      centrePending = true;
      if (next !== null) centreOnHomeIfPending(next);
    } else {
      centrePending = false;
      moveCamera(view.x, view.y);
    }
    // Reveal keeps the observer viewer; otherwise the viewer follows.
    if (viewer !== OBSERVER) {
      viewer = player;
      interact.setViewer(viewer);
    }
    setHudPlayer();
    refreshOverlay();
  }

  /** Applies the debug-only F3 reveal toggle (§6.5). */
  function toggleReveal(): void {
    viewer = viewer === OBSERVER ? controlled : OBSERVER;
    interact.setViewer(viewer);
    renderMenu();
  }

  /** Switches to the other player like F2, from the game menu (spec 08 §3.5). */
  function switchSide(): void {
    controller?.clearSelection();
    setControlledPlayer(controlled === 0 ? 1 : 0);
  }

  /** Shows or hides the performance panel (spec 08 §3.5). */
  function toggleFpsPanel(): void {
    fpsPanel = !fpsPanel;
    perfPanel.setVisible(fpsPanel);
    renderMenu();
  }

  /** Last command panel input, to skip renders that would change nothing. */
  let lastPanel: PanelInput | null = null;

  /** Refreshes the DOM overlay; called on events only, never per frame
   *  (spec §6.7, #140). */
  function refreshOverlay(): void {
    resourceBar.render(next);
    outcome.render(next === null ? null : outcomeText(next, controlled));
    const queue = next === null ? null : selectedQueue();
    const panel: PanelInput = {
      buttons:
        next === null
          ? []
          : commandButtons({
              selected: selectedEntities(),
              ownEntities: next.entities.filter(
                (entity) => entity.owner === controlled,
              ),
              credits: next.credits,
              queue,
            }),
      queue,
      placing: placementKind,
    };
    if (lastPanel !== null && samePanelInput(lastPanel, panel)) return;
    lastPanel = panel;
    uiRenders++;
    commandPanel.render(panel.buttons, panel.queue, panel.placing);
  }

  /** Positions and tints the footprint ghost while placing (spec §6.5). */
  function updatePlacementGhost(): void {
    const preview = controller?.placementPreview() ?? null;
    placementGhost.mesh.visible = preview !== null;
    placementHint.render(
      placementKind === null
        ? "hidden"
        : preview === null || preview.valid
          ? "legal"
          : "illegal",
    );
    if (preview === null) return;
    const [width, height] = typeDef(preview.kind).footprint;
    placementGhost.mesh.position.set(
      preview.origin.x + width / 2,
      PLACEMENT_GHOST_Y,
      preview.origin.y + height / 2,
    );
    placementGhost.mesh.scale.set(width, 1, height);
    placementGhost.material.color.set(
      preview.valid ? PLACEMENT_VALID_COLOR : PLACEMENT_INVALID_COLOR,
    );
  }

  interact.onSnapshot((snapshot, receivedFog, at, combat) => {
    initial ??= snapshot;
    const previous = next;
    flying = combat.projectiles;
    prev = previous ?? snapshot;
    next = snapshot;
    // The worker transfers a fresh ArrayBuffer per snapshot (spec §6.3).
    fog = receivedFog as Uint8Array<ArrayBuffer>;
    receivedAt = at;
    hud.setTick(snapshot.tick);
    // Only the first snapshot of a controlled player re-centres the camera.
    if (!ready) centreOnOwnHq(snapshot);
    centreOnHomeIfPending(snapshot);
    start();
    // Effects derive from the tick transition only; a re-post from `setViewer`
    // repeats the same tick and must not duplicate shots.
    if (
      effects !== null &&
      (previous === null || snapshot.tick > previous.tick)
    ) {
      spawnShotEffects(snapshot, effects, effectTime(at));
      animator.recordShots(snapshot.entities, at);
      deathCauses.record(snapshot.entities, effectTime(at));
      const deaths =
        previous === null ? [] : detectDeaths(previous, snapshot, viewer);
      spawnDeathEffects(
        deaths,
        effects,
        settings.gore,
        effectTime(at),
        corpses,
        deathCauses,
      );
    }
    refreshOverlay();
  });
  interact.ready.then(
    (message) => {
      map = message;
      start();
    },
    (error: unknown) => {
      hud.showError(error instanceof Error ? error.message : String(error));
    },
  );

  /** Toggles the gore filter, persists it and shows a toast (spec 07 §5). */
  function toggleGore(): void {
    settings = { ...settings, gore: !settings.gore };
    saveSettings(settings);
    if (!settings.gore) effects?.clear("blood");
    showToast(t(settings.gore ? "settings.goreOn" : "settings.goreOff"));
    renderMenu();
  }

  /** Applies the generated textures to the terrain and the models when the
   *  setting is on and they are loaded, the procedural ones otherwise. */
  function applyTextures(): void {
    const active = settings.generatedTextures !== false ? generated : null;
    if (terrain !== null) setTerrainTextures(terrain, active);
    entities?.setGeneratedTextures(active);
  }

  /** Switches between procedural and generated textures live and persists the
   *  choice (spec 12 §3); the PNGs load on first use. */
  function toggleTextures(): void {
    const on = settings.generatedTextures === false;
    settings = { ...settings, generatedTextures: on };
    saveSettings(settings);
    renderMenu();
    if (on && generated === null && !generatedLoading) {
      generatedLoading = true;
      void loadGeneratedTextures().then((loaded) => {
        generated = loaded;
        generatedLoading = false;
        applyTextures();
      });
      return;
    }
    applyTextures();
  }

  /** Pauses or resumes the skirmish AI (spec 08 §3.3). */
  function toggleAi(): void {
    if (aiActive === null) return;
    aiActive = !aiActive;
    interact.setAiActive(aiActive);
    renderMenu();
  }

  /** Freezes the effects clock while paused and keeps it continuous otherwise. */
  function effectTime(wallMs: number): number {
    const ongoing = pauseStartMs === null ? 0 : wallMs - pauseStartMs;
    return wallMs - pausedTotalMs - ongoing;
  }

  /** Opens or closes the game menu; there is no pause without the menu
   *  (spec 08 §3.1). */
  function setMenuOpen(open: boolean): void {
    if (paused !== open) {
      paused = open;
      if (open) {
        pauseStartMs = performance.now();
      } else if (pauseStartMs !== null) {
        pausedTotalMs += performance.now() - pauseStartMs;
        pauseStartMs = null;
      }
      interact.setPaused(paused);
    }
    if (!open && savesOpen) {
      savesOpen = false;
      void renderSaves();
    }
    renderMenu();
  }

  /** What `Esc` does: cancels a placement mode, else toggles the menu. */
  function toggleMenuLikeEsc(): void {
    if (saveManager.handleEscape()) return;
    if (placementKind !== null) {
      placementKind = null;
      refreshOverlay();
      return;
    }
    setMenuOpen(!paused);
  }

  window.addEventListener("keydown", (event) => {
    if (event.key === "g" || event.key === "G") {
      event.preventDefault();
      toggleGore();
      return;
    }
    if (event.key !== "Escape") return;
    // While a placement mode is active the controller cancels it instead; this
    // listener runs first, so it must leave the event alone (spec 08 §3.1).
    if (placementKind !== null) return;
    event.preventDefault();
    // The save manager closes its dialog, then itself, before the menu.
    if (saveManager.handleEscape()) return;
    setMenuOpen(!paused);
  });

  const frameStats = createFrameStats();
  const perfPanel = createPerfPanel(document.body);
  perfPanel.setVisible(fpsPanel);
  let drawCalls = 0;
  let lastFrameMs: number | null = null;

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const dtMs = lastFrameMs === null ? 0 : now - lastFrameMs;
    if (lastFrameMs !== null) {
      frameStats.record(dtMs);
      perfPanel.record(dtMs, now);
    }
    lastFrameMs = now;
    controller?.update(dtMs / 1000);
    updateSun();
    if (next !== null && prev !== null && entities !== null) {
      const alpha = (now - receivedAt) / TICK_MS;
      entities.update(
        interpolateEntities(prev, next, alpha),
        controller?.selected ?? NO_SELECTION,
        effectTime(now),
      );
      // Entities are drawn between the previous and the latest tick, so the
      // projectiles fly at the same fractional tick.
      projectiles?.sync(
        flying,
        next.tick - 1 + Math.min(1, Math.max(0, alpha)),
        next,
      );
    }
    updatePlacementGhost();
    effects?.update(effectTime(now));
    fogOverlay?.update(fog);
    renderer.render(scene, camera);
    drawCalls = renderer.info.render.calls;
  }
  requestAnimationFrame(frame);

  if (debug) {
    const api: SkirmishDebug = {
      isReady: () => ready,
      uiRenders: () => uiRenders,
      mode: () => "skirmish",
      modelsReady: () => modelsReady,
      tick: () => next?.tick ?? 0,
      paused: () => paused,
      menuOpen: () => paused,
      aiActive: () => aiActive,
      controlledPlayer: () => controlled,
      viewer: () => viewer,
      entities: () => next?.entities ?? [],
      entity: (id) => next?.entities.find((entity) => entity.id === id) ?? null,
      typeIndex: (id) => typeIndex(id),
      fogAt: (x, y) => {
        if (map === null) return 0;
        return fog[y * map.mapWidth + x] ?? 0;
      },
      credits: () => next?.credits ?? 0,
      power: () => ({
        produced: next?.powerProduced ?? 0,
        consumed: next?.powerConsumed ?? 0,
      }),
      outcome: () => ({
        outcome: next?.outcome ?? "ongoing",
        winner: next?.winner ?? null,
      }),
      selectedIds: () =>
        [...(controller?.selected ?? [])].sort((a, b) => a - b),
      worldToScreen: (x, y) => {
        const ndc = new Vector3(x, 0, y).project(camera);
        const rect = renderer.domElement.getBoundingClientRect();
        return {
          x: rect.left + ((ndc.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - ndc.y) / 2) * rect.height,
        };
      },
      cameraTarget: () => controller?.cameraTarget() ?? { ...cameraTarget },
      zoom: () => camera.zoom,
      loadedSave: () => boot.loadedId,
      initialSnapshot: () =>
        initial === null
          ? null
          : {
              tick: initial.tick,
              entities: initial.entities.map(({ id, x, y }) => ({ id, x, y })),
            },
      saveState: () => interact.saveState(),
      setSimPaused: (simPaused) => interact.setPaused(simPaused),
      setCameraTarget: moveCamera,
      command: (command) => interact.command(command),
      stateHash: () => interact.requestHash(),
      effectCounts: () => effects?.counts() ?? NO_EFFECT_COUNTS,
      projectileCounts: () => projectiles?.counts() ?? NO_PROJECTILE_COUNTS,
      projectileSamples: () => projectiles?.samples() ?? [],
      gore: () => settings.gore,
      drawCalls: () => drawCalls,
      renderInfo: () => ({
        shadowMap: renderer.shadowMap.enabled,
        sunCastsShadow: sunLight?.castShadow ?? false,
        toneMapping: TONE_MAPPING_NAMES[renderer.toneMapping] ?? "unknown",
      }),
      resetFrameStats: () => frameStats.reset(),
      frameStats: () => frameStats.read(),
      injectFrameTimes: (frameTimesMs) => perfPanel.inject(frameTimesMs),
      resumeFrameTimes: () => perfPanel.resume(),
    };
    installSkirmishDebugApi(window as { __redline?: SkirmishDebug }, api);
  }
}
