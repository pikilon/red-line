import {
  BoxGeometry,
  Color,
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
import { type CommandButton, commandButtons } from "../ui/commandPanel";
import { outcomeText } from "../ui/outcome";
import { resourceText } from "../ui/resourceBar";

export const DEFAULT_MAP = "first-line";
export const DEFAULT_SEED = 1;
export const MAX_SPEED_SKIRMISH = MAX_SPEED;

/** Default entity renderer capacity; AC-03-62 and AC-03-63 stay below it. */
const ENTITY_CAPACITY = 2048;
/** Opacity of the placement ghost (spec §6.4). */
const PLACEMENT_GHOST_OPACITY = 0.4;
/** The unit cube ghost rests on the ground. */
const PLACEMENT_GHOST_Y = 0.5;
/** Ghost tint from the client-side `canPlace` prediction (spec §6.5). */
const PLACEMENT_VALID_COLOR = 0x22c55e;
const PLACEMENT_INVALID_COLOR = 0xef4444;
/** Queue progress bar maximum (spec §6.6). */
const QUEUE_PROGRESS_MAX = 1000;
/** Selection used before the controller exists (spec §6.7). */
const NO_SELECTION: ReadonlySet<number> = new Set<number>();

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

function appendDiv(root: HTMLElement, id: string): HTMLDivElement {
  const element = document.createElement("div");
  element.id = id;
  root.appendChild(element);
  return element;
}

/** `<div id="outcome" role="status">`, hidden while null (spec §6.6). */
export function createOutcomeOverlay(root: HTMLElement): {
  render(text: string | null): void;
} {
  const element = appendDiv(root, "outcome");
  element.setAttribute("role", "status");
  element.hidden = true;
  return {
    render(text) {
      element.textContent = text ?? "";
      element.hidden = text === null;
    },
  };
}

/** `<div id="resource-bar">` with `#res-credits` and `#res-power` (spec §6.6). */
export function createResourceBar(root: HTMLElement): {
  render(snapshot: MatchSnapshot | null): void;
} {
  const bar = appendDiv(root, "resource-bar");
  const credits = appendDiv(bar, "res-credits");
  const power = appendDiv(bar, "res-power");
  return {
    render(snapshot) {
      if (snapshot === null) {
        credits.textContent = "";
        power.textContent = "";
        power.classList.remove("power-low");
        return;
      }
      const text = resourceText(snapshot);
      credits.textContent = text.credits;
      power.textContent = text.power;
      power.classList.toggle("power-low", text.low);
    },
  };
}

/** `#queue` view of one production building; items and progress update in place. */
interface QueueView {
  container: HTMLDivElement;
  items: HTMLSpanElement[];
  progress: HTMLProgressElement;
}

/** `<div id="command-panel">` with one `.cmd` button per offer and, for a
 *  production building, `<div id="queue">` (spec §6.6). The panel re-renders
 *  every frame, so its nodes are reused: replacing them would detach the
 *  element under the pointer between frames. */
export function createCommandPanel(
  root: HTMLElement,
  handlers: {
    onConstruct(kind: number): void;
    onProduce(kind: number): void;
    onCancel(): void;
  },
): { render(buttons: CommandButton[], queue: QueueState | null): void } {
  const panel = appendDiv(root, "command-panel");
  const elements: HTMLButtonElement[] = [];
  let rendered: CommandButton[] = [];
  let queueView: QueueView | null = null;

  function buttonAt(index: number): HTMLButtonElement {
    const existing = elements[index];
    if (existing !== undefined) return existing;
    const element = document.createElement("button");
    element.className = "cmd";
    element.addEventListener("click", () => {
      const button = rendered[index];
      if (button === undefined) return;
      if (button.action === "construct") handlers.onConstruct(button.typeIndex);
      else handlers.onProduce(button.typeIndex);
    });
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (rendered[index]?.action === "produce") handlers.onCancel();
    });
    elements[index] = element;
    return element;
  }

  function updateQueue(queue: QueueState): QueueView {
    queueView ??= createQueueView();
    const view = queueView;
    for (let i = 0; i < queue.items.length; i++) {
      let item = view.items[i];
      if (item === undefined) {
        item = document.createElement("span");
        item.className = "queue-item";
        view.items[i] = item;
      }
      const kind = queue.items[i] ?? -1;
      item.dataset.type = RULES.types[kind]?.id ?? String(kind);
      view.container.insertBefore(item, view.progress);
    }
    while (view.items.length > queue.items.length) view.items.pop()?.remove();
    view.progress.value = queue.headPermille;
    return view;
  }

  return {
    render(buttons, queue) {
      rendered = buttons;
      for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];
        if (button === undefined) continue;
        const element = buttonAt(i);
        const def = RULES.types[button.typeIndex];
        element.dataset.type = def?.id ?? String(button.typeIndex);
        element.textContent = button.label;
        element.disabled = !button.enabled;
        panel.insertBefore(element, queueView?.container ?? null);
      }
      while (elements.length > buttons.length) elements.pop()?.remove();
      if (queue === null) {
        queueView?.container.remove();
        queueView = null;
        return;
      }
      const view = updateQueue(queue);
      if (view.container.parentNode !== panel)
        panel.appendChild(view.container);
    },
  };
}

function createQueueView(): QueueView {
  const container = appendDiv(document.createElement("div"), "queue");
  const progress = document.createElement("progress");
  progress.id = "queue-progress";
  progress.max = QUEUE_PROGRESS_MAX;
  container.appendChild(progress);
  return { container, items: [], progress };
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
    { seed, mapId, viewer, speed, debug },
  );
  const commandPanel = createCommandPanel(document.body, {
    onConstruct: (kind) => {
      placementKind = kind;
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
    entities = createEntityRenderer(ENTITY_CAPACITY);
    scene.add(entities.group);
    fogOverlay = createFogOverlay(mapInfo.mapWidth, mapInfo.mapHeight);
    scene.add(fogOverlay.mesh);
    scene.add(placementGhost.mesh);
    controller = createSkirmishController({
      canvas: renderer.domElement,
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
      },
      player: () => controlled,
      command: (command) => interact.command(command),
      onSelectionChange: (ids) => hud.setSelectedCount(ids.size),
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
  }

  /** Applies the debug-only F3 reveal toggle (§6.5). */
  function toggleReveal(): void {
    viewer = viewer === OBSERVER ? controlled : OBSERVER;
    interact.setViewer(viewer);
  }

  /** Positions and tints the footprint ghost while placing (spec §6.5). */
  function updatePlacementGhost(): void {
    const preview = controller?.placementPreview() ?? null;
    placementGhost.mesh.visible = preview !== null;
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
    resourceBar.render(next);
    outcome.render(next === null ? null : outcomeText(next, controlled));
    if (next === null) {
      commandPanel.render([], null);
    } else {
      const queue = selectedQueue();
      commandPanel.render(
        commandButtons({
          selected: selectedEntities(),
          ownEntities: next.entities.filter(
            (entity) => entity.owner === controlled,
          ),
          credits: next.credits,
          queue,
        }),
        queue,
      );
    }
    renderer.render(scene, camera);
    drawCalls = renderer.info.render.calls;
  }
  requestAnimationFrame(frame);

  if (debug) {
    const api: SkirmishDebug = {
      isReady: () => ready,
      mode: () => "skirmish",
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
