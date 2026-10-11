import {
  BoxGeometry,
  Color,
  DirectionalLight,
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
import {
  createSkirmishController,
  type SkirmishController,
} from "../input/skirmishController";
import { createPerfPanel } from "../perfPanel";
import { createEntityRenderer, type EntityRenderer } from "../render/entities";
import { createFogOverlay } from "../render/fog";
import { loadModels, type ModelRegistry } from "../render/models";
import { createTerrain } from "../render/terrain";
import { RULES, typeDef, typeIndex } from "../rules";
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
} from "../sim/skirmishClient";
import { MAX_SPEED } from "../sim/workerHandler";
import {
  commandButtons,
  createCommandPanel,
  type PanelInput,
  samePanelInput,
} from "../ui/commandPanel";
import { createOutcomeOverlay, outcomeText } from "../ui/outcome";
import { createPlacementHint } from "../ui/placementHint";
import { createResourceBar } from "../ui/resourceBar";
import { createSelectionBox } from "../ui/selectionBox";

export const DEFAULT_MAP = "first-line";
export const DEFAULT_SEED = 1;
/** Opponent personality attached to player 1 by default (spec 05 §7). */
export const DEFAULT_AI = "russia-balanced";
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
/** The builtin ruleset type without a committed `.glb` (spec 06 §3). */
const PLACEHOLDER_TYPE = "tech-slice-placeholder";
/** Model lighting (spec 06 §5): hemisphere fill plus a camera-side sun. */
const HEMISPHERE_SKY = 0xffffff;
const HEMISPHERE_GROUND = 0x444444;
const HEMISPHERE_INTENSITY = 1.2;
const SUN_COLOR = 0xffffff;
const SUN_INTENSITY = 1.5;
const SUN_POSITION = new Vector3(50, 40, 50);

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

/** Skirmish app (default mode): boots the worker, renders the match and wires
 *  the HUD, the resource bar, the command panel and the outcome overlay
 *  (spec §6.7). */
export function startSkirmish(params: SkirmishOptions): void {
  const container = document.getElementById("app");
  if (!container) throw new Error("Missing #app container");
  const hudRoot = document.getElementById("hud") ?? container;

  const seed = readInt(params, "seed", DEFAULT_SEED);
  const mapId = params.get("map") ?? DEFAULT_MAP;
  const debug = params.get("debug") === "1";
  // `?ai=off` keeps the Phase 2 hot-seat behaviour (spec 05 §7).
  const aiParam = params.get("ai");
  const ai = aiParam === "off" ? null : (aiParam ?? DEFAULT_AI);
  const speed = debug
    ? Math.min(MAX_SPEED_SKIRMISH, Math.max(1, readInt(params, "speed", 1)))
    : 1;

  const renderer = new WebGLRenderer({ antialias: true });
  const scene = new Scene();
  scene.background = new Color(0x101820);
  const camera = createIsometricCamera(1);
  const hud = createHud(hudRoot);
  const resourceBar = createResourceBar(document.body);
  const outcome = createOutcomeOverlay(document.body);
  hud.setSelectedCount(0);

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
  let next: MatchSnapshot | null = null;
  let fog: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let receivedAt = 0;
  let controlled = 0;
  let viewer = 0;
  let ready = false;
  /** Type index being placed, or null; the command panel starts placement. */
  let placementKind: number | null = null;
  let controller: SkirmishController | null = null;
  let cameraTarget = { x: 0, y: 0 };
  const interact: SkirmishClient = createSkirmishClient(
    new Worker(new URL("../sim/sim.worker.ts", import.meta.url), {
      type: "module",
    }),
    { seed, mapId, viewer, speed, debug, ai },
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
  let entities: EntityRenderer | null = null;
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

  function centreOnOwnHq(snapshot: MatchSnapshot): void {
    const hq = ownHeadquarters(snapshot.entities, controlled);
    if (hq === null) return;
    if (controller !== null) {
      controller.setTarget(hq.x, hq.y);
      return;
    }
    cameraTarget = { x: hq.x, y: hq.y };
    setCameraTarget(camera, hq.x, hq.y);
  }

  /** `#hud-player`, 1-based (spec §6.6). */
  function setHudPlayer(): void {
    hud.setPlayer(controlled + 1, controlled);
  }

  /** Builds the scene once the map and the first snapshot are known. */
  function start(): void {
    if (ready || map === null || next === null) return;
    const mapInfo = map;
    scene.add(
      createTerrain(mapInfo.mapWidth, mapInfo.mapHeight, mapInfo.tiles),
    );
    const sun = new DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    sun.position.copy(SUN_POSITION);
    scene.add(
      new HemisphereLight(
        HEMISPHERE_SKY,
        HEMISPHERE_GROUND,
        HEMISPHERE_INTENSITY,
      ),
      sun,
    );
    entities = createEntityRenderer(ENTITY_CAPACITY, registry);
    scene.add(entities.group);
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
        refreshOverlay();
      },
      debug,
      setControlledPlayer,
      toggleReveal,
    });
    setHudPlayer();
    centreOnOwnHq(next);
    ready = true;
  }

  /** Applies the controlled-player change of the debug-only F2 key (§6.5). */
  function setControlledPlayer(player: number): void {
    controlled = player;
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

  interact.onSnapshot((snapshot, receivedFog, at) => {
    prev = next ?? snapshot;
    next = snapshot;
    // The worker transfers a fresh ArrayBuffer per snapshot (spec §6.3).
    fog = receivedFog as Uint8Array<ArrayBuffer>;
    receivedAt = at;
    hud.setTick(snapshot.tick);
    // Only the first snapshot of a controlled player re-centres the camera.
    if (!ready) centreOnOwnHq(snapshot);
    start();
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

  const frameStats = createFrameStats();
  const perfPanel = debug ? createPerfPanel(document.body) : null;
  let drawCalls = 0;
  let lastFrameMs: number | null = null;

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const dtMs = lastFrameMs === null ? 0 : now - lastFrameMs;
    if (lastFrameMs !== null) {
      frameStats.record(dtMs);
      perfPanel?.record(dtMs, now);
    }
    lastFrameMs = now;
    controller?.update(dtMs / 1000);
    if (next !== null && prev !== null && entities !== null) {
      entities.update(
        interpolateEntities(prev, next, (now - receivedAt) / TICK_MS),
        controller?.selected ?? NO_SELECTION,
      );
    }
    updatePlacementGhost();
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
      setCameraTarget: (x, y) => {
        if (controller !== null) {
          controller.setTarget(x, y);
          return;
        }
        cameraTarget = { x, y };
        setCameraTarget(camera, x, y);
      },
      command: (command) => interact.command(command),
      stateHash: () => interact.requestHash(),
      drawCalls: () => drawCalls,
      resetFrameStats: () => frameStats.reset(),
      frameStats: () => frameStats.read(),
      injectFrameTimes: (frameTimesMs) => perfPanel?.inject(frameTimesMs),
      resumeFrameTimes: () => perfPanel?.resume(),
    };
    installSkirmishDebugApi(window as { __redline?: SkirmishDebug }, api);
  }
}
