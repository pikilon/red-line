import { Color, Scene, WebGLRenderer } from "three";
import { createIsometricCamera } from "./camera";
import { createFrameStats, installDebugApi, type RedlineDebug } from "./debug";
import { createHud } from "./hud";
import { type Controller, createController } from "./input/controller";
import { createTerrain } from "./render/terrain";
import { createUnitsRenderer, type UnitsRenderer } from "./render/units";
import { toRaw } from "./sim/fixed";
import { type ReadyMessage, TICK_MS } from "./sim/protocol";
import { createSimClient } from "./sim/simClient";
import {
  interpolateUnits,
  type Snapshot,
  type UnitState,
} from "./sim/snapshot";

export const DEFAULT_SEED = 1;
export const DEFAULT_UNIT_COUNT = 500;
const MAX_UNIT_COUNT = 2000;

const container = document.getElementById("app");
if (!container) throw new Error("Missing #app container");
const hudRoot = document.getElementById("hud") ?? container;

const params = new URLSearchParams(location.search);
function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(params.get(name) ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}
const seed = readInt("seed", DEFAULT_SEED);
const unitCount = Math.min(
  MAX_UNIT_COUNT,
  Math.max(0, readInt("units", DEFAULT_UNIT_COUNT)),
);

const renderer = new WebGLRenderer({ antialias: true });
const scene = new Scene();
scene.background = new Color(0x101820);
const camera = createIsometricCamera(1);
const hud = createHud(hudRoot);
hud.setSelectedCount(0);

function resize(): void {
  const { clientWidth: width, clientHeight: height } = container as HTMLElement;
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

const worker = new Worker(new URL("./sim/sim.worker.ts", import.meta.url), {
  type: "module",
});
worker.addEventListener("error", (event) => hud.showError(event.message));
const sim = createSimClient(worker, { seed, unitCount });

let prev: Snapshot | null = null;
let next: Snapshot | null = null;
let receivedAt = 0;
let displayed: UnitState[] = [];
let map: ReadyMessage | null = null;
let controller: Controller | null = null;
let unitsRenderer: UnitsRenderer | null = null;

sim.onSnapshot((snapshot, at) => {
  prev = next ?? snapshot;
  next = snapshot;
  receivedAt = at;
  hud.setTick(snapshot.tick);
  start();
});
sim.ready.then(
  (message) => {
    map = message;
    start();
  },
  (error: unknown) => {
    hud.showError(error instanceof Error ? error.message : String(error));
  },
);

/** Builds the scene once both the map and the first snapshot are known. */
function start(): void {
  if (controller !== null || map === null || next === null) return;
  scene.add(createTerrain(map.mapWidth, map.mapHeight, map.tiles));
  unitsRenderer = createUnitsRenderer(MAX_UNIT_COUNT);
  scene.add(unitsRenderer.mesh);
  controller = createController({
    canvas: renderer.domElement,
    keyTarget: window,
    camera,
    mapWidth: map.mapWidth,
    mapHeight: map.mapHeight,
    units: () => displayed,
    move: (ids, x, y) => sim.move(ids, x, y),
    onSelectionChange: (selected) => hud.setSelectedCount(selected.size),
  });
  const units = next.units;
  const count = Math.max(units.length, 1);
  const centre =
    units.length === 0
      ? { x: map.mapWidth / 2, y: map.mapHeight / 2 }
      : {
          x: units.reduce((sum, unit) => sum + unit.x, 0) / count,
          y: units.reduce((sum, unit) => sum + unit.y, 0) / count,
        };
  controller.setTarget(centre.x, centre.y);
  displayed = units;
}

const frameStats = createFrameStats();
let drawCalls = 0;
let lastFrameMs: number | null = null;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dtMs = lastFrameMs === null ? 0 : now - lastFrameMs;
  if (lastFrameMs !== null) frameStats.record(dtMs);
  lastFrameMs = now;
  if (controller !== null && prev !== null && next !== null) {
    controller.update(dtMs / 1000);
    displayed = interpolateUnits(prev, next, (now - receivedAt) / TICK_MS);
    unitsRenderer?.update(displayed, controller.selected);
  }
  renderer.render(scene, camera);
  drawCalls = renderer.info.render.calls;
}
requestAnimationFrame(frame);

function latestUnit(id: number): UnitState | undefined {
  return next?.units.find((unit) => unit.id === id);
}

if (params.get("debug") === "1") {
  const api: RedlineDebug = {
    isReady: () => controller !== null,
    tick: () => next?.tick ?? 0,
    unitCount: () => next?.units.length ?? 0,
    unitPosition: (id) => {
      const unit = latestUnit(id);
      return unit === undefined ? null : { x: unit.x, y: unit.y };
    },
    isMoving: (id) => latestUnit(id)?.moving ?? false,
    selectedIds: () => [...(controller?.selected ?? [])].sort((a, b) => a - b),
    worldToScreen: (x, y) =>
      controller?.worldToScreen(x, y) ?? { x: Number.NaN, y: Number.NaN },
    cameraTarget: () => controller?.cameraTarget() ?? { x: 0, y: 0 },
    commandMove: (ids, x, y) => sim.move(ids, toRaw(x), toRaw(y)),
    stateHash: () => sim.requestHash(),
    drawCalls: () => drawCalls,
    resetFrameStats: () => frameStats.reset(),
    frameStats: () => frameStats.read(),
  };
  installDebugApi(window as { __redline?: RedlineDebug }, api);
}
